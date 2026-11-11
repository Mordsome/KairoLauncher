import { app } from 'electron'

// Test builds only (`--mode offline`, the same builds that have the dev
// account): the launch and screen tests can point the launcher at a local
// release folder instead of GitHub, for releases that aren't published yet
// (a new Kairo, the addons). Every other build compiles these to
// `return null`, and they refuse to work in a packaged app.

/** Files from a local test folder are addressed like this instead of an https link. */
export const TEST_FILE = 'kairo-test-file:'

/** A folder with kairo-<version>.jar and kairo-void-<version>.jar, used as the newest Kairo release. */
export function testKairoDir(): string | null {
  if (!__KAIRO_DEV_OFFLINE__ || app.isPackaged) return null
  return process.env['KAIRO_TEST_KAIRO_DIR'] || null
}

/** A folder laid out like a Mordsome/KairoAddons release, used as the newest one. */
export function testAddonsDir(): string | null {
  if (!__KAIRO_DEV_OFFLINE__ || app.isPackaged) return null
  return process.env['KAIRO_TEST_ADDONS_DIR'] || null
}

/** The local path behind a test file address, only while a test folder is set. */
export function testFilePath(url: string): string | null {
  if (!url.startsWith(TEST_FILE) || !(testKairoDir() || testAddonsDir())) return null
  return url.slice(TEST_FILE.length)
}
