import { app } from 'electron'
import { createHash } from 'node:crypto'
import type { GameAccount } from './types'

// A dev-only offline account, for testing launches before Microsoft sign-in.
// It exists only in builds made with `--mode offline` (npm run dev:offline,
// the launch tests); every other build compiles this to `return null`.
// On top of that it refuses to work in a packaged app.

const NAME = 'Developer'

/** The UUID Minecraft itself uses for offline players: v3 of "OfflinePlayer:<name>". */
function offlineUuid(name: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  bytes[6] = (bytes[6]! & 0x0f) | 0x30
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytes.toString('hex')
}

export function devOfflineAccount(): GameAccount | null {
  if (!__KAIRO_DEV_OFFLINE__ || app.isPackaged) return null
  return { name: NAME, uuid: offlineUuid(NAME), accessToken: 'offline', userType: 'legacy', offline: true }
}
