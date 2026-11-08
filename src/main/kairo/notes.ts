// Patch notes for Home, from a Kairo release's description (Markdown).
// Only plain text comes out: the UI never renders release text as HTML.

const MAX_POINTS = 4
const MAX_LENGTH = 140

/** A heading for the "what's new" part of a release: New in 0.2.0, Highlights, What's Changed... */
const NEW_SECTION = /^\s*#{1,6}\s*.*\b(new|what'?s new|changed|changes|changelog|highlights|features|added|improvements|fixes)\b/i
const HEADING = /^\s*#{1,6}\s/
const BULLET = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+)$/
const NOT_TEXT = /^\s*(#|```|---|\*\*\*|>|\|)/

function plain(text: string): string {
  return (
    text
      // GitHub's generated notes end each line with "by @someone in <link>".
      .replace(/\s+by\s+@[\w-]+\s+in\s+https?:\/\/\S+\s*$/i, '')
      .replace(/<[^>]*>/g, '') // HTML tags
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: keep the words
      .replace(/https?:\/\/\S+/g, '') // bare links
      .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2') // italics, not snake_case
      .replace(/`([^`]+)`/g, '$1') // code
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Long points end at a sentence if one fits, else at a word, with "…". */
function shorten(text: string): string {
  if (text.length <= MAX_LENGTH) return text
  const head = text.slice(0, MAX_LENGTH)
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentence >= 40) return head.slice(0, sentence + 1)
  const word = head.lastIndexOf(' ', MAX_LENGTH - 2)
  return `${head.slice(0, word > 40 ? word : MAX_LENGTH - 1).trimEnd()}…`
}

/** Bullet points, each joined with the lines it wraps onto. */
function bulletsOf(lines: string[]): string[] {
  const out: string[] = []
  let current: string | null = null
  for (const line of lines) {
    const start = BULLET.exec(line)?.[1]
    if (start !== undefined) {
      if (current !== null) out.push(current)
      current = start
    } else if (current !== null && line.trim() && !HEADING.test(line) && !NOT_TEXT.test(line)) {
      current += ` ${line.trim()}`
    } else if (current !== null) {
      out.push(current)
      current = null
    }
  }
  if (current !== null) out.push(current)
  return out.map(plain).filter((x) => x.length > 1)
}

/**
 * Up to four short points: the bullets of the release's "what's new" section if it has
 * one, else its opening sentence, else any bullets.
 */
export function notePoints(body: string | null | undefined): string[] {
  if (!body) return []
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => NEW_SECTION.test(line))
  if (start >= 0) {
    const end = lines.findIndex((line, i) => i > start && HEADING.test(line))
    const points = bulletsOf(lines.slice(start + 1, end < 0 ? undefined : end))
    if (points.length) return points.slice(0, MAX_POINTS).map(shorten)
  }
  const intro = lines.find((line) => line.trim() && !BULLET.test(line) && !NOT_TEXT.test(line) && plain(line).length > 1)
  if (intro) return [shorten(plain(intro))]
  return bulletsOf(lines).slice(0, MAX_POINTS).map(shorten)
}
