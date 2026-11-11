import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Plays Kairo and Kairo Void for real with a real addon, and checks in the
// game's own log that exactly the right addons loaded. Opt-in: it needs a
// Kairo with the sockets (0.3.0 or later) and a real addons release, given as
// folders (test builds only):
//   KAIRO_TEST_KAIRO_DIR   kairo-<v>.jar and kairo-void-<v>.jar
//   KAIRO_TEST_ADDONS_DIR  a Mordsome/KairoAddons release (addons.json, SHA256SUMS.txt, jars)
// Everything happens in the launch tests' own data folder, in installs made
// for this test and deleted afterwards.

const KAIRO_DIR = process.env['KAIRO_TEST_KAIRO_DIR']
const ADDONS_DIR = process.env['KAIRO_TEST_ADDONS_DIR']
const ADDON = 'plastic-menus'
const LAUNCH_DATA = resolve('test-results', 'launch-data')
const FAKE_MC = resolve('test-results', 'fake-minecraft', '.minecraft')
mkdirSync(FAKE_MC, { recursive: true })

test.skip(!KAIRO_DIR || !ADDONS_DIR, 'Set KAIRO_TEST_KAIRO_DIR and KAIRO_TEST_ADDONS_DIR to run the addon launch tests.')
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userData = ''
const made: Record<'kairo' | 'void', { id: string; name: string; dir: string }> = {} as never

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL')
  )
  app = await electron.launch({ args: ['.', `--user-data-dir=${LAUNCH_DATA}`], env: { ...env, KAIRO_DEV_ACCOUNT: 'offline', KAIRO_DEV_MINECRAFT_DIR: FAKE_MC } })
  page = await app.firstWindow()
  userData = await app.evaluate(({ app }) => app.getPath('userData'))
  // Deleting the test installs removes them for good (they're only test data).
  await app.evaluate(({ shell }) => {
    ;(shell as { trashItem: (p: string) => Promise<void> }).trashItem = async (p: string) =>
      process.getBuiltinModule('node:fs').rmSync(p, { recursive: true, force: true })
  })
  // Test installs left over from an earlier run that stopped half-way.
  for (const old of await page.evaluate(() => window.kairo.installs.list())) {
    if (old.name.startsWith('Addon test ')) await page.evaluate((id) => window.kairo.installs.remove(id), old.id)
  }
  for (const [edition, name] of [
    ['kairo', 'Addon test Kairo'],
    ['void', 'Addon test Void']
  ] as const) {
    const r = await page.evaluate(({ edition, name }) => window.kairo.installs.create({ loader: edition, mc: '26.3', extras: [], name }), { edition, name })
    if (!r.ok) throw new Error('Could not make a test install')
    made[edition] = { id: r.install.id, name: r.install.name, dir: join(userData, 'installs', r.install.name) }
  }
  await page.reload()
  const offline = page.getByRole('button', { name: 'Continue with the offline dev account' })
  await offline.waitFor({ timeout: 5000 }).then(
    () => offline.click(),
    () => undefined
  )
})

test.afterAll(async () => {
  await page?.evaluate(() => window.kairo.game.stop()).catch(() => undefined)
  // Installs can only be deleted once the game has really stopped.
  await expect
    .poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 60_000 })
    .toBe('idle')
    .catch(() => undefined)
  for (const m of Object.values(made)) await page?.evaluate((id) => window.kairo.installs.remove(id), m.id).catch(() => undefined)
  await page?.evaluate((id) => window.kairo.addons.uninstall(id), ADDON).catch(() => undefined)
  await app?.close()
})

/** Plays one of the test installs until Minecraft has started, and returns its log. */
async function play(edition: 'kairo' | 'void'): Promise<string> {
  const m = made[edition]
  const log = join(m.dir, 'logs', 'latest.log')
  if (existsSync(log)) rmSync(log)
  const name = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The launcher window comes back when the last game closes, which can close the picker: try again.
  await expect(async () => {
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: /Choose what to play/ }).click({ timeout: 5000 })
    await page.getByRole('radio', { name: new RegExp(`^${name}, Minecraft`) }).click({ timeout: 5000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: new RegExp(`^Play ${name}`) }).click()
  const warning = page.getByRole('dialog', { name: 'Photosensitivity warning' })
  if (await warning.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await warning.getByRole('button', { name: 'I understand, install' }).click()
  }
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.kairo.game.state())
        if (state.error) throw new Error(`${state.error.title}: ${state.error.message}`)
        if (state.crash) throw new Error(`The game crashed: ${state.crash.message}`)
        return state.phase
      },
      { timeout: 30 * 60_000, intervals: [2000] }
    )
    .toBe('running')
  await expect
    .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 4 * 60_000, intervals: [2000] })
    .toMatch(/Sound engine started|Created: \d+x\d+/)
  const text = readFileSync(log, 'utf8')
  await page.evaluate(() => window.kairo.game.stop())
  await expect.poll(() => page.evaluate(() => window.kairo.game.state().then((s) => s.phase)), { timeout: 30_000 }).toBe('idle')
  return text
}

const loaded = (log: string) => log.match(/Addon loaded: [^\r\n]*/g) ?? []
/** Addon jars the launcher may have left in an install's mods folder (it must leave none). */
const addonFilesIn = (edition: 'kairo' | 'void') =>
  readdirSync(join(made[edition].dir, 'mods')).filter((f) => f.startsWith('kairo-addon-'))

test('the addon loads in Kairo and Kairo Void, from outside the installs', async () => {
  const r = await page.evaluate((id) => window.kairo.addons.install(id), ADDON)
  expect(r.ok, JSON.stringify(r)).toBe(true)
  expect(r.state.addons.find((a) => a.id === ADDON)?.choice).toBe('both')

  const kairoLog = await play('kairo')
  expect(loaded(kairoLog)).toHaveLength(1)
  expect(loaded(kairoLog)[0]).toMatch(/plastic/i)
  expect(addonFilesIn('kairo')).toEqual([])

  const voidLog = await play('void')
  expect(loaded(voidLog)).toHaveLength(1)
  expect(addonFilesIn('void')).toEqual([])
})

test('"Kairo only" leaves Kairo Void without it', async () => {
  expect((await page.evaluate((id) => window.kairo.addons.setChoice(id, 'kairo'), ADDON)).ok).toBe(true)
  expect(loaded(await play('void'))).toEqual([])
  expect(loaded(await play('kairo'))).toHaveLength(1)
  expect((await page.evaluate((id) => window.kairo.addons.setChoice(id, 'off'), ADDON)).ok).toBe(true)
  expect(loaded(await play('kairo'))).toEqual([])
})

test("a copy the player put in mods/ doesn't stop the game from starting", async () => {
  expect((await page.evaluate((id) => window.kairo.addons.setChoice(id, 'both'), ADDON)).ok).toBe(true)
  const jar = readdirSync(join(userData, 'addons')).find((f) => f.startsWith(`kairo-addon-${ADDON}-`))!
  copyFileSync(join(userData, 'addons', jar), join(made.void.dir, 'mods', 'my-own-copy.jar'))
  // Fabric would refuse two mods with one id: the launcher passes only the player's copy.
  expect(loaded(await play('void'))).toHaveLength(1)
  rmSync(join(made.void.dir, 'mods', 'my-own-copy.jar'))
})
