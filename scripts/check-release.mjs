// Fails the build if the dev-only offline account made it into a normal build.
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../out/main/index.js', import.meta.url), 'utf8')
if (main.includes('OfflinePlayer:')) {
  console.error('The dev offline account is in this build. Build without --mode offline.')
  process.exit(1)
}
console.log('Release check: no offline account in the build.')
