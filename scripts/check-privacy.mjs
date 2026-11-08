// Fails the build if a committed file could reveal who made it: a path inside
// someone's home folder, or game output (logs, crash reports) that contains them.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const problems = []

const gameOutput = /(^|\/)(logs|crash-reports)\/|\.log(\.gz)?$|(^|\/)hs_err_pid\d+/
// A home folder followed by a real name, e.g. C:\Users\name\ or /home/name/. "<you>"-style placeholders are fine.
const homePath = /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<|%|\$|\{)[^\\/\s"'`<>]+|(?:^|[\s"'`(=])\/(?:home|Users)\/(?!<|\$|\{)[^/\s"'`<>]+/m

for (const file of files) {
  if (gameOutput.test(file)) {
    problems.push(`${file}: game output should never be committed`)
    continue
  }
  if (/\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|gz|zip|jar)$/i.test(file)) continue
  const text = readFileSync(file, 'utf8')
  const hit = text.match(homePath)
  if (hit) problems.push(`${file}: a path inside a home folder ("${hit[0].trim().slice(0, 12)}…")`)
}

if (problems.length) {
  console.error('Privacy check failed:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(`Privacy check: ${files.length} committed files, no personal paths or game output.`)
