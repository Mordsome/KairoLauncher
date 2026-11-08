import { homedir } from 'node:os'

// Removes secrets (sign-in tokens) from anything that might be logged or shown,
// and shortens the home folder to "~" so a log or an error on screen doesn't
// show the computer's user name (often a real name) in its paths.

const secrets = new Set<string>()

/** Registers a secret for as long as the app runs. Short values are ignored. */
export function addSecret(value: string | undefined): void {
  if (value && value.length >= 12) secrets.add(value)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A function that replaces a home folder with "~" in the ways it shows up in
 * logs: C:\Users\<name>, C:/Users/<name>, file:///C:/Users/<name> and with %20
 * for spaces. Only whole folder names: a home "ann" doesn't touch "anna".
 */
export function homeRedactor(home: string, windows: boolean): (text: string) => string {
  const trimmed = home.replace(/[\\/]+$/, '')
  // "/" or "C:\" as a home folder would hide everything; leave text alone then.
  if (trimmed.replace(/^[A-Za-z]:/, '').replace(/[\\/]/g, '').length < 2) return (text) => text
  const forward = trimmed.replace(/\\/g, '/')
  const forms = new Set([trimmed, forward, encodeURI(forward)])
  const alternatives = [...forms].sort((a, b) => b.length - a.length).map(escape).join('|')
  const pattern = new RegExp(`(?:${alternatives})(?=$|[\\\\/"'\\s:;,)\\]>])`, windows ? 'gi' : 'g')
  return (text) => text.replace(pattern, '~')
}

const hideHome = homeRedactor(homedir(), process.platform === 'win32')

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  // Belt and braces: anything shaped like a JWT or an --accessToken argument.
  out = out.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[redacted]')
  out = out.replace(/(--accessToken[\s=]+)\S+/g, '$1[redacted]')
  return hideHome(out)
}
