// The whole surface the renderer can reach. Keep it small: every method here
// is something an attacker who got script into the page could also call.

export const IPC = {
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  gameVersions: 'game:versions',
  gamePlay: 'game:play',
  gameStop: 'game:stop',
  gameState: 'game:state',
  gameStateChanged: 'game:state-changed',
  kairoStatus: 'kairo:status',
  kairoSetKeepUpdated: 'kairo:set-keep-updated',
  authState: 'auth:state',
  authSignIn: 'auth:sign-in',
  authCancel: 'auth:cancel',
  authSwitch: 'auth:switch',
  authSignOut: 'auth:sign-out',
  loaderVersions: 'loaders:versions',
  loaderExtras: 'loaders:extras',
  loaderOpenDownloadPage: 'loaders:open-download-page',
  installsList: 'installs:list',
  installsCreate: 'installs:create',
  installsImportModpack: 'installs:import-modpack',
  installsRename: 'installs:rename',
  installsDuplicate: 'installs:duplicate',
  installsDelete: 'installs:delete',
  installsChangeVersion: 'installs:change-version',
  installsOpenFolder: 'installs:open-folder',
  gameLogs: 'game:logs',
  gameOpenCrashReport: 'game:open-crash-report',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsPickJava: 'settings:pick-java',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateChanged: 'update:changed'
} as const

export interface AccountSummary {
  /** Minecraft profile UUID. */
  uuid: string
  /** Minecraft player name. */
  name: string
}

export interface AccountsState {
  accounts: AccountSummary[]
  /** UUID of the account that plays. */
  active: string | null
}

export interface AuthErrorInfo {
  code: string
  title: string
  message: string
  /** An official help page, opened in the browser. */
  help?: { label: string; url: string }
}

export type SignInResult = { ok: true; account: AccountSummary; state: AccountsState } | { ok: false; error: AuthErrorInfo }

export type KairoEdition = 'kairo' | 'void'

export type Platform = 'win32' | 'darwin' | 'linux' | 'other'

export interface AppInfo {
  version: string
  platform: Platform
  /** Physical memory of this PC, in megabytes. */
  totalMemoryMB: number
  /** Name of the dev-only offline account, or null when it's off (always off in releases). */
  devOfflineName: string | null
}

export interface VersionList {
  latest: string
  /** Every release from 1.8 up, newest first. */
  releases: string[]
  /** Snapshots newer than the latest release. */
  snapshots: string[]
  /** Versions whose game files are already downloaded and checked. */
  ready: string[]
}

export type PlayTarget = { kind: 'vanilla'; mc: string } | { kind: 'kairo'; edition: KairoEdition } | { kind: 'custom'; id: string }

export type CustomLoader = 'fabric' | 'neoforge' | 'forge' | 'optifine'
/** Plain Minecraft installs use the same records as custom ones. */
export type InstallLoader = CustomLoader | 'vanilla'

export interface LauncherSettings {
  memoryGB: number
  customJava: boolean
  javaPath: string
  fullscreen: boolean
  hideWhilePlaying: boolean
  showSnapshots: boolean
  matchTheme: boolean
  autoUpdate: boolean
  /** The photosensitivity warning before the first Kairo Void install was accepted. */
  voidWarningSeen: boolean
  /** What was selected on Home, restored at the next start. */
  lastSelection: { edition: 'kairo' | 'void' | 'lite' | 'vanilla' | 'other'; mc: string; installId: string | null } | null
}

/** The launcher's own updates, from GitHub releases. "off" in dev runs. */
export interface UpdateState {
  status: 'off' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  /** The new version, while downloading or ready. */
  version: string | null
  /** 0 to 1, while downloading. */
  progress: number
  /** Why the last check failed, in plain words. */
  message: string | null
}

export interface LoaderVersions {
  /** Minecraft versions the loader supports, newest first. */
  mcs: string[]
  /** The loader version the launcher would use per Minecraft version (NeoForge, Forge). */
  loaderVersions: Record<string, string>
}

export interface ExtraInfo {
  /** Modrinth project slug. */
  id: string
  name: string
  sub: string
}

export interface CustomInstallInfo {
  id: string
  name: string
  mc: string
  loader: InstallLoader
  loaderVersion: string | null
  /** Extras the player asked for. */
  extras: string[]
  /** What the launcher put in mods/ (after the first Play). */
  mods: ModInfo[]
  installed: boolean
  lastPlayed: number | null
  playMinutes: number
  /** Set for installs made from a modpack. */
  modpack: { name: string; version: string } | null
}

export interface CreateCustomRequest {
  loader: CustomLoader
  mc: string
  extras: string[]
}

