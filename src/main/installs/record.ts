import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// One JSON file per install, next to its worlds and mods. A file that can't be
// read is moved aside (kept, never deleted) and treated as a fresh install.

export const RECORD_FILE = 'kairo-launcher.json'

export interface ManagedMod {
  /** "kairo", "fabric-api", "sodium"... */
  project: string
  name: string
  /** The mod's own version, from its fabric.mod.json. */
  version: string
  filename: string
  url: string
  hash: { algorithm: 'sha1' | 'sha256' | 'sha512'; value: string }
}

export interface InstallRecord {
  schema: 1
  edition: 'kairo' | 'void'
  mc: string | null
  loader: string | null
  kairo: ManagedMod | null
  /** Other files the launcher put in mods/ (Fabric API, Sodium). */
  mods: ManagedMod[]
  keepUpdated: boolean
  lastPlayed: number | null
  playMinutes: number
}

export function emptyRecord(edition: InstallRecord['edition']): InstallRecord {
  return { schema: 1, edition, mc: null, loader: null, kairo: null, mods: [], keepUpdated: true, lastPlayed: null, playMinutes: 0 }
}

function isMod(m: unknown): m is ManagedMod {
  const x = m as ManagedMod
  return !!x && typeof x.project === 'string' && typeof x.filename === 'string' && typeof x.url === 'string' && typeof x.hash?.value === 'string'
}

function isRecord(r: unknown): r is InstallRecord {
  const x = r as InstallRecord
  return (
    !!x &&
    x.schema === 1 &&
    (x.edition === 'kairo' || x.edition === 'void') &&
    Array.isArray(x.mods) &&
    x.mods.every(isMod) &&
    (x.kairo === null || isMod(x.kairo)) &&
    typeof x.keepUpdated === 'boolean'
  )
}

export async function readRecord(dir: string): Promise<InstallRecord | null> {
  const file = join(dir, RECORD_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) return parsed
    // A custom install's record (see custom.ts) is fine, just not a Kairo one.
    if ((parsed as { kind?: unknown } | null)?.kind === 'custom') return null
  } catch {
    // fall through to backup
  }
  await rename(file, join(dir, `${RECORD_FILE}.broken-${Date.now()}`)).catch(() => undefined)
  return null
}

/** Writes via a temporary file, so a crash mid-write never leaves half a file. */
export async function writeRecord(dir: string, record: InstallRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, RECORD_FILE)
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(record, null, 2))
  await rename(tmp, file)
}
