import { app, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/api'
import { fetchOk, isAllowedUrl, USER_AGENT } from './net/http'
import { RELEASE_KEY } from './releaseKey'
import { hashFile, updateFileName, updateStatement, verifyStatement } from './signature'
import { loadSettings } from './settings'

// The launcher updates itself from the GitHub releases of Mordsome/KairoLauncher.
// electron-updater checks every download against the SHA-512 in the release's
// latest.yml. On top of that, the installer must carry Mordsome's signature
// (<installer>.sig, made on Mordsome's own PC; see src/main/signature.ts): until
// it checks out, the update is neither offered nor installed on quit.
// It only runs in installed builds.

const RELEASES = 'https://github.com/Mordsome/KairoLauncher/releases'

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

/**
 * electron-updater uses its own Electron network session; it may only reach the
 * same allow-listed hosts as everything else (GitHub, Mordsome's repos). Set in
 * every build, so the tests can check it.
 */
function guardUpdaterNetwork(): void {
  session
    .fromPartition('electron-updater', { cache: false })
    .webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => callback({ cancel: !isAllowedUrl(details.url) }))
}

export function initUpdater(onState: (state: UpdateState) => void): void {
  notify = onState
  guardUpdaterNetwork()
  if (!app.isPackaged) return // dev runs: nothing to update
  if (!RELEASE_KEY) {
    set({ status: 'off', message: "This build has no release key, so it can't check that updates really come from Mordsome." })
    return
  }

  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // only once the signature checks out
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.requestHeaders = { 'User-Agent': USER_AGENT }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'latest', version: null, progress: 0 }))
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.max(0, Math.min(1, p.percent / 100)) }))
  autoUpdater.on('update-downloaded', (info) => void checkSignature(info.version, info.downloadedFile, info.files.map((f) => f.url)))
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
    if (settings.autoUpdate) void checkForUpdate()
  }
  setTimeout(() => void tick(), FIRST_CHECK_MS)
  setInterval(() => void tick(), EVERY_MS)
}

/** The downloaded installer must be signed by Mordsome, under the exact name for its version. */
async function checkSignature(version: string, file: string, listed: string[]): Promise<void> {
  set({ status: 'verifying', version, progress: 1 })
  try {
    const name = updateFileName(version, process.platform)
    if (!name || !listed.includes(name)) throw new Error('unexpected installer name')
    const signature = await (await fetchOk(`${RELEASES}/download/v${version}/${encodeURIComponent(name)}.sig`)).text()
    if (!verifyStatement(RELEASE_KEY, updateStatement(name, await hashFile(file, 'sha512')), signature)) throw new Error('bad signature')
    autoUpdater.autoInstallOnAppQuit = true
    set({ status: 'ready', version, progress: 1, message: null })
  } catch {
    autoUpdater.autoInstallOnAppQuit = false
    set({ status: 'error', version: null, progress: 0, message: "An update was found, but it isn't signed by Mordsome, so it wasn't installed." })
  }
}

/** Checks now (also when automatic updates are off, because the player asked). */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged || !RELEASE_KEY || ['downloading', 'verifying', 'ready'].includes(state.status)) return state
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
