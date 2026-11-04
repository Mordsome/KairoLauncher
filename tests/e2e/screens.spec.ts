import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Walks through every screen of the built app (mock data), saves a
// screenshot of each, and fails on any console error or CSP violation.

const SHOTS = join('test-results', 'screens')
mkdirSync(SHOTS, { recursive: true })

let app: ElectronApplication
let page: Page
const problems: string[] = []

async function shot(name: string) {
  await page.waitForTimeout(900) // let crossfades and slides finish
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test.beforeAll(async () => {
  // Run the built UI, never a dev server.
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('renderer is locked down', async () => {
  expect(page.url()).toBe('kairo://app/index.html')
  const exposed = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    api: Object.keys(window.kairo).sort()
  }))
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', api: ['app', 'window'] })

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    // Undocumented but present at runtime; reports the preferences the page really got.
    const contents = w.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences }
    const p = contents.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, size: w.getContentSize() }
  })
  expect(prefs.sandbox).toBe(true)
  expect(prefs.contextIsolation).toBe(true)
  expect(prefs.nodeIntegration).toBe(false)
  // 1280x760, or scaled down proportionally on small screens.
  const [w = 0, h = 0] = prefs.size
  expect(Math.abs(w / h - 1280 / 760)).toBeLessThan(0.01)
  expect(w).toBeLessThanOrEqual(1280)

  // Remote content is blocked in the renderer.
  const remote = await page.evaluate(() =>
    fetch('https://example.com/').then(
      () => 'loaded',
      () => 'blocked'
    )
  )
  expect(remote).toBe('blocked')
  problems.length = 0 // the blocked fetch above logs a CSP error on purpose

  // Off-list links are refused by the main process.
  expect(await page.evaluate(() => window.kairo.app.openExternal('https://example.com/'))).toBe(false)
  expect(await page.evaluate(() => window.kairo.app.openExternal('http://github.com/Mordsome/'))).toBe(false)
})

test('sign-in flow', async () => {
  await expect(page.getByRole('heading', { name: 'Welcome to Kairo' })).toBeVisible()
  await shot('01-sign-in')
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click()
  await expect(page.getByRole('heading', { name: 'Finish in your browser' })).toBeVisible()
  await shot('02-sign-in-wait')
  await expect(page.getByRole('heading', { name: 'Hi, Mordsome' })).toBeVisible({ timeout: 6000 })
  await shot('03-sign-in-done')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Kairo', exact: true })).toBeVisible()
  await shot('04-home-kairo')
})

test('picker: every edition', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await expect(page.getByRole('radio', { name: /^Kairo/ })).toBeFocused()
  await shot('05-picker-kairo')

  await page.getByRole('radio', { name: /^Void/ }).hover()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'void')
  await shot('06-picker-void')

  await page.getByRole('radio', { name: /^Lite/ }).hover()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'kairo')
  await shot('07-picker-lite')

  await page.getByRole('radio', { name: /^Vanilla/ }).hover()
  await shot('08-picker-vanilla')
  await page.getByRole('button', { name: /More versions/ }).click()
  await shot('09-picker-vanilla-all')
  await page.getByRole('button', { name: 'Fewer versions' }).click()

  await page.getByRole('radio', { name: /^Other/ }).hover()
  await shot('10-picker-other')
  await page.getByRole('radio', { name: 'NeoForge' }).click()
  await shot('11-picker-other-neoforge')
  await page.getByRole('radio', { name: 'OptiFine' }).click()
  await page.getByRole('button', { name: 'More…' }).click()
  await shot('12-picker-other-optifine-more')

  // Keyboard: arrows move through editions, Escape goes back.
  await page.getByRole('radio', { name: /^Other/ }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('radio', { name: /^Vanilla/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Choose what to play/ })).toBeFocused()
})

test('create an Other install, then play it', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Other/ }).click()
  await page.getByRole('button', { name: 'Create Fabric 1.20.1' }).click()
  await expect(page.getByRole('heading', { name: 'Fabric', exact: true })).toBeVisible()
  await expect(page.getByText('Fabric for Minecraft 1.20.1, with Sodium and Iris.')).toBeVisible()
  await shot('13-home-other')

  await page.getByRole('button', { name: /^Play Fabric/ }).click()
  await expect(page.getByRole('status')).toHaveText('Downloading game files')
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(SHOTS, '14-home-downloading.png') })
  await expect(page.getByRole('button', { name: 'Stop the game' })).toBeVisible({ timeout: 10_000 })
  await shot('15-home-running')
  await page.getByRole('button', { name: 'Stop the game' }).click()
  await expect(page.getByRole('status')).toContainText('Ready to play')
})

test('library', async () => {
  await page.getByRole('button', { name: 'Library' }).click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await page.getByRole('button', { name: /^Kairo 26\.3/ }).click()
  await shot('16-library')
})

test('settings: every tab', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  for (const [i, name] of ['Game', 'Launcher', 'Account', 'Privacy', 'About'].entries()) {
    await page.getByRole('tab', { name }).click()
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
    await shot(`${17 + i}-settings-${name.toLowerCase()}`)
  }
  await page.getByRole('tab', { name: 'Game' }).click()
  await page.getByRole('switch', { name: 'Use my own Java' }).click()
  await shot('22-settings-game-java')
})

test('Void theme follows the selected install', async () => {
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Void/ }).click()
  await page.getByRole('button', { name: /Kairo Void for Minecraft 26\.3/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'void')
  await shot('23-home-void')
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByRole('button', { name: /^Kairo Void 26\.3/ }).click()
  await shot('24-library-void')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Launcher' }).click()
  await shot('25-settings-void')

  // Turning "Match the selected install" off goes back to Kairo colours.
  await page.getByRole('switch', { name: 'Match the selected install' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'kairo')
})

test('keyboard focus is visible', async () => {
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'Library' }).focus()
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, width: s.outlineWidth }
  })
  expect(outline).toEqual({ style: 'solid', width: '2px' })
})

test('reduced motion turns off slides and zooms', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await page.waitForTimeout(1600) // the switch itself still animates once
  const transforms = await page.evaluate(() => ({
    picker: getComputedStyle(document.querySelector('.screen-pick')!).transform,
    background: getComputedStyle(document.querySelector('.bg[data-on="false"]')!).transform
  }))
  expect(transforms).toEqual({ picker: 'none', background: 'none' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
})

test('no console errors or CSP violations', () => {
  expect(problems).toEqual([])
})
