/** What the game needs to start for a player. The token never leaves the main process. */
export interface GameAccount {
  name: string
  /** Minecraft profile UUID, without dashes. */
  uuid: string
  accessToken: string
  userType: 'mojang' | 'legacy'
  offline: boolean
}
