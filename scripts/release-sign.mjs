// Release signing for Kairo Launcher and Kairo. Runs only on Mordsome's own PC.
//
//   npm run release:keygen                                   once: makes the key pair
//   npm run release:sign -- <installer files...>             every launcher release
//   npm run release:sign-kairo -- <tag> <SHA256SUMS.txt>     every Kairo release
//
// The private key lives outside the project (in your user folder, or wherever
// KAIRO_RELEASE_KEY points) and is never uploaded anywhere. See docs/RELEASING.md.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile, kairoStatement, publicKeyFrom, updateStatement, verifyStatement } from '../src/main/signature.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(root, 'config', 'release-key.json')
const UPDATE_FILE = /^KairoLauncher-(?:Setup-)?\d+\.\d+\.\d+\.(?:exe|AppImage)$/

export const keyPath = () => process.env.KAIRO_RELEASE_KEY || join(homedir(), '.kairo-release', 'release-key.pem')

/** The public half, as stored in config/release-key.json. */
export function publicBase64(privateKey) {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
}

export function signStatement(privateKey, statement) {
  return sign(null, statement, privateKey).toString('base64')
}

class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message)
}

const readConfig = () => JSON.parse(readFileSync(CONFIG, 'utf8'))

function loadKey() {
  const path = keyPath()
  if (!existsSync(path)) stop('There is no signing key on this PC yet. Run "npm run release:keygen" first (or set KAIRO_RELEASE_KEY).')
  const key = createPrivateKey(readFileSync(path))
  if (publicBase64(key) !== readConfig().publicKey) {
    stop('This key is not the one in config/release-key.json, so launchers would refuse anything it signs.')
  }
  return key
}

function keygen() {
  const path = keyPath()
  if (existsSync(path)) stop('There is already a signing key on this PC. It was left as it is.')
  const config = readConfig()
  if (config.publicKey) {
    stop('config/release-key.json already has a key. A new one would stop every installed launcher from accepting updates.')
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  writeFileSync(CONFIG, JSON.stringify({ ...config, publicKey: publicBase64(privateKey) }, null, 2) + '\n')
  console.log(`Made the signing key: ${path}`)
  console.log('Its public half is now in config/release-key.json (commit that file).')
  console.log('Back the key file up somewhere offline, like a USB stick. Never put it in the project, share it or upload it:')
  console.log('if it is lost, installed launchers can no longer be updated, only reinstalled by hand.')
}

async function signUpdates(files) {
  if (files.length === 0) stop('Name the installer files to sign, e.g. KairoLauncher-Setup-0.2.0.exe')
  const key = loadKey()
  const check = publicKeyFrom(readConfig().publicKey)
  for (const file of files) {
    const name = basename(file)
    if (!UPDATE_FILE.test(name)) stop(`${name} isn't a launcher installer (KairoLauncher-Setup-<version>.exe or KairoLauncher-<version>.AppImage).`)
    const statement = updateStatement(name, await hashFile(file, 'sha512'))
    const signature = signStatement(key, statement)
    if (!verifyStatement(check, statement, signature)) stop(`The signature for ${name} didn't check out.`)
    writeFileSync(`${file}.sig`, signature + '\n')
    console.log(`Signed ${name} -> ${name}.sig`)
  }
  console.log('Upload the .sig files to the draft release next to the installers, then publish.')
}

async function signKairo(tag, file) {
  if (!tag || !/^v?\d[\w.+-]*$/.test(tag)) stop('Give the Kairo release tag first, e.g. v0.21.0')
  if (!file || basename(file) !== 'SHA256SUMS.txt') stop('Then the SHA256SUMS.txt of that release.')
  const key = loadKey()
  const statement = kairoStatement(tag, await hashFile(file, 'sha256'))
  const signature = signStatement(key, statement)
  if (!verifyStatement(publicKeyFrom(readConfig().publicKey), statement, signature)) stop("The signature didn't check out.")
  writeFileSync(`${file}.sig`, signature + '\n')
  console.log(`Signed SHA256SUMS.txt for ${tag} -> SHA256SUMS.txt.sig. Upload it to the Kairo release.`)
}

async function main([command, ...args]) {
  if (command === 'keygen') return keygen()
  if (command === 'sign') return signUpdates(args)
  if (command === 'sign-kairo') return signKairo(args[0], args[1])
  stop('Use: keygen | sign <installer files...> | sign-kairo <tag> <SHA256SUMS.txt>')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Stop ? error.message : error)
    process.exit(1)
  })
}
