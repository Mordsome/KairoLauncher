// electron-builder runs this after packaging the app, before making the
// installer. For Windows it writes build/uninstall-files.nsh: the exact list of
// files and folders the installer puts in the install folder, so the
// uninstaller removes those by name and never deletes the folder recursively
// (build/installer.nsh explains why).
const { readdirSync, writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')

/** Every file and folder under dir, as paths relative to root. */
function walk(root, dir = root, files = [], folders = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(root, full)
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in the packaged app: ${rel}`)
    if (entry.isDirectory()) {
      walk(root, full, files, folders)
      folders.push(rel) // after its contents, so the deepest folders come first
    } else {
      files.push(rel)
    }
  }
  return { files, folders }
}

/** A path for an NSIS string. Anything NSIS would treat specially is refused. */
function nsisPath(rel) {
  if (!/^[\w .()+,@\[\]{}~=#&'-]+(\\[\w .()+,@\[\]{}~=#&'-]+)*$/.test(rel) || rel.includes('..')) {
    throw new Error(`Unexpected file name in the packaged app: ${rel}`)
  }
  return `"$INSTDIR\\${rel}"`
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { files, folders } = walk(context.appOutDir)
  if (!files.some((f) => f.toLowerCase().endsWith('.exe'))) throw new Error('No .exe in the packaged app')
  const lines = [
    '; Made by scripts/after-pack.cjs at build time. Do not edit.',
    '; The files and folders the installer puts in $INSTDIR, removed one by one.',
    '!macro kairoRemoveAppFiles',
    ...files.map((f) => `  Delete ${nsisPath(f.replace(/\//g, '\\'))}`),
    // RMDir without /r: a folder goes only once it's empty.
    ...folders.map((d) => `  RMDir ${nsisPath(d.replace(/\//g, '\\'))}`),
    '!macroend',
    ''
  ]
  writeFileSync(join(context.packager.info.buildResourcesDir, 'uninstall-files.nsh'), lines.join('\r\n'))
  console.log(`  • uninstall list: ${files.length} files, ${folders.length} folders`)
}
