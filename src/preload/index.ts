import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AccountsState,
  type BackgroundFiles,
  type BackgroundResult,
  type BackgroundSlot,
  type LauncherSettings,
  type LibraryResult,
  type LogView,
  type UpdateState,
  type CreateCustomRequest,
  type CreateResult,
  type CustomInstallInfo,
  type CustomLoader,
  type ExtraInfo,
  type LoaderVersions,
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
    openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, String(url)) as Promise<boolean>,
    update: {
      state: () => ipcRenderer.invoke(IPC.updateState) as Promise<UpdateState>,
      check: () => ipcRenderer.invoke(IPC.updateCheck) as Promise<UpdateState>,
      install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<boolean>,
      onState: (listener: (state: UpdateState) => void) => {
        const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state)
        ipcRenderer.on(IPC.updateChanged, handler)
        return () => {
          ipcRenderer.removeListener(IPC.updateChanged, handler)
        }
      }
    }
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
    },
    logs: (ref: string) => ipcRenderer.invoke(IPC.gameLogs, String(ref)) as Promise<LogView>,
    openCrashReport: () => ipcRenderer.invoke(IPC.gameOpenCrashReport) as Promise<void>
  },
  loaders: {
    versions: (loader: CustomLoader) => ipcRenderer.invoke(IPC.loaderVersions, loader) as Promise<LoaderVersions>,
    extras: (loader: CustomLoader, mc: string) => ipcRenderer.invoke(IPC.loaderExtras, loader, String(mc)) as Promise<ExtraInfo[]>,
    openDownloadPage: (loader: 'forge' | 'optifine', mc: string) => ipcRenderer.invoke(IPC.loaderOpenDownloadPage, loader, String(mc)) as Promise<void>
  },
  installs: {
    list: () => ipcRenderer.invoke(IPC.installsList) as Promise<CustomInstallInfo[]>,
    create: (request: CreateCustomRequest) => ipcRenderer.invoke(IPC.installsCreate, request) as Promise<CreateResult>,
    importModpack: () => ipcRenderer.invoke(IPC.installsImportModpack) as Promise<CreateResult>,
    rename: (id: string, name: string) => ipcRenderer.invoke(IPC.installsRename, String(id), String(name)) as Promise<LibraryResult>,
    duplicate: (id: string) => ipcRenderer.invoke(IPC.installsDuplicate, String(id)) as Promise<LibraryResult>,
    remove: (id: string) =>
      ipcRenderer.invoke(IPC.installsDelete, String(id)) as Promise<{ ok: true } | { ok: false; error: { title: string; message: string } }>,
    changeVersion: (id: string, mc: string) => ipcRenderer.invoke(IPC.installsChangeVersion, String(id), String(mc)) as Promise<LibraryResult>,
    openFolder: (ref: string) => ipcRenderer.invoke(IPC.installsOpenFolder, String(ref)) as Promise<void>
  },
  background: {
    files: () => ipcRenderer.invoke(IPC.backgroundFiles) as Promise<BackgroundFiles>,
    pick: (slot: BackgroundSlot) => ipcRenderer.invoke(IPC.backgroundPick, slot) as Promise<BackgroundResult>,
    importBytes: (slot: BackgroundSlot, bytes: Uint8Array) =>
      ipcRenderer.invoke(IPC.backgroundImport, slot, bytes instanceof Uint8Array ? bytes : new Uint8Array(0)) as Promise<BackgroundResult>,
    remove: (slot: BackgroundSlot) => ipcRenderer.invoke(IPC.backgroundRemove, slot) as Promise<BackgroundFiles>
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<LauncherSettings>,
    set: (settings: LauncherSettings) => ipcRenderer.invoke(IPC.settingsSet, settings) as Promise<LauncherSettings>,
    pickJava: () => ipcRenderer.invoke(IPC.settingsPickJava) as Promise<string | null>
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
