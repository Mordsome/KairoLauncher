import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false },
  shell: { openPath: vi.fn(), trashItem: vi.fn() }
}))

const { cleanSettings, DEFAULT_SETTINGS } = await import('../../src/main/settings')
const { crashReason } = await import('../../src/main/game/session')

describe('cleanSettings', () => {
  it('gives the defaults for anything that is not an object', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(cleanSettings('memoryGB=64')).toEqual(DEFAULT_SETTINGS)
    expect(cleanSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields', () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      memoryGB: 8,
      sounds: false,
      customJava: true,
      javaPath: 'C:\\Java\\bin\\java.exe',
      lastSelection: { edition: 'other', mc: '1.21.1', installId: '0123456789ab' }
    }
    expect(cleanSettings(saved)).toEqual(saved)
  })

  it('drops odd values field by field', () => {
    const out = cleanSettings({
      memoryGB: 999,
      sounds: 'yes',
      javaPath: 'x'.repeat(5000),
      fullscreen: true,
      extra: 'ignored',
      lastSelection: { edition: 'hacked', mc: '1.21', installId: null }
    })
    expect(out.memoryGB).toBe(DEFAULT_SETTINGS.memoryGB)
    expect(out.sounds).toBe(DEFAULT_SETTINGS.sounds)
    expect(out.javaPath).toBe('')
    expect(out.fullscreen).toBe(true)
    expect(out.lastSelection).toBeNull()
    expect(out).not.toHaveProperty('extra')
  })

  it('refuses memory that is not a whole number of gigabytes', () => {
    expect(cleanSettings({ memoryGB: 2.5 }).memoryGB).toBe(DEFAULT_SETTINGS.memoryGB)
    expect(cleanSettings({ memoryGB: 0 }).memoryGB).toBe(DEFAULT_SETTINGS.memoryGB)
  })

  it('refuses a selection with an unsafe id or version', () => {
    expect(cleanSettings({ lastSelection: { edition: 'other', mc: '1.21', installId: '../../x' } }).lastSelection).toBeNull()
    expect(cleanSettings({ lastSelection: { edition: 'vanilla', mc: '1.21/../..', installId: null } }).lastSelection).toBeNull()
  })
})

describe('crashReason', () => {
  const log = (...tail: string[]) => ['[main/INFO]: Loading Minecraft', ...tail]

  it('spots running out of memory', () => {
    expect(crashReason(log('java.lang.OutOfMemoryError: Java heap space')).title).toBe('Minecraft ran out of memory')
  })

  it('spots Java refusing the memory setting', () => {
    expect(crashReason(log('Error: Could not create the Java Virtual Machine.')).title).toBe("Java couldn't start with this much memory")
  })

  it('spots mods that do not fit together', () => {
    expect(crashReason(log('net.fabricmc.loader.impl.FormattedException: Incompatible mods found!')).title).toBe("Some mods don't fit together")
  })

  it('spots a Java that is too old', () => {
    expect(crashReason(log('java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main')).title).toBe('This needs a newer Java')
  })

  it('falls back to a plain message', () => {
    expect(crashReason(log('[main/ERROR]: something else')).title).toBe('Minecraft closed unexpectedly')
    expect(crashReason([]).title).toBe('Minecraft closed unexpectedly')
  })
})
