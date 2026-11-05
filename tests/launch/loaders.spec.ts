import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yazl from 'yazl'
import type { CreateResult, CustomInstallInfo } from '../../src/shared/api'

// Phase 5: real installs and launches for every "Other" loader, plus modpacks.
// The test stands in for the player where the player would act: it answers
// the file dialog, and fetches the Forge installer a player would download.

const SHOTS = join('test-results', 'launch')
const WORK = resolve('test-results', 'loader-files')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(WORK, { recursive: true })
const UA = { 'User-Agent': 'KairoLauncher-tests (github.com/Mordsome/KairoLauncher)' }

let app: ElectronApplication
let page: Page
let userData = ''
const problems: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await page.getByRole('button', { name: 'Continue with the offline dev account' }).click()
  // Catch pages the launcher would open in the browser.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    ;(shell as { openExternal: (url: string) => Promise<void> }).openExternal = async (url: string) => void g.opened.push(url)
  })
})

test.afterAll(async () => {
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  await app?.close()
})

/** The next file dialog returns this file, as if the player picked it. */
async function nextPick(file: string) {
  await app.evaluate(({ dialog }, picked) => {
    ;(dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, file)
}

const opened = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)

async function playAndCheck(install: CustomInstallInfo, expectInLog: RegExp[]) {
  const dir = join(userData, 'installs', install.name)
  const log = join(dir, 'logs', 'latest.log')
  if (existsSync(log)) rmSync(log)
  await page.evaluate(
    (id) =>
      window.kairo.game.play({ target: { kind: 'custom', id }, memoryGB: 4, javaPath: null, fullscreen: false, hideWhilePlaying: false }),
    install.id
  )
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        if (state.crash) throw new Error('The game crashed')
        return state.phase
      },
      { timeout: 40 * 60_000, intervals: [2000] }
    )
    .toBe('running')
  await expect
    .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 5 * 60_000, intervals: [2000] })
    .toMatch(/Sound engine started|Created: \d+x\d+/)
  const text = readFileSync(log, 'utf8')
  for (const re of expectInLog) expect(text).toMatch(re)
  const state = await page.evaluate(() => window.kairo.game.state())
  expect(state.crash).toBeNull()
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')
}

function created(r: CreateResult): CustomInstallInfo {
  if (!r.ok) throw new Error(r.cancelled ? 'cancelled' : `${r.error.title}: ${r.error.message}`)
  return r.install
}

async function forgeInstaller(mc: string): Promise<string> {
  const promos = (await (await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { headers: UA })).json()) as {
    promos: Record<string, string>
  }
  const v = promos.promos[`${mc}-recommended`] ?? promos.promos[`${mc}-latest`]!
  const av = `${mc}-${v}`
  const file = join(WORK, `forge-${av}-installer.jar`)
  if (!existsSync(file)) {
    const res = await fetch(`https://maven.minecraftforge.net/net/minecraftforge/forge/${av}/forge-${av}-installer.jar`, { headers: UA })
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}

async function zipTo(file: string, entries: Record<string, string>) {
  const z = new yazl.ZipFile()
  for (const [p, c] of Object.entries(entries)) z.addBuffer(Buffer.from(c), p)
  z.end()
  const chunks: Buffer[] = []
  await new Promise<void>((done, fail) => {
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => done())
    z.outputStream.on('error', fail)
  })
  writeFileSync(file, Buffer.concat(chunks))
}

test('Fabric 1.20.1 with Sodium, Iris and Lithium, built in the picker', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Other/ }).click()
  await page.getByRole('radio', { name: 'Fabric' }).click()
  await page.getByRole('radio', { name: '1.20.1', exact: true }).click()
  for (const name of ['Sodium', 'Iris', 'Lithium']) {
    const box = page.getByRole('checkbox', { name: new RegExp(`^${name}`) })
    await expect(box).toBeVisible({ timeout: 20_000 })
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
  }
  await page.screenshot({ path: join(SHOTS, 'other-fabric.png') })
  await page.getByRole('button', { name: 'Create Fabric 1.20.1' }).click()
  await expect(page.getByRole('heading', { name: 'Fabric', exact: true })).toBeVisible()
  const install = (await page.evaluate(() => window.kairo.installs.list())).find((i) => i.loader === 'fabric' && i.mc === '1.20.1')!
  expect(install.extras.sort()).toEqual(['iris', 'lithium', 'sodium'])
  await playAndCheck(install, [/\bsodium\b/, /\biris\b/, /\blithium\b/])
  const after = (await page.evaluate(() => window.kairo.installs.list())).find((i) => i.id === install.id)!
  expect(after.installed).toBe(true)
  expect(after.mods.map((m) => m.name).join(' ')).toMatch(/Sodium.*|Iris/)
})

test('NeoForge with Sodium', async () => {
  const versions = await page.evaluate(() => window.kairo.loaders.versions('neoforge'))
  const mc = versions.mcs.includes('1.21.1') ? '1.21.1' : versions.mcs[0]!
  const extras = await page.evaluate((v) => window.kairo.loaders.extras('neoforge', v), mc)
  expect(extras.map((x) => x.id)).toContain('sodium')
  const install = created(await page.evaluate((v) => window.kairo.installs.create({ loader: 'neoforge', mc: v, extras: ['sodium'] }), mc))
  expect(install.loaderVersion).toBe(versions.loaderVersions[mc])
  await playAndCheck(install, [/neoforge/i, /\bsodium\b/])
})

