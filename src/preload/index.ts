import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppInfo, type GameState, type KairoApi, type PlayRequest, type VersionList } from '../shared/api'

// Typed wrappers only. The page never gets ipcRenderer itself.
const api: KairoApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    close: () => ipcRenderer.send(IPC.windowClose)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
    openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, String(url)) as Promise<boolean>
  },
  game: {
    versions: () => ipcRenderer.invoke(IPC.gameVersions) as Promise<VersionList>,
    play: (request: PlayRequest) => ipcRenderer.invoke(IPC.gamePlay, request) as Promise<void>,
    stop: () => ipcRenderer.invoke(IPC.gameStop) as Promise<void>,
    state: () => ipcRenderer.invoke(IPC.gameState) as Promise<GameState>,
    onState: (listener: (state: GameState) => void) => {
      // Pass on the data only, never the IPC event object.
      const handler = (_event: IpcRendererEvent, state: GameState) => listener(state)
      ipcRenderer.on(IPC.gameStateChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC.gameStateChanged, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('kairo', api)
