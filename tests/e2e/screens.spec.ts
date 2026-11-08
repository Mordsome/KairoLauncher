import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import type { LauncherSettings } from '../../src/shared/api'
import { join } from 'node:path'

// Walks through every screen of the built app (mock data), saves a
// screenshot of each, and fails on any console error or CSP violation.
// It runs on an empty data folder, so accounts, settings and installs on
// this PC don't change what it sees, and it never changes them.

const SHOTS = join('test-results', 'screens')
mkdirSync(SHOTS, { recursive: true })
const DATA = mkdtempSync(join(tmpdir(), 'kairo-screens-'))

let app: ElectronApplication
let page: Page
const problems: string[] = []
/** The settings this PC had before the run; put back at the end. */
let savedSettings: LauncherSettings | null = null

async function shot(name: string) {
  await page.waitForTimeout(900) // let crossfades and slides finish
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test.beforeAll(async () => {
  // Run the built UI, never a dev server.
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${DATA}`], env })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.waitForLoadState('domcontentloaded')
  // Start from the default settings, so a saved selection can't change what the tests see.
  savedSettings = await page.evaluate(() => window.kairo.settings.get())
  await page.evaluate(() =>
    window.kairo.settings.set({
      memoryGB: 4,
      customJava: false,
      javaPath: '',
      fullscreen: false,
      hideWhilePlaying: true,
      showSnapshots: false,
      matchTheme: true,
      autoUpdate: true,
      voidWarningSeen: false,
      background: { kind: 'pixels', trailSize: 50, trailStrength: 'normal', hoverWaves: true, clickRipple: true, fit: 'fill', dim: 35, blur: 0, pixelsOnTop: true, separateVoid: false },
      reduceMotion: false,
      lastSelection: null
    })
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  if (savedSettings) {
    await page.waitForTimeout(500) // let a pending save land first
    await page.evaluate((s) => window.kairo.settings.set(s), savedSettings).catch(() => undefined)
  }
  await app?.close()
  rmSync(DATA, { recursive: true, force: true })
})

test('renderer is locked down', async () => {
  expect(page.url()).toBe('kairo://app/index.html')
  const exposed = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    api: Object.keys(window.kairo).sort()
  }))
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', api: ['app', 'auth', 'background', 'game', 'installs', 'kairo', 'loaders', 'settings', 'window'] })

  // The main process rejects malformed play requests.
  const bad = await page.evaluate(() =>
    window.kairo.game
      .play({ target: { kind: 'vanilla', mc: '../../evil' }, memoryGB: 4, javaPath: null, fullscreen: false, hideWhilePlaying: false })
      .then(
        () => 'accepted',
        () => 'rejected'
      )
  )
  expect(bad).toBe('rejected')
  problems.length = 0 // the rejected call logs an IPC error on purpose

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

test('main process only reaches allowed services, over HTTPS', async () => {
  const result = await app.evaluate(async () => {
    const tryFetch = (url: string) =>
      fetch(url, { method: 'HEAD' }).then(
        (r) => `ok ${r.status}`,
        (e: { cause?: { message?: string }; message?: string }) => `blocked: ${e.cause?.message ?? e.message}`
      )
    return {
      other: await tryFetch('https://example.com/'),
      plainHttp: await tryFetch('http://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
      mojang: await tryFetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
      otherGitHubRepo: await tryFetch('https://api.github.com/repos/torvalds/linux/releases'),
      otherGitHubPage: await tryFetch('https://github.com/torvalds'),
      kairoReleases: await tryFetch('https://api.github.com/repos/Mordsome/Kairo/releases?per_page=1'),
      // Allowed address that redirects somewhere that isn't (codeload.github.com): the hop is refused.
      redirectOffList: await tryFetch('https://api.github.com/repos/Mordsome/Kairo/tarball')
    }
  })
  expect(result.other).toMatch(/^blocked: Refused to connect to example\.com/)
  expect(result.plainHttp).toMatch(/^blocked/)
  expect(result.mojang).toBe('ok 200')
  expect(result.otherGitHubRepo).toMatch(/^blocked/)
  expect(result.otherGitHubPage).toMatch(/^blocked/)
  expect(result.kairoReleases).toBe('ok 200')
  expect(result.redirectOffList).toMatch(/^blocked: Refused to connect to codeload\.github\.com/)
})

test("the updater's own network only reaches Mordsome on GitHub", async () => {
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
      otherSite: await get('https://example.com/'),
      plainHttp: await get('http://github.com/Mordsome/Kairo/releases.atom')
    }
  })
  expect(result).toEqual({ kairo: 'ok 200', otherRepo: 'blocked', otherSite: 'blocked', plainHttp: 'blocked' })
})

test('sign-in: Microsoft page, browser hand-back, errors, cancel', async () => {
  await expect(page.getByRole('heading', { name: 'Welcome to Kairo' })).toBeVisible()
  await shot('01-sign-in')

  // Catch the page the launcher would open in the browser instead of opening it.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { signInUrls: string[] }
    g.signInUrls = []
    ;(shell as { openExternal: (url: string) => Promise<void> }).openExternal = async (url: string) => {
      g.signInUrls.push(url)
    }
  })
  const lastUrl = async (count: number) => {
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { signInUrls: string[] }).signInUrls.length)).toBe(count)
    const urls = await app.evaluate(() => (globalThis as unknown as { signInUrls: string[] }).signInUrls)
    return new URL(urls[urls.length - 1]!)
  }
  const backToLauncher = (url: URL, query: string) =>
    fetch(`${url.searchParams.get('redirect_uri')!.replace('localhost', '127.0.0.1')}/?${query}&state=${encodeURIComponent(url.searchParams.get('state')!)}`)

  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click()
  await expect(page.getByRole('heading', { name: 'Finish in your browser' })).toBeVisible()
  await shot('02-sign-in-wait')
  let url = await lastUrl(1)
  expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
  expect(url.searchParams.get('client_id')).toBe('c86421b8-05da-4075-9d21-27f26fc61712')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  expect(url.searchParams.get('scope')).toContain('XboxLive.signin')
  expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/)

  // The player says no on Microsoft's page.
  await backToLauncher(url, 'error=access_denied')
  await expect(page.getByRole('heading', { name: 'Sign-in cancelled' })).toBeVisible()
  await shot('03-sign-in-cancelled')

  // A code Microsoft doesn't accept: the real token endpoint answers, and the launcher shows an error.
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Finish in your browser' })).toBeVisible()
  url = await lastUrl(2)
  await backToLauncher(url, 'code=not-a-real-code')
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
  await shot('03b-sign-in-error')

  // Cancel in the launcher goes straight back.
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Finish in your browser' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()

  // Nothing got saved by any of that.
  expect((await page.evaluate(() => window.kairo.auth.state())).accounts).toEqual([])

  await page.getByRole('button', { name: 'Continue with the offline dev account' }).click()
  await expect(page.getByRole('heading', { name: 'Kairo', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Offline dev account')
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

test('Other builder: live versions, Modrinth extras, Forge and OptiFine hand-off', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Other/ }).click()
  await expect(page.getByRole('button', { name: 'Create Fabric 1.20.1' })).toBeVisible()
  // Extras come from Modrinth for this loader and version.
  await expect(page.getByRole('checkbox', { name: /^Sodium/ })).toBeVisible({ timeout: 20_000 })
  await shot('13-other-fabric')

  await page.getByRole('radio', { name: 'Forge', exact: true }).click()
  await expect(page.getByRole('button', { name: "Open Forge's download page" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose the downloaded file' })).toBeVisible()
  await expect(page.getByText(/Forge asks to be downloaded from its own site/)).toBeVisible()
  await shot('13b-other-forge')

  await page.getByRole('radio', { name: 'OptiFine' }).click()
  await expect(page.getByRole('button', { name: 'Open optifine.net' })).toBeVisible()
  await page.getByRole('radio', { name: 'Fabric' }).click()
  await page.keyboard.press('Escape')
})

test('Vanilla uses the live version list', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Vanilla/ }).click()
  await page.getByRole('button', { name: /More versions/ }).click()
  // These come from Mojang's manifest, not the built-in list.
  await expect(page.getByRole('radio', { name: '1.8', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: '1.20.1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Minecraft', exact: true })).toBeVisible()
  await shot('14-home-vanilla')
})

test('Kairo shows the real release', async () => {
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Kairo/ }).first().click()
  // Read from GitHub: the newest release that has both jars and SHA256SUMS.txt.
  const latest = await page.evaluate(() => window.kairo.kairo.status().then((s) => s.latest?.version))
  expect(latest).toMatch(/^\d+\.\d+/)
  await expect(page.getByText(`Kairo ${latest} · latest`)).toBeVisible()
  await page.getByRole('button', { name: /^Kairo for Minecraft/ }).first().click()
})

test('library', async () => {
  await page.getByRole('button', { name: 'Library' }).click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await page.getByRole('button', { name: /^Kairo 26\.3/ }).click()
  await shot('16-library')
})

/** A Library row by install name and version. */
const row = (name: string) => page.locator('.librow').filter({ has: page.locator('.librow-name').getByText(name, { exact: true }) })

test('library: rename, duplicate, change version, logs, delete', async () => {
  // Deleted folders are removed for real instead of filling this PC's Recycle Bin.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { trashed: string[] }
    g.trashed = []
    ;(shell as { trashItem: (path: string) => Promise<void> }).trashItem = async (path: string) => {
      g.trashed.push(path)
      const fs = process.getBuiltinModule('node:fs')
      fs.rmSync(path, { recursive: true, force: true })
    }
  })
  const before = await page.evaluate(() => window.kairo.installs.list().then((l) => l.map((i) => i.id)))

  // Make a Fabric install from the builder (nothing downloads until Play).
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Choose what to play/ }).click()
  await page.getByRole('radio', { name: /^Other/ }).click()
  await page.getByRole('radio', { name: 'Fabric' }).click()
  await page.getByRole('button', { name: 'Create Fabric 1.20.1' }).click()
  await expect(page.getByRole('heading', { name: /Fabric/ })).toBeVisible()
  const made = await page.evaluate((ids) => window.kairo.installs.list().then((l) => l.find((i) => !ids.includes(i.id))!), before)
  expect(made.loader).toBe('fabric')

  await page.getByRole('button', { name: 'Library' }).click()
  await row(made.name).click()
  await expect(page.getByRole('heading', { name: made.name, level: 2 })).toBeVisible()

  // Rename.
  await page.getByRole('button', { name: 'Rename' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E Test Install')
  await shot('16b-library-rename')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Test Install', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rename' })).toBeFocused() // focus comes back

  // Escape closes a dialog without changing anything.
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Change version.
  await page.getByRole('button', { name: 'Change version' }).click()
  await page.getByRole('dialog').getByRole('radio', { name: '1.20.4', exact: true }).click()
  await shot('16c-library-change-version')
  await page.getByRole('dialog').getByRole('button', { name: 'Change to 1.20.4' }).click()
  await expect(page.getByText('Minecraft 1.20.4', { exact: true })).toBeVisible()

  // Logs: none yet.
  await page.getByRole('button', { name: 'Logs' }).click()
  await expect(page.getByRole('dialog', { name: 'Log: E2E Test Install' })).toContainText('no log yet')
  await shot('16d-library-logs')
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()

  // Duplicate: a new install, selected.
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Test Install copy', level: 2 })).toBeVisible()
  const copy = await page.evaluate(() => window.kairo.installs.list().then((l) => l.find((i) => i.name === 'E2E Test Install copy')!))
  expect(copy.mc).toBe('1.20.4')
  expect(copy.id).not.toBe(made.id)

  // Delete both.
  for (const name of ['E2E Test Install copy', 'E2E Test Install']) {
    await row(name).click()
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog', { name: `Delete ${name}?` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
    if (name === 'E2E Test Install') await shot('16e-library-delete')
    await page.getByRole('button', { name: 'Move to Recycle Bin' }).click()
    await expect(row(name)).toHaveCount(0)
  }
  const trashed = await app.evaluate(() => (globalThis as unknown as { trashed: string[] }).trashed)
  expect(trashed).toHaveLength(2)
  for (const path of trashed) expect(path).toMatch(/[\\/]installs[\\/]/)
  const after = await page.evaluate(() => window.kairo.installs.list().then((l) => l.map((i) => i.id)))
  expect(after.sort()).toEqual([...before].sort())

  // Malformed ids are refused by the main process.
  expect(await page.evaluate(() => window.kairo.installs.remove('../../x').then(() => 'ok', () => 'rejected'))).toBe('rejected')
  expect(await page.evaluate(() => window.kairo.game.logs('../x').then(() => 'ok', () => 'rejected'))).toBe('rejected')
  problems.length = 0 // the rejected calls log IPC errors on purpose
})

test('settings: every tab', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  for (const [i, name] of ['Game', 'Launcher', 'Account', 'Privacy', 'About'].entries()) {
    await page.getByRole('tab', { name }).click()
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
    await shot(`${17 + i}-settings-${name.toLowerCase()}`)
  }
  await page.getByRole('tab', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Add another account' }).click()
  await expect(page.getByRole('heading', { name: 'Add an account' })).toBeVisible()
  await shot('17b-add-account')
  await page.getByRole('button', { name: 'Back to Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect(await page.evaluate(() => window.kairo.auth.switchTo('../../x').then(() => 'ok', () => 'rejected'))).toBe('rejected')
  problems.length = 0 // the rejected call logs an IPC error on purpose

  await page.getByRole('tab', { name: 'Game' }).click()
  await page.getByRole('switch', { name: 'Use my own Java' }).click()
  await shot('22-settings-game-java')

  // Browse… opens a file dialog; cancelling it keeps the path.
  await app.evaluate(({ dialog }) => {
    ;(dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  await page.getByRole('button', { name: 'Browse…' }).click()
  await expect(page.getByRole('textbox', { name: 'Path to Java' })).toHaveValue('')
  await page.getByRole('switch', { name: 'Use my own Java' }).click()

  // Changes are saved by the main process, and checked on the way in.
  await page.getByRole('tab', { name: 'Launcher' }).click()
  await page.getByRole('switch', { name: 'Update the launcher automatically' }).click()
  await expect.poll(() => page.evaluate(() => window.kairo.settings.get().then((s) => s.autoUpdate))).toBe(false)
  await page.getByRole('switch', { name: 'Update the launcher automatically' }).click()
  await expect.poll(() => page.evaluate(() => window.kairo.settings.get().then((s) => s.autoUpdate))).toBe(true)
  const cleaned = await page.evaluate(() =>
    window.kairo.settings.get().then((s) => window.kairo.settings.set({ ...s, memoryGB: 9999, javaPath: 42 as unknown as string }))
  )
  expect(cleaned.memoryGB).toBe(4)
  expect(cleaned.javaPath).toBe('')
})

/** A real, decodable PNG (stripes), for the custom background. */
function stripesPng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const on = ((x + y) >> 4) % 2 === 0
      raw[o] = on ? 200 : 30
      raw[o + 1] = 90
      raw[o + 2] = on ? 120 : 220
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// The classic 1x1 GIF.
const ONE_PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')

test('backgrounds: Pixel field, Aurora and your own picture', async () => {
  const pictures = () =>
    app.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('node:fs')
      const path = process.getBuiltinModule('node:path')
      const dir = path.join(app.getPath('userData'), 'backgrounds')
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f !== 'backgrounds.json') : []
    })
  const nextPick = (f: string) =>
    app.evaluate(({ dialog }, picked) => {
      ;(dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, f)
  const kind = () => page.evaluate(() => window.kairo.settings.get().then((s) => s.background.kind))

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Launcher' }).click()
  await expect(page.getByRole('radio', { name: /Pixel field/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.bd-pixels')).toHaveAttribute('data-on', 'true')

  await page.getByRole('radio', { name: /Aurora/ }).click()
  await expect(page.locator('.bd-aurora')).toHaveAttribute('data-on', 'true')
  await expect.poll(kind).toBe('aurora')
  await shot('26-settings-background-aurora')

  // A program renamed to .png is refused by its content.
  const dir = mkdtempSync(join(tmpdir(), 'kairo-pictures-'))
  const fake = join(dir, 'photo.png')
  writeFileSync(fake, 'MZ this is a program, not a picture')
  await nextPick(fake)
  await page.getByRole('radio', { name: /Custom/ }).click()
  await expect(page.getByRole('alert')).toContainText("isn't a picture the launcher can use")
  expect(await kind()).toBe('aurora')
  expect(await pictures()).toEqual([])

  // A real picture from the file dialog.
  const real = join(dir, 'my background.png')
  writeFileSync(real, stripesPng(640, 360))
  await nextPick(real)
  await page.getByRole('radio', { name: /Custom/ }).click()
  await expect(page.locator('.bd-custom')).toHaveAttribute('data-on', 'true')
  await expect.poll(kind).toBe('custom')
  expect(await page.locator('.bd-custom .bd-picture').first().evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('kairo-bg://current')
  const first = await pictures()
  expect(first).toHaveLength(1)
  await shot('27-settings-background-custom')

  // Dropping a picture on the card replaces it; the old file is deleted.
  const transfer = await page.evaluateHandle((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'dropped.gif', { type: 'image/gif' }))
    return dt
  }, Array.from(ONE_PIXEL_GIF))
  await page.locator('.bg-card').dispatchEvent('drop', { dataTransfer: transfer })
  await expect.poll(async () => (await pictures())[0]).toMatch(/\.gif$/)
  expect(await pictures()).toHaveLength(1)

  // The page can only reach the two stored pictures through kairo-bg://.
  const other = await page.evaluate(() =>
    new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => resolve('loaded')
      img.onerror = () => resolve('refused')
      img.src = 'kairo-bg://elsewhere/?x=1'
    })
  )
  expect(other).toBe('refused')
  problems.length = 0 // the refused picture logs a 404 on purpose

  // Reduce motion: the picture is drawn once, still.
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true')
  await expect(page.locator('.bd-custom canvas.bd-still')).toHaveCount(1)
  await page.getByRole('switch', { name: 'Reduce motion' }).click()

  // Remove: back to the Pixel field, nothing left on disk.
  await page.getByRole('button', { name: 'Remove image' }).click()
  await expect.poll(kind).toBe('pixels')
  await expect(page.locator('.bd-pixels')).toHaveAttribute('data-on', 'true')
  expect(await pictures()).toEqual([])
  rmSync(dir, { recursive: true, force: true })
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
    background: getComputedStyle(document.querySelector('.bd-blob')!).animationName,
    still: document.querySelector('.backdrop')!.getAttribute('data-still')
  }))
  expect(transforms).toEqual({ picker: 'none', background: 'none', still: 'true' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
})

test('no console errors or CSP violations', () => {
  expect(problems).toEqual([])
})
