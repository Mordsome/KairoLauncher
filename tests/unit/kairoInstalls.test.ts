import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'kairo-adopt-'))
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false } }))

const { adoptKairoInstalls, createKairoInstall, listCustom, toInfo } = await import('../../src/main/installs/custom')

const installs = join(data, 'installs')
const jar = { project: 'kairo', name: 'Kairo Client', version: '0.2.0', filename: 'kairo-0.2.0.jar', url: 'https://github.com/Mordsome/Kairo/releases/download/v0.2.0/kairo-0.2.0.jar', hash: { algorithm: 'sha256', value: 'a'.repeat(64) } }
const api = { project: 'fabric-api', name: 'Fabric API', version: '0.165.2+26.3', filename: 'fabric-api.jar', url: 'https://cdn.modrinth.com/data/x/fabric-api.jar', hash: { algorithm: 'sha512', value: 'b'.repeat(128) } }

describe('Kairo installs become regular installs', () => {
  it('converts the old Kairo folder in place and makes a fresh Kairo Void once', async () => {
    mkdirSync(join(installs, 'Kairo', 'saves', 'My World'), { recursive: true })
    writeFileSync(join(installs, 'Kairo', 'saves', 'My World', 'level.dat'), 'world')
    writeFileSync(
      join(installs, 'Kairo', 'kairo-launcher.json'),
      JSON.stringify({ schema: 1, edition: 'kairo', mc: '26.3', loader: '0.20.1', kairo: jar, mods: [api], keepUpdated: false, lastPlayed: 123, playMinutes: 90 })
    )

    await adoptKairoInstalls()
    const list = await listCustom()
    const kairo = list.find((r) => r.kairo?.edition === 'kairo')!
    expect(kairo).toMatchObject({ name: 'Kairo', folder: 'Kairo', mc: '26.3', loader: 'fabric', loaderVersion: '0.20.1', lastPlayed: 123, playMinutes: 90 })
    expect(kairo.kairo).toMatchObject({ keepUpdated: false, jar: { filename: 'kairo-0.2.0.jar' }, deps: [{ project: 'fabric-api' }] })
    expect(readFileSync(join(installs, 'Kairo', 'saves', 'My World', 'level.dat'), 'utf8')).toBe('world')
    expect(toInfo(kairo).kairo).toEqual({ edition: 'kairo', keepUpdated: false, version: '0.2.0' })

    const voidInstall = list.find((r) => r.kairo?.edition === 'void')!
    expect(voidInstall).toMatchObject({ name: 'Kairo Void', loader: 'fabric', kairo: { edition: 'void', keepUpdated: true, jar: null } })
  })

  it('runs only once: a deleted Kairo install stays deleted', async () => {
    const voidInstall = (await listCustom()).find((r) => r.kairo?.edition === 'void')!
    rmSync(join(installs, voidInstall.folder!), { recursive: true, force: true })
    await adoptKairoInstalls()
    expect((await listCustom()).some((r) => r.kairo?.edition === 'void')).toBe(false)
    expect(existsSync(join(installs, '.kairo-installs'))).toBe(true)
  })

  it('makes as many Kairo installs as wanted, each in its own folder', async () => {
    const a = await createKairoInstall('kairo', 'Kairo PvP')
    const b = await createKairoInstall('kairo', 'Kairo PvP')
    expect(a.folder).toBe('Kairo PvP')
    expect(b.folder).toBe('Kairo PvP (2)')
    expect((await listCustom()).filter((r) => r.kairo?.edition === 'kairo')).toHaveLength(3)
  })
})
