// The Pixel field: a calm dot grid behind the UI, a soft trail behind a
// smoothed copy of the mouse, waves from hovered buttons and click ripples.
// Ported from design/backgrounds.dc.html, with the same values.
//
// Performance: nothing is allocated per frame (typed arrays, fixed pools for
// waves and ripples, colours precomputed per theme), the dot grid is drawn once
// on its own canvas, and the loop stops entirely when nothing moves.

export interface PixelOptions {
  theme: 'kairo' | 'void'
  /** Trail radius in cells: 0.8 small, 1.3 medium, 2.5 large. */
  radius: number
  /** Peak opacity of a lit cell: 0.35, 0.55 or 0.75. */
  peak: number
  waves: boolean
  ripples: boolean
  /** One still frame, no trail or animation. */
  reduced: boolean
  /** False while another background is showing: draw nothing, listen to nothing. */
  active: boolean
}

const W = 1280
const H = 760
const C = 18
const COLS = Math.ceil(W / C)
const ROWS = Math.ceil(H / C)
const N = COLS * ROWS
const MIX_STEPS = 10
const FRAME_MS = 1000 / 60
const ALPHA_STEPS = 100
const STARS = Math.round((W * H) / 9000)
const BUTTONS = 'button, [role="button"], [role="radio"], [role="tab"], [role="switch"], a[href]'

const COLOURS = {
  kairo: { a: [127, 216, 255], h: [255, 154, 82] },
  void: { a: [180, 140, 255], h: [255, 110, 199] }
} as const

interface Wave {
  on: boolean
  x0: number
  y0: number
  x1: number
  y1: number
  d: number
  max: number
  a: number
}
interface Ripple {
  on: boolean
  x: number
  y: number
  r: number
  max: number
}

/** Trail size setting (0..100) to a radius in cells. */
export function trailRadius(size: number): number {
  const s = Math.max(0, Math.min(100, size))
  return s <= 50 ? 0.8 + (s / 50) * 0.5 : 1.3 + ((s - 50) / 50) * 1.2
}

export function trailPeak(strength: 'subtle' | 'normal' | 'bright'): number {
  return strength === 'subtle' ? 0.35 : strength === 'bright' ? 0.75 : 0.55
}

