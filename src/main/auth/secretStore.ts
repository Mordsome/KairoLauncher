import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'

// Sign-in tokens live only in the OS secure store: Windows Credential
// Manager, the macOS Keychain or the Secret Service (libsecret) on Linux.
// Never in a file, never in a log.
//
// Windows caps one credential at 2,560 bytes (about 1,280 characters), and a
// token cache is bigger than that, so values are split into chunks. A write
// stores the new chunks first and only then points the header at them, so a
// crash mid-write leaves the old value intact.

export interface SecretBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

const SERVICE = 'KairoLauncher'

export function keyringBackend(service = SERVICE): SecretBackend {
  const entry = (key: string) => new AsyncEntry(service, key)
  return {
    get: (key) => entry(key).getPassword(),
    set: (key, value) => entry(key).setPassword(value),
    delete: async (key) => {
      await entry(key).deleteCredential().catch(() => undefined)
    }
  }
}

interface Header {
  v: 1
  gen: string
  chunks: number
}

const CHUNK = 1000

export class SecretStore {
  constructor(
    private readonly backend: SecretBackend = keyringBackend(),
    private readonly chunkSize = CHUNK
  ) {}

  private async header(name: string): Promise<Header | null> {
    const raw = await this.backend.get(name)
    if (!raw) return null
    try {
      const h = JSON.parse(raw) as Header
      return h.v === 1 && typeof h.gen === 'string' && Number.isInteger(h.chunks) ? h : null
    } catch {
      return null
    }
  }

  async read(name: string): Promise<string | null> {
    const h = await this.header(name)
    if (!h) return null
    const parts: string[] = []
    for (let i = 0; i < h.chunks; i++) {
      const part = await this.backend.get(`${name}.${h.gen}.${i}`)
      if (part === null) return null // incomplete: treat as missing
      parts.push(part)
    }
    return parts.join('')
  }

  async write(name: string, value: string): Promise<void> {
    const old = await this.header(name)
    const gen = randomBytes(4).toString('hex')
    const count = Math.max(1, Math.ceil(value.length / this.chunkSize))
    for (let i = 0; i < count; i++) {
      await this.backend.set(`${name}.${gen}.${i}`, value.slice(i * this.chunkSize, (i + 1) * this.chunkSize))
    }
    const header: Header = { v: 1, gen, chunks: count }
    await this.backend.set(name, JSON.stringify(header))
    if (old) await this.dropChunks(name, old)
  }

  async remove(name: string): Promise<void> {
    const h = await this.header(name)
    await this.backend.delete(name)
    if (h) await this.dropChunks(name, h)
  }

  private async dropChunks(name: string, h: Header): Promise<void> {
    for (let i = 0; i < h.chunks; i++) await this.backend.delete(`${name}.${h.gen}.${i}`)
  }
}
