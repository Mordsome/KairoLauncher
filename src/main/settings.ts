import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LauncherSettings } from '../shared/api'
import { dataPaths } from './paths'

// The launcher's own settings, in settings.json next to the game data.
// Every field is checked on the way in and out; anything odd falls back to
// its default, and an unreadable file is set aside, never deleted.

export const DEFAULT_SETTINGS: LauncherSettings = {
  memoryGB: 4,
  customJava: false,
  javaPath: '',
  fullscreen: false,
  hideWhilePlaying: true,
  showSnapshots: false,
  matchTheme: true,
  autoUpdate: true,
  sounds: true,
  voidWarningSeen: false,
  lastSelection: null
}

const file = () => join(dataPaths().root, 'settings.json')

/** Keeps only valid fields, so a damaged or hand-edited file can't break anything. */
export function cleanSettings(raw: unknown): LauncherSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (key: keyof LauncherSettings) => (typeof r[key] === 'boolean' ? (r[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean))
  const memory = r['memoryGB']
  const javaPath = r['javaPath']
  const sel = r['lastSelection'] as Record<string, unknown> | null | undefined
  const editions = ['kairo', 'void', 'lite', 'vanilla', 'other']
  const lastSelection =
    sel &&
    typeof sel === 'object' &&
    typeof sel['edition'] === 'string' &&
    editions.includes(sel['edition']) &&
    typeof sel['mc'] === 'string' &&
    /^[\w.-]{1,32}$/.test(sel['mc']) &&
    (sel['installId'] === null || (typeof sel['installId'] === 'string' && /^[\w-]{1,32}$/.test(sel['installId'])))
      ? { edition: sel['edition'] as NonNullable<LauncherSettings['lastSelection']>['edition'], mc: sel['mc'], installId: sel['installId'] as string | null }
      : null
  return {
    memoryGB: typeof memory === 'number' && Number.isInteger(memory) && memory >= 1 && memory <= 64 ? memory : DEFAULT_SETTINGS.memoryGB,
    customJava: bool('customJava'),
    javaPath: typeof javaPath === 'string' && javaPath.length <= 1024 ? javaPath : '',
    fullscreen: bool('fullscreen'),
    hideWhilePlaying: bool('hideWhilePlaying'),
    showSnapshots: bool('showSnapshots'),
    matchTheme: bool('matchTheme'),
    autoUpdate: bool('autoUpdate'),
    sounds: bool('sounds'),
    voidWarningSeen: bool('voidWarningSeen'),
    lastSelection
  }
}

export async function loadSettings(): Promise<LauncherSettings> {
  let text: string
  try {
    text = await readFile(file(), 'utf8')
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    return cleanSettings(JSON.parse(text))
  } catch {
    await rename(file(), `${file()}.broken-${Date.now()}`).catch(() => undefined)
    return { ...DEFAULT_SETTINGS }
  }
}

let writing: Promise<void> = Promise.resolve()

/** Saves settings; writes are queued so quick changes can't interleave. */
export function saveSettings(raw: unknown): Promise<LauncherSettings> {
  const settings = cleanSettings(raw)
  writing = writing.then(async () => {
    await mkdir(dataPaths().root, { recursive: true })
    await writeFile(`${file()}.tmp`, JSON.stringify(settings, null, 2))
    await rename(`${file()}.tmp`, file())
  })
  return writing.then(() => settings)
}
