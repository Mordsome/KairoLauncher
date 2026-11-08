import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import yazl from 'yazl'

// Installs and plays Kairo and Kairo Void for real (dev offline account),
// and checks the rules: one Kairo jar per install, player files kept,
// "Keep Kairo updated" off pins versions, on updates them together.

const SHOTS = join('test-results', 'launch')
// A stand-in for Minecraft's own .minecraft (never the real one): dev builds read KAIRO_DEV_MINECRAFT_DIR.
const FAKE_MC = resolve('test-results', 'fake-minecraft', '.minecraft')
mkdirSync(FAKE_MC, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
const UA = { 'User-Agent': 'KairoLauncher-tests (github.com/Mordsome/KairoLauncher)' }

// The launch tests' own data folder (game files are downloaded once and reused). Never this
// PC's real launcher data: no real accounts, installs or settings are touched, and it sits
// outside AppData, which Windows can redirect for apps started from another app.
const LAUNCH_DATA = resolve('test-results', 'launch-data')
mkdirSync(LAUNCH_DATA, { recursive: true })

let app: ElectronApplication
let page: Page
/** This PC's settings before the run; put back at the end. */
let savedSettings: unknown = null

/** "Continue with the offline dev account", when the sign-in screen shows (nobody signed in). */
async function continueOffline() {
  const offline = page.getByRole('button', { name: 'Continue with the offline dev account' })
  await offline.waitFor({ timeout: 5000 }).then(
    () => offline.click(),
    () => undefined
  )
}
let userData = ''
const problems: string[] = []

interface Record {
  mc: string
  loader: string
  keepUpdated: boolean
  kairo: { filename: string; version: string }
  mods: { project: string; version: string; filename: string; url: string; hash: { algorithm: string; value: string } }[]
}

const dir = (edition: 'kairo' | 'void') => join(userData, 'installs', edition === 'kairo' ? 'Kairo' : 'Kairo Void')
const mods = (edition: 'kairo' | 'void') => readdirSync(join(dir(edition), 'mods')).sort()
const record = (edition: 'kairo' | 'void') => JSON.parse(readFileSync(join(dir(edition), 'kairo-launcher.json'), 'utf8')) as Record

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${LAUNCH_DATA}`], env: { ...env, KAIRO_DEV_ACCOUNT: 'offline', KAIRO_DEV_MINECRAFT_DIR: FAKE_MC } })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  userData = await app.evaluate(({ app }) => app.getPath('userData'))
  savedSettings = await page.evaluate(() => window.kairo.settings.get())
  await continueOffline()
  // Keep the launcher on screen during these runs.
  await page.getByRole('button', { name: 'Settings' }).click()
  const hide = page.getByRole('switch', { name: 'Hide the launcher while playing' })
  if ((await hide.getAttribute('aria-checked')) === 'true') await hide.click()
  await page.getByRole('button', { name: 'Home' }).click()
})

test.afterAll(async () => {
  if (savedSettings) await page?.evaluate((s) => window.kairo.settings.set(s as never), savedSettings).catch(() => undefined)
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  await app?.close()
})

async function pick(edition: 'kairo' | 'void') {
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: edition === 'kairo' ? /^Kairo/ : /^Void/ }).first().click()
  const title = edition === 'kairo' ? 'Kairo' : 'Kairo Void'
  await page.getByRole('button', { name: new RegExp(`^${title} for Minecraft`) }).first().click()
}

/** Plays the selected install until the game's own log shows it started with Kairo loaded. */
async function playAndCheck(edition: 'kairo' | 'void', shot?: string) {
  const log = join(dir(edition), 'logs', 'latest.log')
  if (existsSync(log)) rmSync(log)
  await page.getByRole('button', { name: /^Play Kairo/ }).click()
  // The first Kairo Void install asks the player to read a photosensitivity warning.
  const warning = page.getByRole('dialog', { name: 'Photosensitivity warning' })
  if (await warning.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await warning.getByRole('button', { name: 'I understand, install' }).click()
  }
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        if (state.crash) throw new Error('The game crashed')
        return state.phase
      },
      { timeout: 30 * 60_000, intervals: [2000] }
    )
    .toBe('running')
  if (shot) await page.screenshot({ path: join(SHOTS, shot) })
  await expect
    .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 4 * 60_000, intervals: [2000] })
    .toMatch(/Sound engine started|Created: \d+x\d+/)
  const text = readFileSync(log, 'utf8')
  // Fabric lists the mods it loaded.
  expect(text).toMatch(/\bkairo\b/)
  expect(text).toMatch(/\bsodium\b/)
  expect(text).toMatch(/fabric-api/)
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')
  const after = await page.evaluate(() => window.kairo.game.state())
  expect(after.crash).toBeNull()
  expect(after.error).toBeNull()
}

test('plays Kairo', async () => {
  await pick('kairo')
  await playAndCheck('kairo', 'running-kairo.png')
  const files = mods('kairo')
  expect(files.filter((f) => /^kairo-\d/.test(f))).toHaveLength(1)
  expect(files.some((f) => f.startsWith('kairo-void-'))).toBe(false)
  expect(files.some((f) => f.startsWith('fabric-api-'))).toBe(true)
  expect(files.some((f) => f.startsWith('sodium-'))).toBe(true)
  const r = record('kairo')
  expect(r.mc).toBe('26.3')
  console.log(`Kairo ${r.kairo.version} on ${r.mc}, Fabric Loader ${r.loader}, ${r.mods.map((m) => `${m.project} ${m.version}`).join(', ')}`)
})

test('plays Kairo Void, in the Void theme', async () => {
  await pick('void')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'void')
  await playAndCheck('void', 'running-void.png')
  const files = mods('void')
  expect(files.filter((f) => f.startsWith('kairo-void-'))).toHaveLength(1)
  expect(files.some((f) => /^kairo-\d/.test(f))).toBe(false)
})

test('never both Kairo jars in one install; player files stay', async () => {
  const voidJar = mods('void').find((f) => f.startsWith('kairo-void-'))!
  copyFileSync(join(dir('void'), 'mods', voidJar), join(dir('kairo'), 'mods', voidJar))
  writeFileSync(join(dir('kairo'), 'mods', 'my-notes.txt'), 'a file the player put here')

  await pick('kairo')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'kairo')
  await playAndCheck('kairo')
  const files = mods('kairo')
  expect(files).not.toContain(voidJar)
  expect(files).toContain('my-notes.txt')
})

test('"Keep Kairo updated" off pins versions; on updates them', async () => {
  // Pretend this install has an older Fabric API.
  const query = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent('["26.3"]')}`
  const versions = (await (await fetch(`https://api.modrinth.com/v2/project/fabric-api/version?${query}`, { headers: UA })).json()) as {
    version_number: string
    version_type: string
    files: { url: string; filename: string; primary: boolean; hashes: { sha512: string } }[]
  }[]
  const releases = versions.filter((v) => v.version_type === 'release')
  const latest = releases[0]!
  const older = releases[1]!
  const olderFile = older.files.find((f) => f.primary) ?? older.files[0]!

  const r = record('kairo')
  const current = r.mods.find((m) => m.project === 'fabric-api')!
  expect(current.filename).toBe((latest.files.find((f) => f.primary) ?? latest.files[0]!).filename)
  rmSync(join(dir('kairo'), 'mods', current.filename))
  r.mods = r.mods.map((m) =>
    m.project === 'fabric-api'
      ? { ...m, version: older.version_number, filename: olderFile.filename, url: olderFile.url, hash: { algorithm: 'sha512', value: olderFile.hashes.sha512 } }
      : m
  )
  writeFileSync(join(dir('kairo'), 'kairo-launcher.json'), JSON.stringify(r, null, 2))

  // Off: the launcher keeps (and downloads, verified) exactly the recorded version.
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByRole('button', { name: /^Kairo 26\.3/ }).click()
  await page.evaluate(() => window.kairo.kairo.setKeepUpdated('kairo', false))
  await pick('kairo')
  await playAndCheck('kairo')
  expect(mods('kairo')).toContain(olderFile.filename)
  expect(record('kairo').keepUpdated).toBe(false)

  // On: the next Play moves Fabric API to the newest release again and removes the old file.
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByRole('button', { name: /^Kairo 26\.3/ }).click()
  const box = page.getByRole('checkbox', { name: /Keep Kairo updated/ })
  await expect(box).not.toBeChecked()
  await box.check()
  await expect.poll(() => record('kairo').keepUpdated).toBe(true)
  await pick('kairo')
  await playAndCheck('kairo')
  const files = mods('kairo')
  expect(files).not.toContain(olderFile.filename)
  expect(files).toContain((latest.files.find((f) => f.primary) ?? latest.files[0]!).filename)
})

