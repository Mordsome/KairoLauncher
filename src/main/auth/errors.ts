import type { AuthErrorInfo } from '../../shared/api'

export type AuthErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'no-xbox-profile'
  | 'child-account'
  | 'xbox-unavailable'
  | 'adult-verification'
  | 'no-minecraft'
  | 'no-profile'
  | 'invalid-app'
  | 'expired'
  | 'sign-in-failed'
  | 'not-configured'
  | 'unknown'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'AuthError'
  }
}

/** The specific, plain message the sign-in screen shows for each failure. */
export function describeAuthError(error: unknown): AuthErrorInfo {
  const code: AuthErrorCode = error instanceof AuthError ? error.code : 'unknown'
  switch (code) {
    case 'cancelled':
      return { code, title: 'Sign-in cancelled', message: 'Nothing was changed. Try again whenever you like.' }
    case 'timeout':
      return { code, title: 'Sign-in timed out', message: 'The browser step took too long. Start again from the launcher.' }
    case 'network':
      return { code, title: "Can't reach Microsoft", message: 'Check your internet connection and try again.' }
    case 'no-xbox-profile':
      return {
        code,
        title: 'Create your Xbox profile first',
        message: 'This Microsoft account has no Xbox profile yet. Sign in once on xbox.com to create one, then try again.',
        help: { label: 'Open xbox.com', url: 'https://www.xbox.com/en-US/live' }
      }
    case 'child-account':
      return {
        code,
        title: 'An adult needs to allow this',
        message: 'This is a child account. An adult in your Microsoft family has to allow it to play Minecraft in family settings.',
        help: { label: 'Open family settings', url: 'https://account.microsoft.com/family/' }
      }
    case 'xbox-unavailable':
      return { code, title: "Xbox Live isn't available here", message: "Xbox Live isn't available in this account's country or region, so Minecraft can't sign in." }
    case 'adult-verification':
      return {
        code,
        title: 'Age verification needed',
        message: 'This account needs adult verification on xbox.com before it can play.',
        help: { label: 'Open xbox.com', url: 'https://www.xbox.com/en-US/live' }
      }
    case 'no-minecraft':
      return {
        code,
        title: "This account doesn't own Minecraft",
        message: 'Sign in with the Microsoft account that bought Minecraft: Java Edition.',
        help: { label: 'Get Minecraft', url: 'https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc' }
      }
    case 'no-profile':
      return {
        code,
        title: 'Pick a Minecraft name first',
        message: 'This account owns Minecraft but has no player name yet. Open the official launcher or minecraft.net once to choose one.',
        help: { label: 'Open minecraft.net', url: 'https://www.minecraft.net/msaprofile' }
      }
    case 'invalid-app':
      return {
        code,
        title: 'Invalid app registration',
        message:
          "Microsoft signed you in, but Minecraft doesn't accept this launcher yet: Mojang is still reviewing its app registration. This usually takes about a week."
      }
    case 'expired':
      return { code, title: 'Sign in again', message: 'Microsoft asked you to sign in again for this account.' }
    case 'sign-in-failed':
      return { code, title: "Microsoft didn't finish the sign-in", message: 'Try again. If it keeps happening, check that the date and time on this PC are right.' }
    case 'not-configured':
      return { code, title: 'Sign-in is not set up', message: 'This build has no Microsoft client ID. See docs/AUTH_SETUP.md.' }
    default:
      return { code: 'unknown', title: "Sign-in didn't work", message: 'Something unexpected went wrong. Try again in a moment.' }
  }
}
