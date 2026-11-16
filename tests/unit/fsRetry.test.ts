import { describe, expect, it, vi } from 'vitest'

// Windows refuses to replace a file for a moment while something else has it open.
const calls: string[] = []
let busyFor = 0
vi.mock('node:fs/promises', () => ({
  rename: vi.fn(async (from: string) => {
    calls.push(from)
    if (busyFor-- > 0) throw Object.assign(new Error('busy'), { code: from === 'missing' ? 'ENOENT' : 'EPERM' })
  })
}))

const { renameRetry } = await import('../../src/main/fsRetry')

describe('saving over a file Windows says is busy', () => {
  it('tries again until it works', async () => {
    calls.length = 0
    busyFor = 3
    await renameRetry('a.tmp', 'a')
    expect(calls).toHaveLength(4)
  })

  it('gives up after about a second', async () => {
    calls.length = 0
    busyFor = 100
    await expect(renameRetry('a.tmp', 'a')).rejects.toThrow('busy')
    expect(calls).toHaveLength(9)
  })

  it('never retries other failures', async () => {
    calls.length = 0
    busyFor = 1
    await expect(renameRetry('missing', 'a')).rejects.toThrow('busy')
    expect(calls).toHaveLength(1)
  })
})
