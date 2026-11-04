// Just enough of Fabric's version ranges to check what fabric.mod.json asks for:
// "*", ">=x", ">x", "<=x", "<x", "=x", "x", "~x", "^x", "x.y.x", space = AND,
// and an array = OR. Build metadata (+...) is ignored.

interface Parsed {
  nums: number[]
  pre: string | null
}

function parse(version: string): Parsed | null {
  const core = version.trim().split('+')[0] ?? ''
  const dash = core.indexOf('-')
  const main = dash >= 0 ? core.slice(0, dash) : core
  const pre = dash >= 0 ? core.slice(dash + 1) : null
  if (!/^\d+(\.\d+)*$/.test(main)) return null
  return { nums: main.split('.').map(Number), pre }
}

/** -1, 0 or 1. Unparseable versions sort first. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return pa.pre < pb.pre ? -1 : 1
}

function bump(version: string, index: number): string {
  const nums = parse(version)?.nums ?? [0]
  const out = nums.slice(0, index + 1)
  while (out.length <= index) out.push(0)
  out[index] = (out[index] ?? 0) + 1
  return out.join('.')
}

function matchesOne(version: string, comparator: string): boolean {
  const c = comparator.trim()
  if (c === '' || c === '*') return true
  const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(c)
  if (!m) return false
  const op = m[1] ?? '='
  const target = m[2] ?? ''
  if (/\.x$|\.\*$/i.test(target)) {
    const prefix = target.replace(/\.(x|\*)$/i, '')
    return version === prefix || version.startsWith(`${prefix}.`)
  }
  const cmp = compareVersions(version, target)
  switch (op) {
    case '>=':
      return cmp >= 0
    case '<=':
      return cmp <= 0
    case '>':
      return cmp > 0
    case '<':
      return cmp < 0
    case '~':
      return cmp >= 0 && compareVersions(version, bump(target, 1)) < 0
    case '^':
      return cmp >= 0 && compareVersions(version, bump(target, 0)) < 0
    default:
      return cmp === 0
  }
}

export function satisfies(version: string, range: string | string[] | undefined): boolean {
  if (range === undefined) return true
  const options = Array.isArray(range) ? range : [range]
  return options.some((r) => r.split(/\s+/).every((c) => matchesOne(version, c)))
}

/** Human-readable form of a range, for error messages. */
export function describeRange(range: string | string[] | undefined): string {
  if (range === undefined) return 'any version'
  return Array.isArray(range) ? range.join(' or ') : range
}
