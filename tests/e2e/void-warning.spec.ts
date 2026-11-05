import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The photosensitivity warning before the first Kairo Void install. Runs on an
// empty data folder, so Kairo Void isn't installed and nothing real is touched.

let app: ElectronApplication
let page: Page
const data = mkdtempSync(join(tmpdir(), 'kairo-void-'))
const problems: string[] = []

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${data}`], env })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
})

test.afterAll(async () => {
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  await app?.close()
  rmSync(data, { recursive: true, force: true })
})

test('uses the empty data folder', async () => {
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  expect(userData).toBe(data)
})

test('warns before the first Kairo Void install', async () => {
  await page.getByRole('button', { name: 'Continue with the offline dev account' }).click()
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Void/ }).click()
  await page.getByRole('button', { name: /Kairo Void for Minecraft/ }).first().click()

  // "Not now" closes it and nothing downloads.
  await page.getByRole('button', { name: /^Play Kairo Void/ }).click()
  const warning = page.getByRole('dialog', { name: 'Photosensitivity warning' })
  await expect(warning).toBeVisible()
  await expect(warning.getByRole('button', { name: 'Not now' })).toBeFocused()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join('test-results', 'screens', '26-void-warning.png') })
  await warning.getByRole('button', { name: 'Not now' }).click()
  await expect(warning).toHaveCount(0)
  expect((await page.evaluate(() => window.kairo.game.state())).phase).toBe('idle')

  // Accepting saves that and starts the install (stopped straight away here).
  await page.getByRole('button', { name: /^Play Kairo Void/ }).click()
  await warning.getByRole('button', { name: 'I understand, install' }).click()
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase))).not.toBe('idle')
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.settings.get().then((s) => s.voidWarningSeen))).toBe(true)
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')

  // Once accepted, it isn't asked again.
  await page.getByRole('button', { name: /^Play Kairo Void/ }).click()
  await page.waitForTimeout(500)
  await expect(warning).toHaveCount(0)
  await page.evaluate(() => window.kairo.game.stop())
})

test('no console errors', () => {
  expect(problems).toEqual([])
})
