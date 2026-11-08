import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Starts the packaged app (release/win-unpacked or release/linux-unpacked) on an
// empty data folder: it has to start, reach its native modules, know where its
// updates come from, and have no dev-only offline account.
// Run after `npm run dist:win` or `npm run dist:linux`: `npm run test:packaged`.

const unpacked = resolve('release', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const exe = join(unpacked, process.platform === 'win32' ? 'Kairo Launcher.exe' : 'kairo-launcher')
const resources = join(unpacked, 'resources')
const DATA = mkdtempSync(join(tmpdir(), 'kairo-packaged-'))
const SHOTS = join('test-results', 'packaged')
mkdirSync(SHOTS, { recursive: true })

let app: ElectronApplication
let page: Page
const problems: string[] = []

test.beforeAll(async () => {
  expect(existsSync(exe), `${exe} is missing: build it first`).toBe(true)
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${DATA}`] })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(DATA, { recursive: true, force: true })
})

test('starts on the sign-in screen, without the dev offline account', async () => {
  await expect(page.getByRole('heading', { name: 'Welcome to Kairo' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
  await expect(page.getByRole('button', { name: /offline dev account/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.kairo.app.info().then((i) => i.devOfflineName))).toBeNull()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, 'sign-in.png') })
})

test('reaches the OS secure store (native module unpacked)', async () => {
  // Reading accounts goes through the keyring module; an empty folder has none.
  const state = await page.evaluate(() => window.kairo.auth.state())
  expect(state.accounts).toEqual([])
  expect(existsSync(join(resources, 'app.asar.unpacked'))).toBe(true)
})

test('knows where its updates come from, and is allowed to check', async () => {
  const config = readFileSync(join(resources, 'app-update.yml'), 'utf8')
  expect(config).toMatch(/owner: Mordsome/)
  expect(config).toMatch(/repo: KairoLauncher/)
  expect(config).toMatch(/provider: github/)
  const state = await page.evaluate(() => window.kairo.app.update.state())
  expect(state.status).not.toBe('off')
})

test('an update check finishes, with a plain answer', async () => {
  const state = await page.evaluate(() => window.kairo.app.update.check())
  // "latest" or "downloading" once releases exist; a clear message while there are none.
  expect(['latest', 'downloading', 'ready', 'error']).toContain(state.status)
  if (state.status === 'error') expect(state.message).not.toMatch(/https?:|[\\/]/)
  console.log(`update check: ${state.status}${state.message ? ` (${state.message})` : ''}`)
})

test("the updater's network only reaches Mordsome on GitHub", async () => {
  const result = await app.evaluate(async ({ session }) => {
    const ses = session.fromPartition('electron-updater', { cache: false })
    const get = (url: string) =>
      ses.fetch(url, { method: 'HEAD' }).then(
        (r) => `ok ${r.status}`,
        () => 'blocked'
      )
    return {
      kairo: await get('https://github.com/Mordsome/Kairo/releases.atom'),
      otherRepo: await get('https://github.com/electron/electron/releases.atom'),
      otherSite: await get('https://example.com/')
    }
  })
  expect(result.kairo).toBe('ok 200')
  expect(result.otherRepo).toBe('blocked')
  expect(result.otherSite).toBe('blocked')
})

test('ships the licences', () => {
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) expect(existsSync(join(resources, f))).toBe(true)
})

test('no console errors', () => {
  expect(problems).toEqual([])
})
