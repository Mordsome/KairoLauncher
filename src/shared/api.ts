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
  gameStateChanged: 'game:state-changed'
} as const

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

export interface PlayRequest {
  target: { kind: 'vanilla'; mc: string }
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
}
