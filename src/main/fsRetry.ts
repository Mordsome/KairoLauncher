import { rename } from 'node:fs/promises'

// On Windows, replacing a file fails for a moment (EPERM, EBUSY, EACCES) while
// something else has it open: an antivirus scan, or the launcher reading it at
// the same instant. Trying again shortly after is what other Windows tools do.

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** rename(), tried again a few times (about a second in all) while Windows says the file is busy. */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !BUSY.has(code) || attempt >= 8) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}
