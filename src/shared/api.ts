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
  installsImportModpack: 'installs:import-modpack'
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
  loader: CustomLoader
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
  crash: { crashReport: string | null } | null
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
  }
  game: {
    versions(): Promise<VersionList>
    play(request: PlayRequest): Promise<void>
    stop(): Promise<void>
    state(): Promise<GameState>
    /** Calls back on every state change. Returns an unsubscribe function. */
    onState(listener: (state: GameState) => void): () => void
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
