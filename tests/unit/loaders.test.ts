import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import yazl from 'yazl'

// The modules under test read the app version for the User-Agent at load time.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false } }))

const { neoForgeMinecraft } = await import('../../src/main/loaders/meta')
const { extractOverrides, readModpack, safeRelative } = await import('../../src/main/loaders/mrpack')
const { inspectForgeInstaller } = await import('../../src/main/loaders/forge')

const dir = mkdtempSync(join(tmpdir(), 'kairo-unit-'))
const SHA512 = 'a'.repeat(128)

/** Writes a zip with the given entries and returns its path. */
async function zip(name: string, entries: Record<string, string>): Promise<string> {
  const file = join(dir, name)
  const z = new yazl.ZipFile()
  for (const [path, content] of Object.entries(entries)) z.addBuffer(Buffer.from(content), path)
  z.end()
  await new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => {
      writeFileSync(file, Buffer.concat(chunks))
      resolve()
    })
    z.outputStream.on('error', reject)
  })
  return file
}

const index = (files: unknown[], deps: Record<string, string> = { minecraft: '1.20.1', 'fabric-loader': '0.16.10' }) =>
  JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Test pack', versionId: '1.0', files, dependencies: deps })

const sodium = {
  path: 'mods/sodium.jar',
  hashes: { sha1: 'b'.repeat(40), sha512: SHA512 },
  downloads: ['https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar'],
  fileSize: 10
}

describe('NeoForge version numbers', () => {
  it.each([
    ['21.1.265', '1.21.1'],
    ['21.0.167', '1.21'],
    ['20.4.237', '1.20.4'],
    ['26.3.0.101', '26.3'],
    ['26.1.2.126', '26.1.2'],
    ['21.4.0-beta', '1.21.4']
  ])('%s is for Minecraft %s', (v, mc) => expect(neoForgeMinecraft(v)).toBe(mc))

  it('ignores versions that are not real releases', () => {
    expect(neoForgeMinecraft('0.25w14craftmine.3-beta')).toBeNull()
    expect(neoForgeMinecraft('47.1.0')).toBeNull()
  })
})

describe('safeRelative', () => {
  it.each(['mods/a.jar', 'config/x/y.json', 'resourcepacks/p.zip'])('accepts %s', (p) => expect(safeRelative(p)).not.toBeNull())
  it.each(['../evil.jar', 'mods/../../evil', '/etc/passwd', 'C:\\Windows\\evil.dll', 'C:evil', '\\\\server\\share', 'a\0b', '.', ''])(
    'rejects %s',
    (p) => expect(safeRelative(p)).toBeNull()
  )
})

