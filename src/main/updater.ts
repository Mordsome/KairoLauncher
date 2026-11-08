import { app, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/api'
import { isAllowedUrl, USER_AGENT } from './net/http'
import { loadSettings } from './settings'

// The launcher updates itself from the GitHub releases of Mordsome/KairoLauncher.
// electron-updater checks every download against the SHA-512 in the release's
// latest.yml and deletes it on a mismatch. It only runs in installed builds.

const FIRST_CHECK_MS = 10_000
const EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'off', version: null, progress: 0, message: null }
let notify: (state: UpdateState) => void = () => undefined

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  notify(state)
}

export function updateState(): UpdateState {
  return state
}

export function initUpdater(onState: (state: UpdateState) => void): void {
  notify = onState
  if (!app.isPackaged) return // dev runs: nothing to update

  // electron-updater uses its own Electron network session; it may only reach
  // the same allow-listed hosts as everything else (GitHub, Mordsome's repos).
  session
    .fromPartition('electron-updater', { cache: false })
    .webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => callback({ cancel: !isAllowedUrl(details.url) }))

  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.requestHeaders = { 'User-Agent': USER_AGENT }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'latest', version: null, progress: 0 }))
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.max(0, Math.min(1, p.percent / 100)) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 1 }))
  autoUpdater.on('error', (error: Error) => {
    // Keep it short and never echo URLs or paths from the error.
    const offline = /ENOTFOUND|ECONNRE|ETIMEDOUT|ERR_INTERNET|ERR_NAME|net::/i.test(String(error?.message))
    set({
      status: 'error',
      message: offline ? "GitHub couldn't be reached. The launcher tries again later." : "The update couldn't be checked or downloaded. It's tried again later."
    })
  })

  set({ status: 'idle' })
  const tick = async () => {
    const settings = await loadSettings()
    if (settings.autoUpdate && state.status !== 'ready' && state.status !== 'downloading') void checkForUpdate()
  }
  setTimeout(() => void tick(), FIRST_CHECK_MS)
  setInterval(() => void tick(), EVERY_MS)
}

/** Checks now (also when automatic updates are off, because the player asked). */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged || state.status === 'downloading' || state.status === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // The 'error' event already set the state.
  }
  return state
}

/** Restarts into the downloaded update. */
export function installUpdate(): boolean {
  if (state.status !== 'ready') return false
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}
