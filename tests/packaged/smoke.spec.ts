import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Starts the packaged app (release/win-unpacked or release/linux-unpacked) on an
// empty data folder: it has to start, reach its native modules, know where its
// updates come from, have no dev-only offline account, and have its fuses set.
// Run after `npm run dist:win` or `npm run dist:linux`: `npm run test:packaged`.
//
// The fuses switch off --inspect, which Playwright normally uses to control an
// Electron app, so this connects to the page over Chromium's debugging port.

const unpacked = resolve('release', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const exe = join(unpacked, process.platform === 'win32' ? 'Kairo Launcher.exe' : 'kairo-launcher')
const resources = join(unpacked, 'resources')
const DATA = mkdtempSync(join(tmpdir(), 'kairo-packaged-'))
const PORT = 9400 + Math.floor(Math.random() * 500)
const SHOTS = join('test-results', 'packaged')
mkdirSync(SHOTS, { recursive: true })

let proc: ChildProcess | null = null
let browser: Browser
let page: Page
const problems: string[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(exe), `${exe} is missing: build it first`).toBe(true)
  proc = spawn(exe, [`--user-data-dir=${DATA}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(async () => {
      await sleep(500)
      return undefined as unknown as Browser
    })
  }
  expect(browser, 'could not connect to the packaged app').toBeTruthy()
  const context = browser.contexts()[0]!
  page = context.pages().find((p) => p.url().startsWith('kairo://')) ?? (await context.waitForEvent('page'))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await browser?.close().catch(() => undefined)
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc!.once('exit', r))
    proc.kill()
    await Promise.race([exited, sleep(5000)])
  }
  rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})

test('fuses: no Node mode, no NODE_OPTIONS, no --inspect, code only from a checked app.asar', async () => {
  const fuses = await getCurrentFuseWire(exe)
  const off = 48 // FuseState.DISABLE
  const on = 49 // FuseState.ENABLE
  expect(fuses[FuseV1Options.RunAsNode]).toBe(off)
  expect(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(off)
  expect(fuses[FuseV1Options.EnableNodeCliInspectArguments]).toBe(off)
  expect(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(on)
  expect(fuses[FuseV1Options.OnlyLoadAppFromAsar]).toBe(on)
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
})

test('ships the licences', () => {
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) expect(existsSync(join(resources, f))).toBe(true)
})

test('no console errors', () => {
  expect(problems).toEqual([])
})
