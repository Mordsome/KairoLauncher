import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { totalmem } from 'node:os'
import { IPC, type AppInfo, type Platform } from '../shared/api'
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

export function registerIpc(): void {
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
      totalMemoryMB: Math.round(totalmem() / (1024 * 1024))
    }
  })

  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    if (!fromApp(event) || typeof url !== 'string') return false
    return openExternalSafe(url)
  })
}