test('Library shows the real install, and no console errors', async () => {
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByRole('button', { name: /^Kairo 26\.3/ }).click()
  await expect(page.getByText('Installed for you')).toBeVisible()
  await expect(page.locator('.mod-row', { hasText: 'Fabric Loader' })).toBeVisible()
  await expect(page.locator('.mod-row', { hasText: 'Sodium' })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, 'library-kairo.png') })
  expect(problems).toEqual([])
})

/** Every file under a folder with its size, time and content hash. */
function snapshot(dir: string): { [path: string]: string } {
  const out: { [path: string]: string } = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out[relative(dir, p)] = `${st.size}:${st.mtimeMs}:${createHash('sha1').update(readFileSync(p)).digest('hex')}`
    }
  }
  walk(dir)
  return out
}

async function zipTo(path: string, entries: { [name: string]: string }) {
  const z = new yazl.ZipFile()
  for (const [p, c] of Object.entries(entries)) z.addBuffer(Buffer.from(c), p)
  z.end()
  const chunks: Buffer[] = []
  await new Promise<void>((done, fail) => {
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => done())
    z.outputStream.on('error', fail)
  })
  writeFileSync(path, Buffer.concat(chunks))
}

test('shares a .minecraft folder, never touching its mods', async () => {
  // A .minecraft with a world, settings, and a mod that would crash the game if it were ever loaded.
  rmSync(FAKE_MC, { recursive: true, force: true })
  mkdirSync(join(FAKE_MC, 'mods'), { recursive: true })
  mkdirSync(join(FAKE_MC, 'saves', 'Test World'), { recursive: true })
  writeFileSync(join(FAKE_MC, 'options.txt'), 'lang:en_us\n')
  writeFileSync(join(FAKE_MC, 'saves', 'Test World', 'level.dat'), 'world')
  await zipTo(join(FAKE_MC, 'mods', 'poison.jar'), {
    'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'kairo_poison_test', version: '1.0.0', entrypoints: { main: ['kairo.poison.DoesNotExist'] } })
  })
  const modsBefore = snapshot(join(FAKE_MC, 'mods'))
  const savesBefore = snapshot(join(FAKE_MC, 'saves'))
  const marker = join(userData, 'backups', 'minecraft-backup.json')
  const hadBackup = existsSync(marker)

  // Turned on the way a player does it.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Game' }).click()
  const share = page.getByRole('radio', { name: /Share with Minecraft/ })
  await expect(share).toBeEnabled()
  await share.click()
  await expect(share).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: join(SHOTS, 'game-folder-shared.png') })
  await pick('kairo')

  const log = join(FAKE_MC, 'logs', 'latest.log')
  await page.getByRole('button', { name: /^Play Kairo/ }).click()
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        if (state.crash) throw new Error('The game crashed')
        return state.phase
      },
      { timeout: 30 * 60_000, intervals: [2000] }
    )
    .toBe('running')
  // The game's own log is in .minecraft: it really ran there.
  await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 5 * 60_000, intervals: [2000] }).toMatch(/Sound engine started|Created: \d+x\d+/)
  const text = readFileSync(log, 'utf8')
  expect(text).toMatch(/\bkairo\b/)
  expect(text).not.toMatch(/kairo_poison_test/)
  expect((await page.evaluate(() => window.kairo.game.state())).crash).toBeNull()
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((st) => st.phase)), { timeout: 30_000 }).toBe('idle')

  // .minecraft/mods and the worlds are exactly as they were; Kairo's mods stayed in its own folder.
  expect(snapshot(join(FAKE_MC, 'mods'))).toEqual(modsBefore)
  expect(snapshot(join(FAKE_MC, 'saves'))).toEqual(savesBefore)
  expect(mods('kairo').some((m) => /^kairo-\d/.test(m))).toBe(true)

  // A copy of the settings was kept in the launcher's own folder before the first shared Play.
  if (!hadBackup) {
    expect(existsSync(marker)).toBe(true)
    const { folder } = JSON.parse(readFileSync(marker, 'utf8')) as { folder: string }
    expect(readFileSync(join(folder, 'options.txt'), 'utf8')).toBe('lang:en_us\n')
    // That copy was of the stand-in folder: remove it, so the real .minecraft still gets its own first backup.
    rmSync(folder, { recursive: true, force: true })
    rmSync(marker, { force: true })
  }

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Game' }).click()
  await page.getByRole('radio', { name: /Kairo's own folders/ }).click()
  await page.getByRole('button', { name: 'Home' }).click()
})