export class PixelField {
  private readonly ctx: CanvasRenderingContext2D
  private readonly dotCtx: CanvasRenderingContext2D
  private readonly heat = new Float32Array(N)
  private readonly ox = new Float32Array(N)
  private readonly oy = new Float32Array(N)
  private readonly stars = new Float32Array(STARS * 5) // x, y, size, phase, speed
  private readonly waves: Wave[] = Array.from({ length: 12 }, () => ({ on: false, x0: 0, y0: 0, x1: 0, y1: 0, d: 0, max: 7, a: 0 }))
  private readonly ripples: Ripple[] = Array.from({ length: 8 }, () => ({ on: false, x: 0, y: 0, r: 0, max: 6 }))
  private palette: string[] = []
  private starFill: string[] = []
  private nextWave = 0
  private nextRipple = 0
  private mouseX = 0
  private mouseY = 0
  private hasMouse = false
  private fx = 0
  private fy = 0
  private hasF = false
  private hovered: Element | null = null
  private hoverAt = 0
  private raf = 0
  private frameNo = 0
  /** Time of the last processed frame; 0 when the loop starts fresh. */
  private lastT = 0
  /** How much the heat fades this frame (0.95 per 60 Hz frame). */
  private decay = 0.95
  private dpr = 1
  private opts: PixelOptions = { theme: 'kairo', radius: 1.3, peak: 0.55, waves: true, ripples: true, reduced: false, active: false }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly dots: HTMLCanvasElement
  ) {
    this.ctx = canvas.getContext('2d')!
    this.dotCtx = dots.getContext('2d')!
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c
        this.ox[i] = c * C + C / 2
        this.oy[i] = r * C + C / 2
      }
    }
    for (let k = 0; k < STARS; k++) {
      const o = k * 5
      this.stars[o] = Math.random() * W
      this.stars[o + 1] = Math.random() * H
      this.stars[o + 2] = Math.random() < 0.15 ? 2 : 1
      this.stars[o + 3] = Math.random() * Math.PI * 2
      this.stars[o + 4] = 0.4 + Math.random()
    }
    // Star brightness, precomputed in 50 steps so drawing them allocates nothing.
    for (let s = 0; s <= 50; s++) this.starFill.push(`rgba(230,220,255,${(s / 100).toFixed(3)})`)
    this.resize()
    window.addEventListener('pointermove', this.onMove, { passive: true })
    window.addEventListener('pointerdown', this.onDown, { passive: true })
    window.addEventListener('resize', this.onResize)
    document.documentElement.addEventListener('pointerleave', this.onLeave)
    document.addEventListener('pointerover', this.onOver, { passive: true })
    document.addEventListener('pointerout', this.onOut, { passive: true })
    document.addEventListener('focusin', this.onFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('resize', this.onResize)
    document.documentElement.removeEventListener('pointerleave', this.onLeave)
    document.removeEventListener('pointerover', this.onOver)
    document.removeEventListener('pointerout', this.onOut)
    document.removeEventListener('focusin', this.onFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  setOptions(next: PixelOptions): void {
    const themeChanged = next.theme !== this.opts.theme || next.peak !== this.opts.peak || this.palette.length === 0
    this.opts = next
    if (themeChanged) this.buildPalette()
    if (!next.active || next.reduced) {
      // Still frame: the dot grid (always drawn) plus still stars in Void.
      this.heat.fill(0)
      for (const w of this.waves) w.on = false
      for (const r of this.ripples) r.on = false
      this.hovered = null
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.draw(0)
      return
    }
    this.kick()
  }

  /** Lights the trail for a moment, e.g. to preview a new size while it's being dragged. */
  preview(): void {
    if (!this.opts.active || this.opts.reduced) return
    this.bump(W * 0.66, H * 0.5, this.opts.radius * 2, 0.6)
    this.kick()
  }

  // ---- input ----

  private toLocalX(clientX: number): number {
    const r = this.canvas.getBoundingClientRect()
    return ((clientX - r.left) * W) / (r.width || W)
  }

  private toLocalY(clientY: number): number {
    const r = this.canvas.getBoundingClientRect()
    return ((clientY - r.top) * H) / (r.height || H)
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.opts.active || this.opts.reduced) return
    this.mouseX = this.toLocalX(e.clientX)
    this.mouseY = this.toLocalY(e.clientY)
    this.hasMouse = true
    this.kick()
  }

  private readonly onLeave = (): void => {
    this.hasMouse = false
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.opts.active || this.opts.reduced || !this.opts.ripples) return
    const rp = this.ripples[this.nextRipple]!
    this.nextRipple = (this.nextRipple + 1) % this.ripples.length
    rp.on = true
    rp.x = this.toLocalX(e.clientX)
    rp.y = this.toLocalY(e.clientY)
    rp.r = 0
    rp.max = 6
    this.kick()
  }

  private buttonFrom(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null
    const el = target.closest(BUTTONS)
    if (!el || el.closest('.winctl, [data-no-wave]') || (el as HTMLButtonElement).disabled) return null
    return el
  }

  private readonly onOver = (e: PointerEvent): void => {
    if (!this.opts.active || this.opts.reduced || !this.opts.waves) return
    const el = this.buttonFrom(e.target)
    if (!el || el === this.hovered) return
    this.hovered = el
    this.hoverAt = performance.now()
    this.wave(el, 0.9)
  }

  private readonly onOut = (e: PointerEvent): void => {
    if (!this.hovered) return
    const to = e.relatedTarget
    if (!(to instanceof Node) || !this.hovered.contains(to)) this.hovered = null
  }

  /** Keyboard focus sends the same wave, so it isn't mouse-only. */
  private readonly onFocus = (e: FocusEvent): void => {
    if (!this.opts.active || this.opts.reduced || !this.opts.waves) return
    const el = this.buttonFrom(e.target)
    if (el && el.matches(':focus-visible')) this.wave(el, 0.9)
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else this.kick()
  }

  private readonly onResize = (): void => this.resize()

  // ---- drawing ----

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (dpr === this.dpr && this.canvas.width === W * dpr) return
    this.dpr = dpr
    for (const cv of [this.canvas, this.dots]) {
      cv.width = W * dpr
      cv.height = H * dpr
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.dotCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The dot grid never moves, so it's drawn once.
    this.dotCtx.clearRect(0, 0, W, H)
    this.dotCtx.fillStyle = 'rgba(255,255,255,0.03)'
    for (let i = 0; i < N; i++) this.dotCtx.fillRect(this.ox[i]! - 1, this.oy[i]! - 1, 2, 2)
    this.draw(0)
  }

  private buildPalette(): void {
    const { a, h } = COLOURS[this.opts.theme]
    this.palette = []
    for (let m = 0; m <= MIX_STEPS; m++) {
      const mix = m / MIX_STEPS
      const r = (a[0] + (h[0] - a[0]) * mix) | 0
      const g = (a[1] + (h[1] - a[1]) * mix) | 0
      const b = (a[2] + (h[2] - a[2]) * mix) | 0
      for (let s = 0; s <= ALPHA_STEPS; s++) this.palette.push(`rgba(${r},${g},${b},${(s / ALPHA_STEPS).toFixed(2)})`)
    }
  }

  private kick(): void {
    if (this.raf || !this.opts.active || this.opts.reduced || document.hidden) return
    this.lastT = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (t: number): void => {
    this.raf = 0
    if (!this.opts.active || this.opts.reduced || document.hidden) return
    // The reference values are per 60 Hz frame. On faster screens, skip frames
    // (it's a calm background: 60 fps is plenty) and scale motion by elapsed time.
    const dt = this.lastT ? t - this.lastT : FRAME_MS
    if (dt < FRAME_MS - 2) {
      this.raf = requestAnimationFrame(this.frame)
      return
    }
    this.lastT = t
    const k = Math.min(3, dt / FRAME_MS)
    this.decay = Math.pow(0.95, k)
    this.frameNo++
    const busy = this.step(t, k)
    // Idle in Void: only the stars twinkle, and they're slow, so every third frame is plenty.
    const starsOnly = !busy && this.opts.theme === 'void'
    if (busy || (starsOnly && this.frameNo % 3 === 0)) this.draw(t)
    // A wave started during this frame may already have scheduled the next one: never run two loops.
    if ((busy || starsOnly) && !this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private bump(px: number, py: number, rad: number, amt: number): void {
    const cc = Math.floor(px / C)
    const rc = Math.floor(py / C)
    const R = Math.ceil(rad)
    for (let r = rc - R; r <= rc + R; r++) {
      if (r < 0 || r >= ROWS) continue
      for (let c = cc - R; c <= cc + R; c++) {
        if (c < 0 || c >= COLS) continue
        const d = Math.hypot(c - cc, r - rc)
        if (d > rad) continue
        const i = r * COLS + c
        this.heat[i] = Math.min(1, this.heat[i]! + amt * (1 - d / (rad + 0.5)))
      }
    }
  }

  /** A wave of lit cells growing outward from a button's outline. */
  private wave(el: Element, strength: number): void {
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) return
    const r = this.canvas.getBoundingClientRect()
    const sx = W / (r.width || W)
    const sy = H / (r.height || H)
    const w = this.waves[this.nextWave]!
    this.nextWave = (this.nextWave + 1) % this.waves.length
    w.on = true
    w.x0 = (b.left - r.left) * sx
    w.y0 = (b.top - r.top) * sy
    w.x1 = (b.right - r.left) * sx
    w.y1 = (b.bottom - r.top) * sy
    w.d = 0
    w.max = 7 * (this.opts.radius / 1.3) // reach scales with the trail size
    w.a = strength
    this.kick()
  }

  /** Advances one frame (k = elapsed time in 60 Hz frames). True while anything is still moving or lit. */
  private step(t: number, k: number): boolean {
    let busy = false
    // The trail follows a smoothed copy of the mouse, so it glides instead of jumping.
    if (this.hasMouse) {
      if (!this.hasF) {
        this.fx = this.mouseX
        this.fy = this.mouseY
        this.hasF = true
      }
      const px = this.fx
      const py = this.fy
      const follow = 1 - Math.pow(1 - 0.22, k)
      this.fx += (this.mouseX - this.fx) * follow
      this.fy += (this.mouseY - this.fy) * follow
      const mvx = this.fx - px
      const mvy = this.fy - py
      const speed = Math.hypot(mvx, mvy) / k // per 60 Hz frame, as in the reference
      if (speed > 0.4) {
        busy = true
        const amt = Math.min(0.22, 0.05 + speed * 0.012) * k
        const steps = Math.min(10, Math.ceil(speed / 9))
        for (let s = 1; s <= steps; s++) this.bump(px + (mvx * s) / steps, py + (mvy * s) / steps, this.opts.radius, (amt / steps) * 2)
      }
    } else this.hasF = false

    // A hovered button keeps sending a gentler wave every ~1.6 s.
    if (this.hovered) {
      busy = true
      // A button that was hidden or disabled under the pointer never sends "pointer left": drop it then.
      const h = this.hovered
      if (!h.isConnected || h.closest('[inert]') || (h as HTMLButtonElement).disabled || !h.matches(':hover')) this.hovered = null
      else if (t - this.hoverAt > 1600) {
        this.hoverAt = t
        this.wave(this.hovered, 0.32)
      }
    }

    for (let wi = 0; wi < this.waves.length; wi++) {
      const w = this.waves[wi]!
      if (!w.on) continue
      busy = true
      w.d += 0.14 * k
      const fade = w.a * Math.pow(Math.max(0, 1 - w.d / w.max), 1.5)
      const c0 = Math.max(0, Math.floor((w.x0 - w.max * C) / C))
      const c1 = Math.min(COLS - 1, Math.ceil((w.x1 + w.max * C) / C))
      const r0 = Math.max(0, Math.floor((w.y0 - w.max * C) / C))
      const r1 = Math.min(ROWS - 1, Math.ceil((w.y1 + w.max * C) / C))
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * COLS + c
          const x = this.ox[i]!
          const y = this.oy[i]!
          const dx = Math.max(w.x0 - x, 0, x - w.x1)
          const dy = Math.max(w.y0 - y, 0, y - w.y1)
          const dist = Math.hypot(dx, dy) / C
          if (dist === 0) continue
          const band = 1 - Math.abs(dist - w.d) / 0.9
          if (band > 0) this.heat[i] = Math.min(1, this.heat[i]! + fade * band * 0.22 * k)
        }
      }
      if (w.d >= w.max) w.on = false
    }

    for (let ri = 0; ri < this.ripples.length; ri++) {
      const rp = this.ripples[ri]!
      if (!rp.on) continue
      busy = true
      rp.r += 0.35 * k
      const n = Math.max(12, Math.round(rp.r * 7))
      for (let a = 0; a < n; a++) {
        const ang = (a / n) * Math.PI * 2
        this.bump(rp.x + Math.cos(ang) * rp.r * C, rp.y + Math.sin(ang) * rp.r * C, 0.6, 0.35 * Math.max(0, 1 - rp.r / rp.max) * k)
      }
      if (rp.r >= rp.max) rp.on = false
    }

    // Lit cells keep the loop going until they've faded.
    if (!busy) {
      for (let i = 0; i < N; i++) {
        if (this.heat[i]! >= 0.01) {
          busy = true
          break
        }
      }
    }
    return busy
  }

  private draw(t: number): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, W, H)
    if (this.opts.theme === 'void') {
      const still = this.opts.reduced || !this.opts.active
      for (let k = 0; k < STARS; k++) {
        const o = k * 5
        const a = still ? 0.35 : 0.2 + 0.2 * Math.sin((t / 1000) * this.stars[o + 4]! * 0.6 + this.stars[o + 3]!)
        ctx.fillStyle = this.starFill[Math.round(Math.max(0.04, Math.min(0.5, a)) * 100)]!
        const s = this.stars[o + 2]!
        ctx.fillRect(this.stars[o]!, this.stars[o + 1]!, s, s)
      }
    }
    if (!this.opts.active) return
    const peak = this.opts.peak
    for (let i = 0; i < N; i++) {
      const h = this.heat[i]!
      if (h < 0.01) {
        this.heat[i] = 0
        continue
      }
      const e = h * h * (3 - 2 * h) // smoothstep: cells ease in and out
      const mix = h > 0.7 ? (h - 0.7) / 0.3 : 0 // hot colour only at the very peak
      ctx.fillStyle = this.palette[Math.round(mix * MIX_STEPS) * (ALPHA_STEPS + 1) + Math.round(e * peak * ALPHA_STEPS)]!
      const sz = C - 8 + 4 * e
      ctx.fillRect(this.ox[i]! - sz / 2, this.oy[i]! - sz / 2, sz, sz)
      this.heat[i] = h * this.decay
    }
  }
}
