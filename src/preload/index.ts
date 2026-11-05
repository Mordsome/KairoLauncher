import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AccountsState,
  type SignInResult,
  type AppInfo,
  type GameState,
  type KairoApi,
  type KairoEdition,
  type KairoStatus,
  type PlayRequest,
  type VersionList
} from '../shared/api'

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
  },
  auth: {
    state: () => ipcRenderer.invoke(IPC.authState) as Promise<AccountsState>,
    signIn: () => ipcRenderer.invoke(IPC.authSignIn) as Promise<SignInResult>,
    cancel: () => ipcRenderer.invoke(IPC.authCancel) as Promise<void>,
    switchTo: (uuid: string) => ipcRenderer.invoke(IPC.authSwitch, String(uuid)) as Promise<AccountsState>,
    signOut: (uuid: string) => ipcRenderer.invoke(IPC.authSignOut, String(uuid)) as Promise<AccountsState>
  },
  kairo: {
    status: () => ipcRenderer.invoke(IPC.kairoStatus) as Promise<KairoStatus>,
    setKeepUpdated: (edition: KairoEdition, on: boolean) =>
      ipcRenderer.invoke(IPC.kairoSetKeepUpdated, edition, Boolean(on)) as Promise<KairoStatus>
  }
}

contextBridge.exposeInMainWorld('kairo', api)
