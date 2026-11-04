import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { totalmem } from 'node:os'
import { IPC, type AppInfo, type PlayRequest, type Platform } from '../shared/api'
import { devOfflineAccount } from './account/devOffline'
import { listVersions } from './game/manifest'
import type { GameSession } from './game/session'
import { isAppUrl } from './origin'
import { openExternalSafe } from './security'

// Only the launcher's own page may call in. Anything else is dropped.
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isAppUrl(url)
}

function platform(): Platform {
  const p = process.platform
  return p === 'win32' || p === 'darwin' || p === 'linux' ? p : 'other'
}

const totalMemoryMB = () => Math.round(totalmem() / (1024 * 1024))

/** Checks every field: the renderer is treated as untrusted. */
export function parsePlayRequest(raw: unknown): PlayRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const target = r['target'] as Record<string, unknown> | undefined
  if (!target || target['kind'] !== 'vanilla' || typeof target['mc'] !== 'string') return null
  const mc = target['mc']
  if (!/^[\w.\- ]{1,64}$/.test(mc)) return null

  const memoryGB = r['memoryGB']
  const maxGB = Math.max(2, Math.floor(totalMemoryMB() / 1024))
  if (typeof memoryGB !== 'number' || !Number.isInteger(memoryGB) || memoryGB < 1 || memoryGB > Math.min(64, maxGB)) return null

  const javaPath = r['javaPath']
  if (javaPath !== null && (typeof javaPath !== 'string' || javaPath.length > 1024 || javaPath.trim() === '')) return null

  if (typeof r['fullscreen'] !== 'boolean' || typeof r['hideWhilePlaying'] !== 'boolean') return null

  return {
    target: { kind: 'vanilla', mc },
    memoryGB,
    javaPath: javaPath === null ? null : javaPath.trim(),
    fullscreen: r['fullscreen'],
    hideWhilePlaying: r['hideWhilePlaying']
  }
}

export function registerIpc(session: GameSession): void {
  ipcMain.on(IPC.windowMinimize, (event) => {
    if (fromApp(event)) BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.windowClose, (event) => {
    if (fromApp(event)) BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return {
      version: app.getVersion(),
      platform: platform(),
      totalMemoryMB: totalMemoryMB(),
      devOfflineName: devOfflineAccount()?.name ?? null
    }
  })

  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    if (!fromApp(event) || typeof url !== 'string') return false
    return openExternalSafe(url)
  })

  ipcMain.handle(IPC.gameVersions, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return listVersions()
  })

  ipcMain.handle(IPC.gameState, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return session.current()
  })

  ipcMain.handle(IPC.gamePlay, (event, raw: unknown) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    const request = parsePlayRequest(raw)
    if (!request) throw new Error('Invalid play request')
    // Runs in the background; progress and errors arrive as state events.
    void session.play(request, devOfflineAccount())
  })

  ipcMain.handle(IPC.gameStop, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    session.stop()
  })
}
