import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Phase 8: the checks that keep private data off the screen and files where they belong.

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false },
  shell: { openPath: vi.fn(), openExternal: vi.fn(), trashItem: vi.fn() },
  session: { defaultSession: {} }
}))

const { homeRedactor, redact } = await import('../../src/main/redact')
const { isCrashReport } = await import('../../src/main/game/session')
const { isModrinthCdn } = await import('../../src/main/loaders/mrpack')
const { isUnder } = await import('../../src/main/security')
const { isCustom } = await import('../../src/main/installs/custom')
const { describeError, KairoError } = await import('../../src/main/errors')

describe('the home folder is shortened to ~', () => {
  // Made-up homes, built from pieces so the repo's privacy check stays strict.
  const USERS = ['C:', 'Users'].join('\\')
  const HOME = `${USERS}\\Ann Lee`
  const FWD = HOME.replace(/\\/g, '/')
  const NIX = ['', 'home', 'ann'].join('/')
  const win = homeRedactor(HOME, true)
  const nix = homeRedactor(NIX, false)

  it('in every form a Windows log uses', () => {
    expect(win(`at ${HOME}\\AppData\\x.jar`)).toBe('at ~\\AppData\\x.jar')
    expect(win(`Source=file:/${FWD}/mods/a.jar`)).toBe('Source=file:/~/mods/a.jar')
    expect(win(`file:///${FWD.replace(' ', '%20')}/mods`)).toBe('file:///~/mods')
    expect(win(`${HOME.toLowerCase()}\\x`)).toBe('~\\x') // paths aren't case-sensitive on Windows
    expect(win(`"${HOME}"`)).toBe('"~"')
  })

  it('only as a whole folder name', () => {
    expect(nix(`${NIX}/.minecraft and ${NIX}a/x`)).toBe(`~/.minecraft and ${NIX}a/x`)
    expect(win(`${HOME}ds\\x`)).toBe(`${HOME}ds\\x`)
  })

  it('never for a home folder that would hide everything', () => {
    expect(homeRedactor('/', false)('/usr/bin')).toBe('/usr/bin')
    expect(homeRedactor('C:\\', true)('C:\\Games')).toBe('C:\\Games')
  })

  it('in redact() and in every error message, for this computer', () => {
    const home = homedir()
    expect(redact(`log at ${home}${'/'}x.log`)).not.toContain(home)
    const shown = describeError(new KairoError('java-start', `There is no Java at ${join(home, 'java.exe')}.`))
    expect(shown.message).not.toContain(home)
    expect(shown.message).toContain('~')
  })
})

describe('Open crash report only opens a crash report', () => {
  const game = join(tmpdir(), 'installs', 'Fabric 1.20.1')
  const reports = join(game, 'crash-reports')

  it('accepts what Minecraft writes', () => {
    expect(isCrashReport(join(reports, 'crash-2026-11-05_13.11.25-client.txt'), game)).toBe(true)
  })

  it('refuses programs, other folders and tricks', () => {
    expect(isCrashReport(join(reports, 'crash-2026-11-05-client.exe'), game)).toBe(false)
    expect(isCrashReport(join(reports, 'crash-x.txt.bat'), game)).toBe(false)
    expect(isCrashReport(join(game, 'crash-x.txt'), game)).toBe(false)
    expect(isCrashReport(join(reports, 'sub', 'crash-x.txt'), game)).toBe(false)
    expect(isCrashReport(join(reports, '..', '..', 'crash-x.txt'), game)).toBe(false)
    expect(isCrashReport(join(tmpdir(), 'installs', 'Other', 'crash-reports', 'crash-x.txt'), game)).toBe(false)
  })
})

describe('modpacks download only from Modrinth', () => {
  it('accepts Modrinth CDN files over HTTPS', () => {
    expect(isModrinthCdn('https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar')).toBe(true)
  })

  it('refuses everything else, even services the launcher talks to', () => {
    expect(isModrinthCdn('http://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar')).toBe(false)
    expect(isModrinthCdn('https://objects.githubusercontent.com/github-production-release-asset/x.jar')).toBe(false)
    expect(isModrinthCdn('https://api.modrinth.com/v2/project/x')).toBe(false)
    expect(isModrinthCdn('https://cdn.modrinth.com.evil.example/data/x.jar')).toBe(false)
    expect(isModrinthCdn('https://user:pass@cdn.modrinth.com/data/x.jar')).toBe(false)
    expect(isModrinthCdn('not a url')).toBe(false)
  })
})

describe('links open only under the allowed addresses', () => {
  it('matches at a path boundary', () => {
    expect(isUnder('https://mordsome.github.io/Kairo', 'https://mordsome.github.io/Kairo')).toBe(true)
    expect(isUnder('https://mordsome.github.io/Kairo/news', 'https://mordsome.github.io/Kairo')).toBe(true)
    expect(isUnder('https://mordsome.github.io/Kairo?x=1', 'https://mordsome.github.io/Kairo')).toBe(true)
    expect(isUnder('https://mordsome.github.io/KairoFake', 'https://mordsome.github.io/Kairo')).toBe(false)
    expect(isUnder('https://github.com/Mordsome/Kairo', 'https://github.com/Mordsome/')).toBe(true)
    expect(isUnder('https://github.com/Mordsomething', 'https://github.com/Mordsome/')).toBe(false)
  })
})

describe('install records can only name files inside their install', () => {
  const base = {
    schema: 1,
    kind: 'custom',
    id: '0123456789ab',
    name: 'Forge 1.20.1',
    createdAt: 1,
    mc: '1.20.1',
    loader: 'forge',
    loaderVersion: null,
    installer: { file: '.kairo\\forge-1.20.1-47.4.28-installer.jar', sha1: 'a'.repeat(40) },
    versionId: null,
    wanted: [],
    mods: [{ filename: 'mods/sodium.jar' }],
    modpack: null,
    lastPlayed: null,
    playMinutes: 0
  }

  it('accepts a normal record', () => {
    expect(isCustom(base)).toBe(true)
    expect(isCustom({ ...base, installer: null })).toBe(true)
  })

  it('refuses paths that leave the install', () => {
    for (const file of ['..\\..\\evil.jar', '/etc/evil.jar', 'C:\\evil.jar', 'C:evil.jar', 'mods/../../x.jar', '']) {
      expect(isCustom({ ...base, installer: { ...base.installer, file } }), file).toBe(false)
      expect(isCustom({ ...base, mods: [{ filename: file }] }), file).toBe(false)
    }
  })

  it('refuses an installer without a proper checksum', () => {
    expect(isCustom({ ...base, installer: { file: 'x.jar', sha1: 'nope' } })).toBe(false)
  })
})
