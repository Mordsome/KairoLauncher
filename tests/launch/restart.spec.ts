import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// "Restart the game" (Kairo 0.4.0 and later), with a real game. The test does
// what Kairo does: it writes "restart" into the file the launcher passed in
// -Dkairo.launcher.restart, then closes the game window normally. Opt-in (test
// builds only, Windows): KAIRO_TEST_KAIRO_DIR must hold Kairo 0.4.0 or later.

const KAIRO_DIR = process.env['KAIRO_TEST_KAIRO_DIR']
const LAUNCH_DATA = resolve('test-results', 'launch-data')
const FAKE_MC = resolve('test-results', 'fake-minecraft', '.minecraft')
mkdirSync(FAKE_MC, { recursive: true })

test.skip(!KAIRO_DIR || process.platform !== 'win32', 'Set KAIRO_TEST_KAIRO_DIR (Kairo 0.4.0 or later) to run the restart tests (Windows).')
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userData = ''
let install = { id: '', name: '' }

interface Game {
  pid: number
  restartFile: string | null
}

/** The running game (a java process started from this test's data folder) and the restart file it was given. */
function runningGame(): Game | null {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' or Name='java.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
    { encoding: 'utf8' }
  ).trim()
  if (!out) return null
  const list = ([] as { ProcessId: number; CommandLine: string | null }[]).concat(JSON.parse(out))
  const mine = list.find((p) => p.CommandLine?.includes(userData))
  if (!mine) return null
  const m = /-Dkairo\.launcher\.restart=("[^"]+"|\S+)/.exec(mine.CommandLine!)
  return { pid: mine.ProcessId, restartFile: m ? m[1]!.replace(/^"|"$/g, '') : null }
}

const phase = () => page.evaluate(() => window.kairo.game.state().then((s) => s.phase))

/** Waits until the game runs and returns it. */
async function waitForGame(notPid?: number): Promise<Game> {
  let game: Game | null = null
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        game = state.phase === 'running' ? runningGame() : null
        return !!game && game.pid !== notPid
      },
      { timeout: 30 * 60_000, intervals: [2000] }
    )
    .toBe(true)
  return game!
}

/** Closes the game window the normal way (like the window's X), or kills it (a crash). */
function close(game: Game, kill = false) {
  execFileSync('taskkill.exe', kill ? ['/F', '/PID', String(game.pid)] : ['/PID', String(game.pid)], { stdio: 'ignore' })
}

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${LAUNCH_DATA}`], env: { ...env, KAIRO_DEV_ACCOUNT: 'offline', KAIRO_DEV_MINECRAFT_DIR: FAKE_MC } })
  page = await app.firstWindow()
  userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await app.evaluate(({ shell }) => {
    ;(shell as { trashItem: (p: string) => Promise<void> }).trashItem = async (p: string) =>
      process.getBuiltinModule('node:fs').rmSync(p, { recursive: true, force: true })
  })
  for (const old of await page.evaluate(() => window.kairo.installs.list())) {
    if (old.name.startsWith('Restart test')) await page.evaluate((id) => window.kairo.installs.remove(id), old.id)
  }
  const r = await page.evaluate(() => window.kairo.installs.create({ loader: 'kairo', mc: '26.3', extras: [], name: 'Restart test' }))
  if (!r.ok) throw new Error('Could not make a test install')
  install = { id: r.install.id, name: r.install.name }
  // Keep the launcher on screen while the game runs.
  const settings = await page.evaluate(() => window.kairo.settings.get())
  await page.evaluate((s) => window.kairo.settings.set({ ...s, hideWhilePlaying: false, lastSelection: null }), settings)
  await page.reload()
  const offline = page.getByRole('button', { name: 'Continue with the offline dev account' })
  await offline.waitFor({ timeout: 5000 }).then(
    () => offline.click(),
    () => undefined
  )
})

test.afterAll(async () => {
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  await expect.poll(phase, { timeout: 60_000 }).toBe('idle').catch(() => undefined)
  await page?.evaluate((id) => window.kairo.installs.remove(id), install.id).catch(() => undefined)
  await app?.close()
})

async function play(): Promise<Game> {
  const name = install.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await expect(async () => {
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: /Choose what to play/ }).click({ timeout: 5000 })
    await page.getByRole('radio', { name: new RegExp(`^${name}, Minecraft`) }).click({ timeout: 5000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: new RegExp(`^Play ${name}`) }).click()
  return waitForGame()
}

test('Kairo asks for a restart: the same install starts again, once', async () => {
  const first = await play()
  // A fresh file for this launch, in the launcher's own data folder, not there yet.
  expect(first.restartFile).not.toBeNull()
  expect(first.restartFile!.startsWith(join(userData, 'restart'))).toBe(true)
  expect(existsSync(first.restartFile!)).toBe(false)

  writeFileSync(first.restartFile!, 'restart')
  close(first)
  const second = await waitForGame(first.pid)
  expect(existsSync(first.restartFile!)).toBe(false)
  // The new game has its own new file.
  expect(second.restartFile).not.toBe(first.restartFile)

  // Closed without asking: it stays closed.
  close(second)
  await expect.poll(phase, { timeout: 60_000 }).toBe('idle')
  await page.waitForTimeout(8000)
  expect(await phase()).toBe('idle')
  expect(runningGame()).toBeNull()
})

test('a crash is never a restart', async () => {
  const game = await play()
  writeFileSync(game.restartFile!, 'restart')
  close(game, true)
  await expect.poll(phase, { timeout: 60_000 }).toBe('idle')
  await page.waitForTimeout(8000)
  expect(await phase()).toBe('idle')
  expect(runningGame()).toBeNull()
  // Checked and deleted all the same.
  expect(existsSync(game.restartFile!)).toBe(false)
})