/** Rename, duplicate, change version: the updated install, or why not. */
export type LibraryResult = { ok: true; install: CustomInstallInfo } | { ok: false; error: { title: string; message: string } }

/** The game's output for one install: this session's run if there is one, else its last log file. */
export interface LogView {
  lines: string[]
  /** True while this install's game is running (lines keep coming). */
  live: boolean
}

/** Creating an install or importing a modpack. A cancelled file dialog is not an error. */
export type CreateResult =
  | { ok: true; install: CustomInstallInfo }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: { title: string; message: string } }

export interface ModInfo {
  name: string
  version: string
}

export interface KairoInstallInfo {
  /** Null until the first Play has installed it. */
  mc: string | null
  kairoVersion: string | null
  /** What the launcher put in mods/: Kairo, Fabric Loader, Fabric API, Sodium. */
  mods: ModInfo[]
  keepUpdated: boolean
  lastPlayed: number | null
  playMinutes: number
}

export interface KairoStatus {
  /** Newest verifiable release on GitHub, or null if it can't be reached and none was seen yet. */
  latest: { version: string } | null
  installs: Record<KairoEdition, KairoInstallInfo>
}

export interface PlayRequest {
  target: PlayTarget
  memoryGB: number
  /** Absolute path to a java executable, or null for the automatic one from Mojang. */
  javaPath: string | null
  fullscreen: boolean
  hideWhilePlaying: boolean
}

export type GamePhase = 'idle' | 'download' | 'launch' | 'running'

export interface GameError {
  title: string
  message: string
}

export interface GameState {
  phase: GamePhase
  /** 0 to 1, while downloading. */
  progress: number
  /** What is happening right now, in a few words. */
  detail: string
  /** Set when the last attempt failed before the game started. */
  error: GameError | null
  /** Set when the game closed with an error. */
  crash: { title: string; message: string; hasReport: boolean } | null
}

export interface KairoApi {
  window: {
    minimize(): void
    close(): void
  }
  app: {
    info(): Promise<AppInfo>
    /** Opens an allow-listed https link in the system browser. Resolves false if refused. */
    openExternal(url: string): Promise<boolean>
    update: {
      state(): Promise<UpdateState>
      /** Checks GitHub now and downloads a newer version if there is one. */
      check(): Promise<UpdateState>
      /** Restarts into a downloaded update. False if none is ready or Minecraft is running. */
      install(): Promise<boolean>
      onState(listener: (state: UpdateState) => void): () => void
    }
  }
  game: {
    versions(): Promise<VersionList>
    play(request: PlayRequest): Promise<void>
    stop(): Promise<void>
    state(): Promise<GameState>
    /** Calls back on every state change. Returns an unsubscribe function. */
    onState(listener: (state: GameState) => void): () => void
    /** A custom install id, or "kairo" / "void". */
    logs(ref: string): Promise<LogView>
    openCrashReport(): Promise<void>
  }
  kairo: {
    status(): Promise<KairoStatus>
    setKeepUpdated(edition: KairoEdition, on: boolean): Promise<KairoStatus>
  }
  loaders: {
    versions(loader: CustomLoader): Promise<LoaderVersions>
    /** Sodium, Iris and Lithium, where Modrinth has them for this loader and version. */
    extras(loader: CustomLoader, mc: string): Promise<ExtraInfo[]>
    /** Forge and OptiFine: opens their official download page in the browser. */
    openDownloadPage(loader: 'forge' | 'optifine', mc: string): Promise<void>
  }
  installs: {
    list(): Promise<CustomInstallInfo[]>
    /** Fabric and NeoForge are created directly; Forge and OptiFine ask for the downloaded installer. */
    create(request: CreateCustomRequest): Promise<CreateResult>
    importModpack(): Promise<CreateResult>
    rename(id: string, name: string): Promise<LibraryResult>
    duplicate(id: string): Promise<LibraryResult>
    /** Moves the install's folder to the Recycle Bin / Trash. */
    remove(id: string): Promise<{ ok: true } | { ok: false; error: { title: string; message: string } }>
    changeVersion(id: string, mc: string): Promise<LibraryResult>
    /** A custom install id, or "kairo" / "void". */
    openFolder(ref: string): Promise<void>
  }
  settings: {
    get(): Promise<LauncherSettings>
    set(settings: LauncherSettings): Promise<LauncherSettings>
    /** Opens a file dialog for a java program; null if cancelled. */
    pickJava(): Promise<string | null>
  }
  auth: {
    state(): Promise<AccountsState>
    /** Opens Microsoft's page in the browser; resolves when the player finishes or cancels. */
    signIn(): Promise<SignInResult>
    cancel(): Promise<void>
    switchTo(uuid: string): Promise<AccountsState>
    signOut(uuid: string): Promise<AccountsState>
  }
}
