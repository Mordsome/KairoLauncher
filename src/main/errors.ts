import type { GameError } from '../shared/api'
import { AuthError, describeAuthError } from './auth/errors'

export type KairoErrorCode =
  | 'blocked-host'
  | 'http-status'
  | 'checksum'
  | 'network'
  | 'disk-full'
  | 'no-permission'
  | 'no-java'
  | 'java-start'
  | 'not-signed-in'
  | 'unknown-version'
  | 'busy'

export class KairoError extends Error {
  constructor(
    readonly code: KairoErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'KairoError'
  }
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET'
])

/** Walks an error, its causes and aggregated errors. */
function* walk(error: unknown, depth = 0): Generator<unknown> {
  if (!error || depth > 6) return
  yield error
  if (error instanceof AggregateError) for (const inner of error.errors) yield* walk(inner, depth + 1)
  if (typeof error === 'object' && 'cause' in error) yield* walk((error as { cause: unknown }).cause, depth + 1)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : undefined
}

/** Turns any failure into a short, specific message for the Home screen. Never includes secrets. */
export function describeError(error: unknown, redact: (text: string) => string = (t) => t): GameError {
  for (const e of walk(error)) {
    if (e instanceof AuthError) {
      const info = describeAuthError(e)
      return { title: info.title, message: info.message }
    }
    if (e instanceof KairoError) {
      switch (e.code) {
        case 'checksum':
          return { title: "A download didn't match its checksum", message: `${e.message} The file was deleted. Try again.` }
        case 'blocked-host':
          return { title: 'Blocked an unexpected connection', message: e.message }
        case 'no-java':
          return { title: 'No Java for this version', message: e.message }
        case 'java-start':
          return { title: "Java couldn't start", message: redact(e.message) }
        case 'not-signed-in':
          return { title: 'Sign in to play', message: e.message }
        case 'busy':
          return { title: 'Already running', message: e.message }
        case 'unknown-version':
          return { title: 'Unknown version', message: e.message }
        default:
          return { title: "A download server didn't answer", message: redact(e.message) }
      }
    }
    const code = codeOf(e)
    if (code && NETWORK_CODES.has(code)) {
      return { title: "Can't reach the download servers", message: 'Check your internet connection and try again.' }
    }
    if (code === 'ENOSPC') return { title: 'Your disk is full', message: 'Free up some space and try again.' }
    if (code === 'EACCES' || code === 'EPERM') {
      return { title: "Can't write the game files", message: 'The launcher has no permission to write to its data folder.' }
    }
  }
  const text = error instanceof Error ? error.message : String(error)
  if (/Cannot recover \d+ install file/.test(text)) {
    return {
      title: "A download didn't match its checksum",
      message: 'The broken files were deleted. Try again; if it keeps happening, something on your network may be changing downloads.'
    }
  }
  return { title: 'Something went wrong', message: redact(text).slice(0, 300) }
}
