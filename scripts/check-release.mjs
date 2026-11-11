// Fails the build if it isn't fit to ship: the dev-only offline account and
// the local test releases must not be in it, and it must carry Mordsome's release key (without it, the
// launcher couldn't check that its updates are really signed by Mordsome).
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../out/main/index.js', import.meta.url), 'utf8')
if (main.includes('OfflinePlayer:')) {
  console.error('The dev offline account is in this build. Build without --mode offline.')
  process.exit(1)
}
if (main.includes('KAIRO_TEST_')) {
  console.error('The local test releases (src/main/testRelease.ts) are in this build. Build without --mode offline.')
  process.exit(1)
}

const { publicKey } = JSON.parse(readFileSync(new URL('../config/release-key.json', import.meta.url), 'utf8'))
if (typeof publicKey !== 'string' || Buffer.from(publicKey, 'base64').length !== 44) {
  console.error('config/release-key.json has no release key. Run "npm run release:keygen" once (see docs/RELEASING.md).')
  process.exit(1)
}
if (!main.includes(publicKey)) {
  console.error("The release key isn't in this build. Rebuild after changing config/release-key.json.")
  process.exit(1)
}
console.log('Release check: no offline account, no test releases, release key built in.')
