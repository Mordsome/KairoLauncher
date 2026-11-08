// electron-builder runs this before packaging: whatever command started the
// packaging, a build with the dev-only offline account is never packaged.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function beforePack() {
  execFileSync(process.execPath, [join(__dirname, 'check-release.mjs')], { stdio: 'inherit' })
}
