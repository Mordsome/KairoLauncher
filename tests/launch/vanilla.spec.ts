import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Downloads, checks and launches real vanilla versions with the dev offline
// account, then confirms in the game's own log that it got through start-up.

const VERSIONS = ['26.3', '1.20.1', '1.12.2', '1.8.9']
const SHOTS = join('test-results', 'launch')
mkdirSync(SHOTS, { recursive: true })

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

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${LAUNCH_DATA}`], env: { ...env, KAIRO_DEV_ACCOUNT: 'offline' } })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  userData = await app.evaluate(({ app }) => app.getPath('userData'))

  savedSettings = await page.evaluate(() => window.kairo.settings.get())
  await continueOffline()
  await expect(page.getByRole('status')).toContainText('Offline dev account')
})

test.afterAll(async () => {
  if (savedSettings) await page?.evaluate((s) => window.kairo.settings.set(s as never), savedSettings).catch(() => undefined)
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  await app?.close()
})

async function setHide(on: boolean) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Game' }).click()
  const toggle = page.getByRole('switch', { name: 'Hide the launcher while playing' })
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await page.getByRole('button', { name: 'Home' }).click()
}

/** The install for a Minecraft version: made with New install the first time, then picked in the picker. Returns its id. */
async function pickVanilla(mc: string): Promise<string> {
  const find = () =>
    page.evaluate((v) => window.kairo.installs.list().then((l) => l.find((i) => i.loader === 'vanilla' && i.mc === v)?.id ?? null), mc)
  if (!(await find())) {
    await page.getByRole('button', { name: 'Library' }).click()
    await page.getByRole('button', { name: 'New install', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New install' })
    await dialog.getByRole('radio', { name: /^Minecraft Plain/ }).click()
    await dialog.getByRole('button', { name: 'More…' }).click()
    await dialog.getByRole('radio', { name: mc, exact: true }).click()
    await dialog.getByRole('button', { name: /^Create / }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  }
  const id = (await find())!
  const name = await page.evaluate((i) => window.kairo.installs.list().then((l) => l.find((x) => x.id === i)!.name), id)
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: new RegExp(`^${name.replace(/[.()]/g, '\\$&')}, Minecraft`) }).click()
  return id
}

/** The game's own log, through the launcher's log view. */
const gameLog = (id: string) => page.evaluate((i) => window.kairo.game.logs(i).then((v) => v.lines.join('\n')), id)

for (const mc of VERSIONS) {
  test(`plays Minecraft ${mc}`, async () => {
    // Keep the launcher visible for most runs; check hiding on the last one.
    const hide = mc === VERSIONS[VERSIONS.length - 1]
    await setHide(hide)

    const id = await pickVanilla(mc)

    const started = Date.now()
    await page.getByRole('button', { name: new RegExp(`^Play .* on Minecraft ${mc.replace(/\./g, '\\.')}$`) }).click()
    await expect(page.getByRole('status')).toHaveText(/Downloading game files|Checking game files|Starting Minecraft|is running/, { timeout: 30_000 })

    // Errors show up on the status line; fail fast with their text.
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => window.kairo.game.state())
          if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
          return state.phase
        },
        { timeout: 40 * 60_000, intervals: [2000] }
      )
      .toBe('running')
    const ready = Math.round((Date.now() - started) / 1000)

    if (hide) {
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false)
    } else {
      await page.screenshot({ path: join(SHOTS, `running-${mc}.png`) })
    }

    // The game's own log proves it got past start-up: sound and textures loaded.
    await expect
      .poll(() => gameLog(id), { timeout: 3 * 60_000, intervals: [2000] })
      .toMatch(/Sound engine started|Created: \d+x\d+/)
    const state = await page.evaluate(() => window.kairo.game.state())
    expect(state.phase).toBe('running')
    console.log(`Minecraft ${mc}: running after ${ready}s`)

    await page.evaluate(() => window.kairo.game.stop())
    await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')
    const after = await page.evaluate(() => window.kairo.game.state())
    expect(after.crash).toBeNull()
    expect(after.error).toBeNull()
    if (hide) {
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true)
    }
  })
}

test('a corrupted game file is caught and replaced', async () => {
  const mc = '1.8.9'
  const dir = join(userData, 'game', 'versions', mc)
  const jar = join(dir, `${mc}.jar`)
  const expected = (JSON.parse(readFileSync(join(dir, `${mc}.json`), 'utf8')) as { downloads: { client: { sha1: string } } })
    .downloads.client.sha1
  const sha1 = () => createHash('sha1').update(readFileSync(jar)).digest('hex')
  expect(sha1()).toBe(expected)

  appendFileSync(jar, 'not part of Minecraft')
  expect(sha1()).not.toBe(expected)

  await setHide(false)
  await pickVanilla(mc)
  await page.getByRole('button', { name: /^Play .* on Minecraft 1\.8\.9$/ }).click()
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        return state.phase
      },
      { timeout: 5 * 60_000, intervals: [1000] }
    )
    .toBe('running')
  expect(sha1()).toBe(expected)
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')
})

test('version shows as Ready afterwards, and no console errors', async () => {
  const versions = await page.evaluate(() => window.kairo.game.versions())
  for (const mc of VERSIONS) expect(versions.ready).toContain(mc)
  expect(problems).toEqual([])
})
