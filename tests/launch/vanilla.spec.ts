import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Downloads, checks and launches real vanilla versions with the dev offline
// account, then confirms in the game's own log that it got through start-up.

const VERSIONS = ['26.3', '1.20.1', '1.12.2', '1.8.9']
const SHOTS = join('test-results', 'launch')
mkdirSync(SHOTS, { recursive: true })

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
  await expect(page.getByRole('status')).toContainText('Offline dev account')
})

test.afterAll(async () => {
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

for (const mc of VERSIONS) {
  test(`plays Minecraft ${mc}`, async () => {
    // Keep the launcher visible for most runs; check hiding on the last one.
    const hide = mc === VERSIONS[VERSIONS.length - 1]
    await setHide(hide)

    await page.getByRole('button', { name: /Choose what to play/ }).click()
    await page.getByRole('radio', { name: /^Vanilla/ }).click()
    await page.getByRole('button', { name: /More versions/ }).click()
    await page.getByRole('radio', { name: mc, exact: true }).click()

    const log = join(userData, 'installs', `vanilla-${mc}`, 'logs', 'latest.log')
    if (existsSync(log)) rmSync(log)

    const started = Date.now()
    await page.getByRole('button', { name: new RegExp(`^Play Minecraft on Minecraft ${mc.replace(/\./g, '\\.')}`) }).click()
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
      .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 3 * 60_000, intervals: [2000] })
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
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Vanilla/ }).click()
  await page.getByRole('button', { name: /More versions/ }).click()
  await page.getByRole('radio', { name: mc, exact: true }).click()
  await page.getByRole('button', { name: /^Play Minecraft on Minecraft 1\.8\.9/ }).click()
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
