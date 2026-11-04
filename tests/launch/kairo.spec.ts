import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Installs and plays Kairo and Kairo Void for real (dev offline account),
// and checks the rules: one Kairo jar per install, player files kept,
// "Keep Kairo updated" off pins versions, on updates them together.

const SHOTS = join('test-results', 'launch')
mkdirSync(SHOTS, { recursive: true })
const UA = { 'User-Agent': 'KairoLauncher-tests (github.com/Mordsome/KairoLauncher)' }

let app: ElectronApplication
let page: Page
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
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click()
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 10_000 })
  // Keep the launcher on screen during these runs.
  await page.getByRole('button', { name: 'Settings' }).click()
  const hide = page.getByRole('switch', { name: 'Hide the launcher while playing' })
  if ((await hide.getAttribute('aria-checked')) === 'true') await hide.click()
  await page.getByRole('button', { name: 'Home' }).click()
})

test.afterAll(async () => {
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
