import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo, type KairoApi } from '../shared/api'

// Typed wrappers only. The page never gets ipcRenderer itself.
const api: KairoApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    close: () => ipcRenderer.send(IPC.windowClose)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
    openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, String(url)) as Promise<boolean>
  }
}

contextBridge.exposeInMainWorld('kairo', api)
