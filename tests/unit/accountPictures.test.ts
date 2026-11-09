import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'kairo-pictures-'))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { parseProfile } = await import('../../src/main/auth/xbox')
const { isSkin } = await import('../../src/main/auth/skins')
const { backgroundFiles, copyInstallPicture, importBackground, isSlot, removeBackground } = await import('../../src/main/background')
const { cleanSettings } = await import('../../src/main/settings')

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

const ID = '0123456789abcdef0123456789abcdef'
const TEXTURE = '31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'

describe('skins', () => {
  it('takes the skin that is on from the profile, only from Mojang', () => {
    const skins = [
      { state: 'INACTIVE', url: 'http://textures.minecraft.net/texture/aaaaaaaaaaaaaaaaaaaa' },
      { state: 'ACTIVE', url: `http://textures.minecraft.net/texture/${TEXTURE}` }
    ]
    expect(parseProfile({ id: ID.toUpperCase(), name: 'Steve', skins })).toEqual({ id: ID, name: 'Steve', skin: TEXTURE })
    expect(parseProfile({ id: ID, name: 'Steve' }).skin).toBeNull()
    for (const url of [`https://evil.example/texture/${TEXTURE}`, `http://textures.minecraft.net/texture/${TEXTURE}/../x`, 'http://textures.minecraft.net/texture/NOTHEX']) {
      expect(parseProfile({ id: ID, name: 'Steve', skins: [{ state: 'ACTIVE', url }] }).skin).toBeNull()
    }
    expect(() => parseProfile({ id: 'nope', name: 'Steve' })).toThrow()
  })

  it('accepts only 64 × 64 and 64 × 32 PNG skins', () => {
    expect(isSkin(png(64, 64))).toBe(true)
    expect(isSkin(png(64, 32))).toBe(true)
    expect(isSkin(png(128, 128))).toBe(false)
    expect(isSkin(Buffer.from('GIF89a@\0@\0'))).toBe(false)
  })
})

describe('install and account pictures', () => {
  it('names only real slots', () => {
    for (const ok of ['main', 'void', 'install:0123456789ab', `account:${ID}`]) expect(isSlot(ok)).toBe(true)
    for (const bad of ['install:../../x', 'install:0123456789AB', 'account:123', 'skin', `account:${ID}/x`, null, 3]) expect(isSlot(bad)).toBe(false)
  })

  it('keeps one picture per install and account, copies with a duplicate, deletes on remove', async () => {
    const a = 'install:0123456789ab' as const
    const r = await importBackground(a, png(320, 180))
    expect(r.ok).toBe(true)
    await importBackground(`account:${ID}`, png(96, 96))
    await copyInstallPicture('0123456789ab', 'ba9876543210')
    let files = await backgroundFiles()
    expect(Object.keys(files.installs).sort()).toEqual(['0123456789ab', 'ba9876543210'])
    expect(files.accounts[ID]).toMatchObject({ width: 96, height: 96 })
    expect(files.main).toBeNull()
    await removeBackground(a)
    await removeBackground(`account:${ID}`)
    files = await backgroundFiles()
    expect(Object.keys(files.installs)).toEqual(['ba9876543210'])
    expect(files.accounts).toEqual({})
  })
})

describe('home layout setting', () => {
  it('keeps known layouts and falls back to Classic', () => {
    expect(cleanSettings({ homeLayout: 'panel' }).homeLayout).toBe('panel')
    expect(cleanSettings({ homeLayout: 'sideways' }).homeLayout).toBe('classic')
    expect(cleanSettings({}).homeLayout).toBe('classic')
  })
})
