import { describe, expect, it } from 'vitest'
import { keyringBackend, SecretStore, type SecretBackend } from '../../src/main/auth/secretStore'

function memory(): SecretBackend & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k)
  }
}

describe('SecretStore', () => {
  it('splits long values into chunks and reads them back', async () => {
    const backend = memory()
    const store = new SecretStore(backend, 100)
    const value = 'x'.repeat(950) + 'end'
    await store.write('token', value)
    expect(await store.read('token')).toBe(value)
    expect([...backend.data.values()].every((v) => v.length <= 100)).toBe(true)
  })

  it('leaves no old chunks behind after a rewrite, and removes everything', async () => {
    const backend = memory()
    const store = new SecretStore(backend, 10)
    await store.write('t', 'a'.repeat(95))
    await store.write('t', 'short')
    expect(await store.read('t')).toBe('short')
    expect(backend.data.size).toBe(2) // header + one chunk
    await store.remove('t')
    expect(backend.data.size).toBe(0)
    expect(await store.read('t')).toBeNull()
  })

  it('treats a missing chunk as no value instead of returning half a token', async () => {
    const backend = memory()
    const store = new SecretStore(backend, 10)
    await store.write('t', 'b'.repeat(30))
    const chunkKey = [...backend.data.keys()].find((k) => k.endsWith('.1'))!
    backend.data.delete(chunkKey)
    expect(await store.read('t')).toBeNull()
  })

  it.runIf(process.platform === 'win32')('round-trips a 10 KB value through Windows Credential Manager', async () => {
    const store = new SecretStore(keyringBackend('KairoLauncher-test'))
    const value = Array.from({ length: 10_000 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('')
    try {
      await store.write('roundtrip', value)
      expect(await store.read('roundtrip')).toBe(value)
    } finally {
      await store.remove('roundtrip')
    }
    expect(await store.read('roundtrip')).toBeNull()
  })
})
