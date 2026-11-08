import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { createReadStream } from 'node:fs'

// Release signatures (Ed25519). Mordsome signs on their own PC with
// scripts/release-sign.mjs, using a key that never leaves that PC; the launcher
// checks with the public half in config/release-key.json. So a hacked GitHub
// account alone can't ship a launcher update (or, once required, a Kairo jar).
//
// A signature covers a short statement naming the file (with its version) and
// its hash: it can't be reused for another file or passed off as another version.
// The signing script imports this file too, so both sides always agree.
// Plain TypeScript only (no enums etc.): Node runs it directly for the script.

export function updateStatement(fileName: string, sha512: string): Buffer {
  return Buffer.from(`KairoLauncher update signature v1\nfile: ${fileName}\nsha512: ${sha512.toLowerCase()}\n`, 'utf8')
}

export function kairoStatement(tag: string, sha256: string): Buffer {
  return Buffer.from(`Kairo release signature v1\ntag: ${tag}\nsha256: ${sha256.toLowerCase()}\n`, 'utf8')
}

/** What the installer for an update to this version must be called, per system. */
export function updateFileName(version: string, platform: string): string | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  if (platform === 'win32') return `KairoLauncher-Setup-${version}.exe`
  if (platform === 'linux') return `KairoLauncher-${version}.AppImage`
  return null
}

/** The public key from its base64 (SPKI DER) form; null unless it's a valid Ed25519 key. */
export function publicKeyFrom(base64: string): KeyObject | null {
  if (!base64) return null
  try {
    const key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

/** True only for a valid signature by this key over exactly this statement. */
export function verifyStatement(key: KeyObject | null, statement: Buffer, signatureBase64: string): boolean {
  if (!key) return false
  const signature = Buffer.from(signatureBase64.trim(), 'base64')
  if (signature.length !== 64) return false
  try {
    return verify(null, statement, key, signature)
  } catch {
    return false
  }
}

export function hashFile(path: string, algorithm: 'sha512' | 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}