test('Forge refuses a broken or fake installer', async () => {
  const good = await forgeInstaller('1.20.1')
  const av = /forge-(.+)-installer\.jar$/.exec(good)![1]!

  // A damaged download: not even a valid jar any more.
  const broken = join(WORK, 'broken-installer.jar')
  copyFileSync(good, broken)
  appendFileSync(broken, Buffer.from('tampered'))
  await nextPick(broken)
  let r = await page.evaluate(() => window.kairo.installs.create({ loader: 'forge', mc: '1.20.1', extras: [] }))
  expect(r.ok).toBe(false)

  // A fake that claims to be that exact Forge: only the checksum can catch it.
  const fake = join(WORK, `fake-forge-${av}-installer.jar`)
  await zipTo(fake, { 'install_profile.json': JSON.stringify({ minecraft: '1.20.1', path: `net.minecraftforge:forge:${av}:shim` }) })
  await nextPick(fake)
  r = await page.evaluate(() => window.kairo.installs.create({ loader: 'forge', mc: '1.20.1', extras: [] }))
  expect(r.ok).toBe(false)
  if (!r.ok && !r.cancelled) expect(r.error.message).toMatch(/doesn't match the one Forge publishes/)
})

for (const mc of ['1.20.1', '1.12.2']) {
  test(`Forge ${mc}, from the installer the player picks`, async () => {
    await page.evaluate((v) => window.kairo.loaders.openDownloadPage('forge', v), mc)
    expect((await opened()).at(-1)).toBe(`https://files.minecraftforge.net/net/minecraftforge/forge/index_${mc}.html`)
    await nextPick(await forgeInstaller(mc))
    const install = created(await page.evaluate((v) => window.kairo.installs.create({ loader: 'forge', mc: v, extras: [] }), mc))
    expect(install.mc).toBe(mc)
    await playAndCheck(install, [/forge/i])
  })
}

test('OptiFine: opens optifine.net, and refuses a file that is not OptiFine', async () => {
  await page.evaluate(() => window.kairo.loaders.openDownloadPage('optifine', '1.20.1'))
  expect((await opened()).at(-1)).toBe('https://optifine.net/downloads')
  await nextPick(await forgeInstaller('1.20.1'))
  const r = await page.evaluate(() => window.kairo.installs.create({ loader: 'optifine', mc: '1.20.1', extras: [] }))
  expect(r.ok).toBe(false)
  if (!r.ok && !r.cancelled) expect(r.error.message).toMatch(/isn't an OptiFine installer/)
})

test('modpack: imports a .mrpack with a Modrinth mod and overrides, and plays it', async () => {
  const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent('["1.20.1"]')}`
  const [v] = (await (await fetch(`https://api.modrinth.com/v2/project/sodium/version?${q}`, { headers: UA })).json()) as {
    files: { url: string; filename: string; size: number; primary: boolean; hashes: { sha1: string; sha512: string } }[]
  }[]
  const f = v!.files.find((x) => x.primary) ?? v!.files[0]!
  const loader = ((await (await fetch('https://meta.fabricmc.net/v2/versions/loader/1.20.1', { headers: UA })).json()) as { loader: { version: string; stable: boolean } }[]).find((l) => l.loader.stable)!.loader.version
  const pack = join(WORK, 'test-pack.mrpack')
  await zipTo(pack, {
    'modrinth.index.json': JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      name: 'Kairo Test Pack',
      versionId: '1.0.0',
      files: [{ path: `mods/${f.filename}`, hashes: f.hashes, downloads: [f.url], fileSize: f.size }],
      dependencies: { minecraft: '1.20.1', 'fabric-loader': loader }
    }),
    'overrides/options.txt': 'fov:0.5\n',
    'overrides/config/kairo-test.json': '{"ok":true}'
  })
  await nextPick(pack)
  const install = created(await page.evaluate(() => window.kairo.installs.importModpack()))
  expect(install.modpack).toEqual({ name: 'Kairo Test Pack', version: '1.0.0' })
  const dir = join(userData, 'installs', install.name)
  expect(readFileSync(join(dir, 'config', 'kairo-test.json'), 'utf8')).toBe('{"ok":true}')
  await playAndCheck(install, [/\bsodium\b/])
  expect(existsSync(join(dir, 'mods', f.filename))).toBe(true)
})

test('modpack: refuses one that downloads from somewhere else', async () => {
  const pack = join(WORK, 'foreign.mrpack')
  await zipTo(pack, {
    'modrinth.index.json': JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      name: 'Foreign',
      files: [{ path: 'mods/x.jar', hashes: { sha1: 'a'.repeat(40), sha512: 'a'.repeat(128) }, downloads: ['https://example.com/x.jar'] }],
      dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.10' }
    })
  })
  await nextPick(pack)
  const r = await page.evaluate(() => window.kairo.installs.importModpack())
  expect(r.ok).toBe(false)
  if (!r.ok && !r.cancelled) expect(r.error.message).toMatch(/example\.com/)
  expect((await page.evaluate(() => window.kairo.installs.list())).some((i) => i.name.startsWith('Foreign'))).toBe(false)
})

test('Library lists the new installs; no console errors', async () => {
  await page.evaluate(() => undefined)
  await page.getByRole('button', { name: 'Library' }).click()
  await expect(page.getByRole('button', { name: /^Kairo Test Pack/ })).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, 'library-custom.png') })
  expect(problems).toEqual([])
})
