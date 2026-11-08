import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'kairo-mods-'))
const trashed: string[] = []
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false },
  protocol: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), trashItem: async (p: string) => void trashed.push(p) }
}))

const { listMods, removeMod, setModEnabled } = await import('../../src/main/installs/mods')
const { downloadMods } = await import('../../src/main/loaders/extras')

const ID = 'abcdef012345'
const dir = join(data, 'installs', 'Fabric Test')
const mods = join(dir, 'mods')
const recordFile = join(dir, 'kairo-launcher.json')

function record(over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    kind: 'custom',
    id: ID,
    name: 'Fabric Test',
    createdAt: 1,
    mc: '1.20.1',
    loader: 'fabric',
    loaderVersion: null,
    installer: null,
    versionId: null,
    wanted: ['sodium', 'iris'],
    mods: [
      { project: 'sodium', name: 'Sodium', version: '0.5.13', filename: 'mods/sodium.jar', url: 'https://cdn.modrinth.com/data/x/sodium.jar', hash: { algorithm: 'sha512', value: 'a'.repeat(128) } },
      { project: 'iris', name: 'Iris', version: '1.7.6', filename: 'mods/iris.jar', url: 'https://cdn.modrinth.com/data/y/iris.jar', hash: { algorithm: 'sha512', value: 'b'.repeat(128) } }
    ],
    modpack: null,
    lastPlayed: null,
    playMinutes: 0,
    ...over
  }
}
const saved = () => JSON.parse(readFileSync(recordFile, 'utf8')) as ReturnType<typeof record>

beforeEach(() => {
  mkdirSync(mods, { recursive: true })
  writeFileSync(recordFile, JSON.stringify(record()))
  for (const f of ['sodium.jar', 'iris.jar', 'my-own-mod.jar']) writeFileSync(join(mods, f), 'not really a jar')
  for (const f of ['sodium.jar.disabled', 'iris.jar.disabled']) if (existsSync(join(mods, f))) writeFileSync(join(mods, f), '')
  trashed.length = 0
})

describe('the mod browser', () => {
  it("lists the launcher's mods and the player's own files", async () => {
    const list = await listMods(ID)
    expect(list.map((m) => [m.name, m.managed, m.enabled])).toEqual([
      ['Iris', true, true],
      ['my-own-mod', false, true],
      ['Sodium', true, true]
    ])
  })

  it('turns a mod off by renaming it, and Play keeps it off', async () => {
    const list = await setModEnabled(ID, 'iris.jar', false)
    expect(existsSync(join(mods, 'iris.jar'))).toBe(false)
    expect(existsSync(join(mods, 'iris.jar.disabled'))).toBe(true)
    expect(list.find((m) => m.file === 'iris.jar')?.enabled).toBe(false)
    expect(saved().mods.find((m) => m.project === 'iris')).toMatchObject({ disabled: true })

    // Play re-checks recorded files where they are: the turned-off one as .disabled.
    let planned: string[] = []
    const stage = { run: async (plan: { tasks: { files: { path: string }[] }[] }) => void (planned = plan.tasks[0]!.files.map((f) => f.path)) }
    await downloadMods(saved().mods as never, dir, stage as never, new AbortController().signal)
    expect(planned).toEqual([join(dir, 'mods/sodium.jar'), join(dir, 'mods/iris.jar.disabled')])

    await setModEnabled(ID, 'iris.jar', true)
    expect(existsSync(join(mods, 'iris.jar'))).toBe(true)
  })

  it("removes the launcher's mods for good and forgets them; the player's go to the Recycle Bin", async () => {
    await removeMod(ID, 'sodium.jar')
    expect(existsSync(join(mods, 'sodium.jar'))).toBe(false)
    expect(saved().mods.map((m) => m.project)).toEqual(['iris'])
    expect(saved().wanted).toEqual(['iris'])
    expect(trashed).toEqual([])

    await removeMod(ID, 'my-own-mod.jar')
    expect(trashed).toEqual([join(mods, 'my-own-mod.jar')])
  })

  it('refuses anything that is not a plain jar name in mods/', async () => {
    for (const bad of ['../evil.jar', 'sub/x.jar', 'C:\\evil.jar', 'x.exe', '.jar', '']) {
      await expect(setModEnabled(ID, bad, false), bad).rejects.toThrow()
      await expect(removeMod(ID, bad), bad).rejects.toThrow()
    }
  })

  it('only works for Fabric, NeoForge and Forge installs', async () => {
    writeFileSync(recordFile, JSON.stringify(record({ loader: 'vanilla', mods: [], wanted: [] })))
    await expect(listMods(ID)).rejects.toThrow(/Fabric, NeoForge and Forge/)
  })
})
