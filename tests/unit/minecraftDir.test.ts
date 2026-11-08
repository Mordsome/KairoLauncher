import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false } }))

const { backupMinecraftOnce, canShare, defaultMinecraftDir } = await import('../../src/main/minecraftDir')

/** Every file under a folder with its size, time and content hash: proof nothing changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else out[relative(dir, p)] = `${s.size}:${s.mtimeMs}:${createHash('sha1').update(readFileSync(p)).digest('hex')}`
    }
  }
  walk(dir)
  return out
}

describe('.minecraft', () => {
  it('is where the official launcher keeps it', () => {
    expect(defaultMinecraftDir('win32', 'H', join('H', 'AppData', 'Roaming'))).toBe(join('H', 'AppData', 'Roaming', '.minecraft'))
    expect(defaultMinecraftDir('darwin', 'H', 'x')).toBe(join('H', 'Library', 'Application Support', 'minecraft'))
    expect(defaultMinecraftDir('linux', 'H', 'x')).toBe(join('H', '.minecraft'))
    expect(defaultMinecraftDir('aix', 'H', 'x')).toBeNull()
  })

  it('is shared only by installs whose mods load from their own folder', () => {
    expect(canShare('kairo', false)).toBe(true)
    expect(canShare('void', false)).toBe(true)
    expect(canShare('vanilla', false)).toBe(true)
    expect(canShare('fabric', false)).toBe(true)
    // NeoForge/Forge would read .minecraft/mods; OptiFine and modpacks keep their own setup.
    expect(canShare('neoforge', false)).toBe(false)
    expect(canShare('forge', false)).toBe(false)
    expect(canShare('optifine', false)).toBe(false)
    expect(canShare('fabric', true)).toBe(false)
  })

  it('is backed up once, into the launcher folder, without changing anything in .minecraft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kairo-mc-'))
    const mc = join(root, '.minecraft')
    const data = join(root, 'Kairo Launcher')
    mkdirSync(join(mc, 'config', 'sodium'), { recursive: true })
    mkdirSync(join(mc, 'saves', 'My World'), { recursive: true })
    mkdirSync(join(mc, 'mods'), { recursive: true })
    writeFileSync(join(mc, 'options.txt'), 'fov:0.5\n')
    writeFileSync(join(mc, 'servers.dat'), 'servers')
    writeFileSync(join(mc, 'config', 'sodium', 'options.json'), '{}')
    writeFileSync(join(mc, 'saves', 'My World', 'level.dat'), 'world')
    writeFileSync(join(mc, 'mods', 'their-mod.jar'), 'jar')
    writeFileSync(join(mc, 'launcher_profiles.json'), '{}')
    const before = snapshot(mc)

    const copy = await backupMinecraftOnce(mc, data)
    expect(copy).not.toBeNull()
    expect(readFileSync(join(copy!, 'options.txt'), 'utf8')).toBe('fov:0.5\n')
    expect(existsSync(join(copy!, 'servers.dat'))).toBe(true)
    expect(existsSync(join(copy!, 'config', 'sodium', 'options.json'))).toBe(true)
    // Worlds and mods aren't copied (too big, and nothing touches them).
    expect(existsSync(join(copy!, 'saves'))).toBe(false)
    expect(existsSync(join(copy!, 'mods'))).toBe(false)

    expect(await backupMinecraftOnce(mc, data)).toBeNull() // only once
    expect(snapshot(mc)).toEqual(before) // .minecraft is exactly as it was
  })
})
