import type { InstallLook, Rounding } from '../../../shared/api'

// An install's look: an accent colour and how round the corners are. Kairo and
// Void are two looks with their hand-tuned palettes; any other accent gets a
// palette worked out from its hue. Everything ends up as the theme's CSS
// variables on <html>, so the launcher, Aurora and the Pixel field all follow.

export const KAIRO_LOOK: InstallLook = { accent: '#7fd8ff', rounding: 'round' }
export const VOID_LOOK: InstallLook = { accent: '#b48cff', rounding: 'sharp' }

/** Ready-made accents shown in the Appearance dialog. */
export const SWATCHES: { name: string; accent: string }[] = [
  { name: 'Kairo blue', accent: KAIRO_LOOK.accent },
  { name: 'Void violet', accent: VOID_LOOK.accent },
  { name: 'Mint', accent: '#6ee7b7' },
  { name: 'Lime', accent: '#b5e86a' },
  { name: 'Gold', accent: '#ffd166' },
  { name: 'Ember', accent: '#ff9a6b' },
  { name: 'Rose', accent: '#ff8fb8' },
  { name: 'Ice', accent: '#c9d6e8' }
]

export const ROUNDINGS: { id: Rounding; name: string }[] = [
  { id: 'round', name: 'Round' },
  { id: 'soft', name: 'Soft' },
  { id: 'sharp', name: 'Sharp' }
]

const RADII: Record<Rounding, Record<string, string>> = {
  // "Full" is 40px rather than 999px so changing it animates smoothly.
  round: { '--r-full': '40px', '--r-row': '16px', '--r-card': '18px', '--r-panel': '22px', '--r-sheet': '28px', '--r-btn': '14px', '--r-small': '10px' },
  soft: { '--r-full': '12px', '--r-row': '10px', '--r-card': '12px', '--r-panel': '14px', '--r-sheet': '16px', '--r-btn': '10px', '--r-small': '7px' },
  sharp: { '--r-full': '6px', '--r-row': '6px', '--r-card': '6px', '--r-panel': '6px', '--r-sheet': '6px', '--r-btn': '6px', '--r-small': '6px' }
}

const KAIRO_COLOURS: Record<string, string> = {
  '--bg': '#0a1322',
  '--bg-glow': '#12233c',
  '--deep': '#1f4b8f',
  '--glow-soft': 'rgba(127, 216, 255, 0.1)',
  '--ink': '#eaf4fb',
  '--ink2': '#b3c4d4',
  '--accent': '#7fd8ff',
  '--accent-ink': '#062033',
  '--hot': '#ff9a52',
  '--hot-ink': '#1c0b02',
  '--line': 'rgba(200, 235, 255, 0.2)',
  '--line-soft': 'rgba(200, 235, 255, 0.12)',
  '--rail': 'rgba(8, 14, 26, 0.78)',
  '--panel': 'rgba(190, 225, 255, 0.06)',
  '--card': 'rgba(190, 225, 255, 0.07)',
  '--card-line': 'rgba(200, 235, 255, 0.18)',
  '--split-line': 'rgba(6, 32, 51, 0.3)',
  '--sel-bg': 'rgba(127, 216, 255, 0.14)',
  '--sel-line': 'rgba(127, 216, 255, 0.6)',
  '--rail-active': 'rgba(127, 216, 255, 0.14)'
}

const VOID_COLOURS: Record<string, string> = {
  '--bg': '#130a2a',
  '--bg-glow': '#2a1658',
  '--deep': '#4b1fa8',
  '--glow-soft': 'rgba(160, 110, 255, 0.18)',
  '--ink': '#f4eeff',
  '--ink2': '#c9b9ec',
  '--accent': '#b48cff',
  '--accent-ink': '#1a0838',
  '--hot': '#ff6ec7',
  '--hot-ink': '#2a0520',
  '--line': 'rgba(190, 150, 255, 0.28)',
  '--line-soft': 'rgba(190, 150, 255, 0.18)',
  '--rail': 'rgba(28, 14, 58, 0.88)',
  '--panel': 'rgba(160, 110, 255, 0.1)',
  '--card': 'rgba(160, 110, 255, 0.1)',
  '--card-line': 'rgba(190, 150, 255, 0.26)',
  '--split-line': 'rgba(26, 8, 56, 0.4)',
  '--sel-bg': 'rgba(180, 140, 255, 0.24)',
  '--sel-line': 'rgba(200, 160, 255, 0.75)',
  '--rail-active': 'rgba(167, 124, 255, 0.16)'
}

