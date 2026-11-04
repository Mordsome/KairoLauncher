// The whole surface the renderer can reach. Keep it small: every method here
// is something an attacker who got script into the page could also call.

export const IPC = {
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  appInfo: 'app:info',
  openExternal: 'app:open-external'
} as const

export type Platform = 'win32' | 'darwin' | 'linux' | 'other'

export interface AppInfo {
  version: string
  platform: Platform
  /** Physical memory of this PC, in megabytes. */
  totalMemoryMB: number
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
}
