import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashFile, kairoStatement, publicKeyFrom, updateFileName, updateStatement, verifyStatement } from '../../src/main/signature'
// The real signing tool, so the launcher and the tool are tested against each other.
import { publicBase64, signStatement } from '../../scripts/release-sign.mjs'

const mine = generateKeyPairSync('ed25519').privateKey
const someoneElse = generateKeyPairSync('ed25519').privateKey
const key = publicKeyFrom(publicBase64(mine))
const dir = mkdtempSync(join(tmpdir(), 'kairo-sign-'))

describe('launcher updates', () => {
  it('accepts an installer signed with the release key', async () => {
    const file = join(dir, 'KairoLauncher-Setup-0.2.0.exe')
    writeFileSync(file, 'installer bytes')
    const statement = updateStatement('KairoLauncher-Setup-0.2.0.exe', await hashFile(file, 'sha512'))
    expect(verifyStatement(key, statement, signStatement(mine, statement))).toBe(true)
  })

  it('refuses a changed file, another name or version, another key, and junk', async () => {
    const good = updateStatement('KairoLauncher-Setup-0.2.0.exe', 'ab'.repeat(64))
    const signature = signStatement(mine, good)
    expect(verifyStatement(key, updateStatement('KairoLauncher-Setup-0.2.0.exe', 'cd'.repeat(64)), signature)).toBe(false)
    // An old signed installer can't be passed off as a newer version.
    expect(verifyStatement(key, updateStatement('KairoLauncher-Setup-0.3.0.exe', 'ab'.repeat(64)), signature)).toBe(false)
    expect(verifyStatement(key, good, signStatement(someoneElse, good))).toBe(false)
    expect(verifyStatement(key, good, 'not a signature')).toBe(false)
    expect(verifyStatement(key, good, '')).toBe(false)
    expect(verifyStatement(null, good, signature)).toBe(false)
  })

  it('knows the installer name for each system, and only for plain versions', () => {
    expect(updateFileName('0.2.0', 'win32')).toBe('KairoLauncher-Setup-0.2.0.exe')
    expect(updateFileName('0.2.0', 'linux')).toBe('KairoLauncher-0.2.0.AppImage')
    expect(updateFileName('0.2.0', 'darwin')).toBeNull()
    expect(updateFileName('0.2.0/../../x', 'win32')).toBeNull()
    expect(updateFileName('0.2.0-beta', 'win32')).toBeNull()
  })
})

describe('Kairo releases', () => {
  it("binds the signature to the release's tag", () => {
    const statement = kairoStatement('v0.21.0', 'ef'.repeat(32))
    const signature = signStatement(mine, statement)
    expect(verifyStatement(key, statement, signature)).toBe(true)
    expect(verifyStatement(key, kairoStatement('v0.22.0', 'ef'.repeat(32)), signature)).toBe(false)
  })
})

describe('the public key', () => {
  it('must be a valid Ed25519 key', () => {
    expect(publicKeyFrom('')).toBeNull()
    expect(publicKeyFrom('bm90IGEga2V5')).toBeNull()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    expect(publicKeyFrom(rsa)).toBeNull()
    expect(publicKeyFrom(publicBase64(mine))).not.toBeNull()
  })
})
