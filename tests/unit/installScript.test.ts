import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { updateStatement } from '../../src/main/signature'

// install.sh (the one-command Linux install), run for real in a POSIX shell
// against a fake GitHub: a stand-in `curl` that serves a local release and
// records every address the script asks for, and a stand-in AppImage. The
// release is signed with a test key put in a copy of the script. Needs sh and
// OpenSSL 3 (Linux, macOS, or Git for Windows); skipped otherwise.

const SCRIPT = resolve('install.sh')
const REPO = 'https://github.com/Mordsome/KairoLauncher/releases'

const have = (cmd: string, args: string[], match: RegExp) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return r.status === 0 && match.test(r.stdout)
}
const usable = have('sh', ['-c', 'echo ok'], /ok/) && have('openssl', ['version'], /^OpenSSL [34]/)

/** A Unix path for the shell, also on Windows (Git for Windows' sh reads /c/... paths). */
const shPath = (p: string) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p)

interface Setup {
  version?: string
  /** Changes a file after it was signed and summed. */
  tamper?: 'appimage' | 'sig' | 'yml-path'
}

function run(args: string[], setup: Setup = {}, again?: string) {
  const root = again ?? mkdtempSync(join(tmpdir(), 'kairo-install-'))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const release = join(root, 'release')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  mkdirSync(release, { recursive: true })
  const version = setup.version ?? '1.2.3'
  const file = `KairoLauncher-${version}.AppImage`

  // The stand-in AppImage: its only job here is to hand out its icon when asked.
  let app = Buffer.from('#!/bin/sh\nif [ "$1" = "--appimage-extract" ]; then mkdir -p squashfs-root && printf PNG > squashfs-root/kairo-launcher.png; exit 0; fi\necho started\n')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const hex = createHash('sha512').update(app).digest('hex')
  let sig = sign(null, updateStatement(file, hex), privateKey).toString('base64') + '\n'
  let path = file
  if (setup.tamper === 'appimage') app = Buffer.concat([app, Buffer.from('# changed\n')])
  if (setup.tamper === 'sig') sig = sign(null, updateStatement('KairoLauncher-9.9.9.AppImage', hex), privateKey).toString('base64') + '\n'
  if (setup.tamper === 'yml-path') path = '../../.bashrc'
  writeFileSync(join(release, file), app)
  writeFileSync(join(release, `${file}.sig`), sig)
  writeFileSync(
    join(release, 'latest-linux.yml'),
    `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: ${Buffer.from(hex, 'hex').toString('base64')}\n    size: ${app.length}\npath: ${path}\nsha512: ${Buffer.from(hex, 'hex').toString('base64')}\nreleaseDate: '2026-11-16T00:00:00.000Z'\n`
  )

  // The fake GitHub: only Mordsome/KairoLauncher's release addresses exist; every request is recorded.
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; --proto|--tlsv1.2) [ "$1" = --proto ] && shift; shift;; -*) shift;; *) url="$1"; shift;; esac; done
echo "$url" >> "${shPath(join(root, 'urls.txt'))}"
case "$url" in
  ${REPO}/latest/download/latest-linux.yml) src="${shPath(release)}/latest-linux.yml";;
  ${REPO}/download/*) src="${shPath(release)}/\${url##*/}";;
  *) exit 22;;
esac
[ -f "$src" ] || exit 22
cp "$src" "$out"
`
  )
  chmodSync(join(bin, 'curl'), 0o755)

  const script = join(root, 'install.sh')
  const text = readFileSync(SCRIPT, 'utf8').replace(/^KEY='[^']*'$/m, `KEY='${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}'`)
  writeFileSync(script, text)
  const r = spawnSync('sh', [shPath(script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: shPath(home), XDG_DATA_HOME: '', PATH: `${bin}${delimiter}${process.env['PATH']}` }
  })
  const urls = existsSync(join(root, 'urls.txt')) ? readFileSync(join(root, 'urls.txt'), 'utf8').trim().split('\n') : []
  const data = join(home, '.local', 'share')
  return { ...r, urls, root, home, data, app: join(data, 'kairo-launcher', 'KairoLauncher.AppImage'), file }
}

describe.skipIf(!usable)('install.sh', () => {
  it('installs a checked release: the app, its icon, a menu entry and a command', () => {
    const r = run([])
    expect(r.status, r.stderr + r.stdout).toBe(0)
    expect(r.stdout).toContain('Signed by Mordsome')
    expect(r.stdout).toContain('Kairo Launcher 1.2.3 is installed')
    expect(readFileSync(r.app, 'utf8')).toContain('echo started')
    expect(readFileSync(join(r.data, 'kairo-launcher', 'kairo-launcher.png'), 'utf8')).toBe('PNG')
    const desktop = readFileSync(join(r.data, 'applications', 'kairo-launcher.desktop'), 'utf8')
    expect(desktop).toContain('Name=Kairo Launcher')
    expect(desktop).toMatch(/^Exec=".*\/\.local\/bin\/kairo-launcher" %U$/m)
    expect(readFileSync(join(r.home, '.local', 'bin', 'kairo-launcher'), 'utf8')).toContain('KairoLauncher.AppImage')
    // Only ever Mordsome/KairoLauncher's own release pages.
    expect(r.urls.length).toBe(3)
    for (const url of r.urls) expect(url.startsWith(`${REPO}/`)).toBe(true)
  })

  it('refuses an AppImage that was changed after it was signed', () => {
    const r = run([], { tamper: 'appimage' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("doesn't match the release's checksum")
    expect(existsSync(r.app)).toBe(false)
  })

  it('refuses a signature made for another file', () => {
    const r = run([], { tamper: 'sig' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("isn't signed by Mordsome")
    expect(existsSync(r.app)).toBe(false)
  })

  it('refuses release information that names anything but the AppImage', () => {
    for (const setup of [{ tamper: 'yml-path' as const }, { version: '1.2.3; rm -rf ~' }]) {
      const r = run([], setup)
      expect(r.status, JSON.stringify(setup)).not.toBe(0)
      expect(r.stderr).toContain('release information looks wrong')
      expect(existsSync(r.app)).toBe(false)
    }
  })

  it('removes everything it added, and keeps the player\'s data', () => {
    const installed = run([])
    expect(installed.status).toBe(0)
    mkdirSync(join(installed.home, '.config', 'Kairo Launcher'), { recursive: true })
    writeFileSync(join(installed.home, '.config', 'Kairo Launcher', 'settings.json'), '{}')
    const r = run(['--uninstall'], {}, installed.root)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('~/.config/Kairo Launcher')
    for (const gone of [r.app, join(r.data, 'applications', 'kairo-launcher.desktop'), join(r.home, '.local', 'bin', 'kairo-launcher')]) {
      expect(existsSync(gone), gone).toBe(false)
    }
    expect(existsSync(join(r.home, '.config', 'Kairo Launcher', 'settings.json'))).toBe(true)
    // Removing downloads nothing.
    expect(r.urls).toEqual(installed.urls)
  })
})

describe('install.sh', () => {
  it('checks against the same release key as the launcher itself', () => {
    const key = JSON.parse(readFileSync(resolve('config/release-key.json'), 'utf8')).publicKey as string
    expect(readFileSync(SCRIPT, 'utf8')).toContain(`KEY='${key}'`)
  })

  it('stays short enough to read before running it', () => {
    expect(readFileSync(SCRIPT, 'utf8').split('\n').length).toBeLessThan(200)
  })
})
