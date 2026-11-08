// Tests the uninstaller's "delete the launcher's data" code for real (Windows only):
// it must empty the data folder, keep backups/, and never follow a junction or a
// symbolic link to delete what it points to. Everything happens in a temp folder.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32') {
  console.log('NSIS test: Windows only, skipped.')
  process.exit(0)
}

const makensis = (() => {
  const cache = join(homedir(), 'AppData', 'Local', 'electron-builder', 'Cache')
  for (const dir of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('nsis-3')) : []) {
    for (const sub of readdirSync(join(cache, dir))) {
      const exe = join(cache, dir, sub, 'makensis.exe')
      if (existsSync(exe)) return exe
    }
  }
  throw new Error('makensis not found: build the installer once (npm run dist:win) first.')
})()

const root = mkdtempSync(join(tmpdir(), 'kairo-nsis-'))
const file = (p, text = 'x') => {
  mkdirSync(resolve(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
const junction = (link, target) => symlinkSync(target, link, 'junction')

// Things that must survive.
file(join(root, 'precious', 'saves', 'World', 'level.dat'))
file(join(root, 'precious', 'secret.txt'))
file(join(root, 'data', 'backups', 'minecraft-2026', 'options.txt'))

// The data folder: real files, plus links that point at the precious folder.
file(join(root, 'data', 'settings.json'))
file(join(root, 'data', 'installs', 'abc', 'saves', 'w', 'level.dat'))
file(join(root, 'data', 'installs', 'abc', 'mods', 'a.jar'))
junction(join(root, 'data', 'installs', 'abc', 'linked-saves'), join(root, 'precious', 'saves'))
junction(join(root, 'data', 'link-at-top'), join(root, 'precious'))
let fileLinks = true
try {
  symlinkSync(join(root, 'precious', 'secret.txt'), join(root, 'data', 'installs', 'abc', 'secret-link.txt'), 'file')
} catch {
  fileLinks = false // symbolic links to files need Developer Mode; junctions are tested anyway
}
// The update cache, and a cache that is itself a junction.
file(join(root, 'cache', 'pending', 'update.exe'))
junction(join(root, 'cache-link'), join(root, 'precious'))

const out = join(root, 'remove-test.exe')
try {
  execFileSync(makensis, ['-V2', `-DOUT=${out}`, `-DBUILD=${resolve('build')}`, `-DROOT=${root}`, resolve('tests/nsis/remove.nsi')], { stdio: 'inherit' })
  execFileSync(out, [], { stdio: 'inherit' })

  const must = (cond, what) => {
    if (!cond) throw new Error(`NSIS test failed: ${what}`)
    console.log(`  ok  ${what}`)
  }
  must(existsSync(join(root, 'precious', 'saves', 'World', 'level.dat')), 'a junction inside an install is not followed')
  must(existsSync(join(root, 'precious', 'secret.txt')), 'a junction at the top of the data folder is not followed')
  must(existsSync(join(root, 'data', 'backups', 'minecraft-2026', 'options.txt')), 'the .minecraft backup is kept')
  must(!existsSync(join(root, 'data', 'settings.json')), 'settings are deleted')
  must(!existsSync(join(root, 'data', 'installs')), 'installs are deleted')
  must(!existsSync(join(root, 'data', 'link-at-top')), 'the link itself is removed')
  must(readdirSync(join(root, 'data')).join() === 'backups', 'only backups is left')
  must(!existsSync(join(root, 'cache')), 'the update cache is deleted')
  must(!existsSync(join(root, 'cache-link')) && existsSync(join(root, 'precious', 'secret.txt')), 'a cache folder that is a junction: only the link goes')
  if (fileLinks) must(existsSync(join(root, 'precious', 'secret.txt')), 'a symbolic link to a file is not followed')
  else console.log('  --  symbolic link to a file: skipped (needs Developer Mode)')
  console.log('NSIS test passed.')
} finally {
  rmSync(root, { recursive: true, force: true })
}