export function isHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v)
}

export function sameLook(a: InstallLook, b: InstallLook): boolean {
  return a.accent.toLowerCase() === b.accent.toLowerCase() && a.rounding === b.rounding
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as [number, number, number]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = (x: number) => {
    const v = x < 0 ? x + 1 : x > 1 ? x - 1 : x
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }
  return [Math.round(t(hh + 1 / 3) * 255), Math.round(t(hh) * 255), Math.round(t(hh - 1 / 3) * 255)]
}

function rgba(c: [number, number, number], a = 1): string {
  return a === 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
}

function toHex(c: [number, number, number]): string {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * The accent as the launcher shows it: kept light enough that dark text on it
 * (buttons) and it on the dark background both stay readable.
 */
export function shownAccent(accent: string): string {
  if (!isHex(accent)) return KAIRO_LOOK.accent
  const [h, s, l] = rgbToHsl(hexToRgb(accent))
  const clamped = Math.min(0.85, Math.max(0.62, l))
  return clamped === l ? accent.toLowerCase() : toHex(hslToRgb(h, s, clamped))
}

/** Every colour variable for an accent. */
export function coloursFor(accent: string): Record<string, string> {
  const a = accent.toLowerCase()
  if (a === KAIRO_LOOK.accent) return KAIRO_COLOURS
  if (a === VOID_LOOK.accent) return VOID_COLOURS
  const shown = shownAccent(a)
  const rgb = hexToRgb(shown)
  const [h, s] = rgbToHsl(rgb)
  const hsl = (hue: number, sat: number, light: number) => hslToRgb(hue, sat, light)
  const tint = hsl(h, Math.min(1, s), 0.88)
  return {
    '--bg': rgba(hsl(h, 0.55 * s, 0.09)),
    '--bg-glow': rgba(hsl(h, 0.55 * s, 0.16)),
    '--deep': rgba(hsl(h, 0.65 * s, 0.34)),
    '--glow-soft': rgba(rgb, 0.12),
    '--ink': rgba(hsl(h, 0.6 * s, 0.95)),
    '--ink2': rgba(hsl(h, 0.3 * s, 0.77)),
    '--accent': rgba(rgb),
    '--accent-ink': rgba(hsl(h, 0.75 * s, 0.11)),
    '--hot': rgba(hsl(h - 170, s ? 1 : 0, 0.66)),
    '--hot-ink': rgba(hsl(h - 170, s ? 0.8 : 0, 0.08)),
    '--line': rgba(tint, 0.2),
    '--line-soft': rgba(tint, 0.12),
    '--rail': rgba(hsl(h, 0.55 * s, 0.06), 0.8),
    '--panel': rgba(tint, 0.06),
    '--card': rgba(tint, 0.07),
    '--card-line': rgba(tint, 0.18),
    '--split-line': rgba(hsl(h, 0.75 * s, 0.11), 0.3),
    '--sel-bg': rgba(rgb, 0.14),
    '--sel-line': rgba(rgb, 0.6),
    '--rail-active': rgba(rgb, 0.14)
  }
}

/** All the CSS variables for a look. */
export function lookVars(look: InstallLook): Record<string, string> {
  return {
    ...coloursFor(look.accent),
    ...RADII[look.rounding],
    '--glass': look.rounding === 'sharp' ? 'none' : 'blur(20px)'
  }
}

/** The accent and the "hot" colour as RGB, for the Pixel field's canvas. */
export function fieldColours(look: InstallLook): { accent: [number, number, number]; hot: [number, number, number] } {
  const c = coloursFor(look.accent)
  return { accent: cssRgb(c['--accent']!), hot: cssRgb(c['--hot']!) }
}

function cssRgb(v: string): [number, number, number] {
  if (v.startsWith('#')) return hexToRgb(v)
  const m = v.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

/** Puts a look on <html>. */
export function applyLook(look: InstallLook): void {
  const style = document.documentElement.style
  for (const [k, v] of Object.entries(lookVars(look))) style.setProperty(k, v)
}
