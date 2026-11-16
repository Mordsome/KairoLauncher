import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'kairo-restart-'))
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false } }))

const { newRestartFile, takeRestart } = await import('../../src/main/game/restart')

describe('"Restart the game" (Kairo 0.4.0)', () => {
  it('gives every launch its own file in the launcher\'s data folder, not there yet', async () => {
    const a = await newRestartFile()
    const b = await newRestartFile()
    expect(a).not.toBe(b)
    expect(dirname(a)).toBe(join(data, 'restart'))
    expect(existsSync(a)).toBe(false)
  })

  it('restarts once when the game wrote "restart" and closed normally', async () => {
    const file = await newRestartFile()
    writeFileSync(file, 'restart')
    expect(await takeRestart(file, true)).toBe(true)
    expect(existsSync(file)).toBe(false)
    // The file is gone after the check: never a second time.
    expect(await takeRestart(file, true)).toBe(false)
  })

  it('never restarts after a crash or a Stop, and still deletes the file', async () => {
    const file = await newRestartFile()
    writeFileSync(file, 'restart')
    expect(await takeRestart(file, false)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('does nothing when the game was simply closed, and ignores anything but "restart"', async () => {
    expect(await takeRestart(await newRestartFile(), true)).toBe(false)
    for (const text of ['', 'Restart', 'restart now', 'yes', '{"restart":true}']) {
      const file = await newRestartFile()
      writeFileSync(file, text)
      expect(await takeRestart(file, true), JSON.stringify(text)).toBe(false)
      expect(existsSync(file)).toBe(false)
    }
    // A trailing newline (an editor, echo) is still "restart".
    const file = await newRestartFile()
    writeFileSync(file, 'restart\n')
    expect(await takeRestart(file, true)).toBe(true)
  })
})