describe('modpacks', () => {
  it('reads a Fabric pack and its files', async () => {
    const pack = await readModpack(await zip('ok.mrpack', { 'modrinth.index.json': index([sodium]) }))
    expect(pack).toMatchObject({ name: 'Test pack', mc: '1.20.1', loader: 'fabric', loaderVersion: '0.16.10' })
    expect(pack.files[0]).toMatchObject({ filename: join('mods', 'sodium.jar'), hash: { algorithm: 'sha512', value: SHA512 } })
  })

  it('skips files only meant for servers', async () => {
    const pack = await readModpack(await zip('env.mrpack', { 'modrinth.index.json': index([{ ...sodium, env: { client: 'unsupported' } }]) }))
    expect(pack.files).toHaveLength(0)
  })

  it('refuses a file path outside the install folder', async () => {
    const evil = { ...sodium, path: '../../evil.jar' }
    await expect(readModpack(await zip('slip.mrpack', { 'modrinth.index.json': index([evil]) }))).rejects.toThrow(/outside its folder/)
  })

  it('refuses downloads from services the launcher does not talk to', async () => {
    const foreign = { ...sodium, downloads: ['https://example.com/sodium.jar'] }
    await expect(readModpack(await zip('host.mrpack', { 'modrinth.index.json': index([foreign]) }))).rejects.toThrow(/example\.com/)
  })

  it('refuses plain http, even from Modrinth', async () => {
    const http = { ...sodium, downloads: ['http://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar'] }
    await expect(readModpack(await zip('http.mrpack', { 'modrinth.index.json': index([http]) }))).rejects.toThrow(/only downloads modpack files from Modrinth/)
  })

  it('refuses GitHub files too: modpacks come from Modrinth only', async () => {
    const github = { ...sodium, downloads: ['https://objects.githubusercontent.com/github-production-release-asset/1/sodium.jar'] }
    await expect(readModpack(await zip('github.mrpack', { 'modrinth.index.json': index([github]) }))).rejects.toThrow(/objects\.githubusercontent\.com/)
  })

  it('needs a SHA-512 for every file', async () => {
    const nohash = { ...sodium, hashes: { sha1: 'b'.repeat(40) } }
    await expect(readModpack(await zip('hash.mrpack', { 'modrinth.index.json': index([nohash]) }))).rejects.toThrow(/SHA-512/)
  })

  it('says clearly that Quilt is not supported', async () => {
    const file = await zip('quilt.mrpack', { 'modrinth.index.json': index([], { minecraft: '1.20.1', 'quilt-loader': '0.20' }) })
    await expect(readModpack(file)).rejects.toThrow(/Quilt/)
  })

  it('unpacks overrides into the install folder only', async () => {
    const file = await zip('over.mrpack', {
      'modrinth.index.json': index([]),
      'overrides/options.txt': 'fov:90',
      'client-overrides/config/a.json': '{}'
    })
    const target = mkdtempSync(join(tmpdir(), 'kairo-pack-'))
    await extractOverrides(file, target)
    expect(readFileSync(join(target, 'options.txt'), 'utf8')).toBe('fov:90')
    expect(readFileSync(join(target, 'config', 'a.json'), 'utf8')).toBe('{}')
  })

  it('refuses overrides that escape the install folder', async () => {
    // yazl won't write "../" names, so write a same-length placeholder and patch the bytes, as an attacker would.
    const file = await zip('over-evil.mrpack', { 'modrinth.index.json': index([]), 'overrides/XX/XX/evil.txt': 'x' })
    const bytes = readFileSync(file)
    const patched = Buffer.from(bytes.toString('latin1').split('overrides/XX/XX/').join('overrides/../../'), 'latin1')
    writeFileSync(file, patched)
    const target = mkdtempSync(join(tmpdir(), 'kairo-pack-'))
    await expect(extractOverrides(file, target)).rejects.toThrow(/outside its folder/)
    expect(existsSync(join(target, '..', '..', 'evil.txt'))).toBe(false)
  })
})

describe('Forge installers', () => {
  it('reads a modern installer', async () => {
    const profile = JSON.stringify({ minecraft: '1.20.1', version: '1.20.1-forge-47.4.0', path: 'net.minecraftforge:forge:1.20.1-47.4.0:shim' })
    const info = await inspectForgeInstaller(await zip('forge-new.jar', { 'install_profile.json': profile }))
    expect(info).toEqual({ mc: '1.20.1', artifactVersion: '1.20.1-47.4.0', forgeVersion: '47.4.0' })
  })

  it('reads a legacy installer (1.12.2)', async () => {
    const profile = JSON.stringify({ install: { path: 'net.minecraftforge:forge:1.12.2-14.23.5.2859', minecraft: '1.12.2' } })
    const info = await inspectForgeInstaller(await zip('forge-old.jar', { 'install_profile.json': profile }))
    expect(info).toEqual({ mc: '1.12.2', artifactVersion: '1.12.2-14.23.5.2859', forgeVersion: '14.23.5.2859' })
  })

  it('rejects a jar that is not a Forge installer', async () => {
    await expect(inspectForgeInstaller(await zip('other.jar', { 'fabric.mod.json': '{}' }))).rejects.toThrow(/isn't a Forge installer/)
  })
})
