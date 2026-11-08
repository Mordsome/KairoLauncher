import { useEffect, useRef, useState } from 'react'
import type { BackgroundSettings } from '../../../shared/api'
import { fieldColours } from '../state/look'
import { selectLook, selectTheme, useStore } from '../state/store'
import { PixelField, trailPeak, trailRadius } from './pixelField'

// The one background behind every screen: the Pixel field, Aurora, or the
// player's own picture. Changing it crossfades (CSS). Custom pictures come
// only through kairo-bg://, which serves the two stored files and nothing else.

const W = 1280
const H = 760

let field: PixelField | null = null

/** Lights the trail for a moment, so a new trail size can be seen while dragging. */
export function previewTrail(): void {
  field?.preview()
}

export function pictureUrl(slot: 'main' | 'void', version: number): string {
  return `${slot === 'main' ? 'kairo-bg://current' : 'kairo-bg://void'}/?v=${version}`
}

/** The system's "reduce motion" preference, kept up to date. */
function useSystemReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduce, setReduce] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setReduce(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduce
}

export function useReducedMotion(): boolean {
  const setting = useStore((s) => s.settings.reduceMotion)
  return useSystemReducedMotion() || setting
}

export function Background() {
  const bg = useStore((s) => s.settings.background)
  const theme = useStore(selectTheme)
  const look = useStore(selectLook)
  const files = useStore((s) => s.bgFiles)
  const problem = useStore((s) => s.bgProblem)
  const setProblem = useStore((s) => s.setBgProblem)
  const reduced = useReducedMotion()

  const main = files?.main ?? null
  const customOk = bg.kind === 'custom' && main !== null && problem === null
  const kind = bg.kind === 'custom' && !customOk ? 'pixels' : bg.kind
  const showPixels = kind === 'pixels' || (kind === 'custom' && bg.pixelsOnTop)
  const isVoid = theme === 'void'
  const voidPicture = bg.separateVoid ? (files?.void ?? null) : null

  const fieldCanvas = useRef<HTMLCanvasElement>(null)
  const dotCanvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    document.documentElement.dataset['reduceMotion'] = String(reduced)
  }, [reduced])

  useEffect(() => {
    if (!fieldCanvas.current || !dotCanvas.current) return
    field = new PixelField(fieldCanvas.current, dotCanvas.current)
    return () => {
      field?.destroy()
      field = null
    }
  }, [])

  useEffect(() => {
    field?.setOptions({
      ...fieldColours(look),
      stars: isVoid,
      radius: trailRadius(bg.trailSize),
      peak: trailPeak(bg.trailStrength),
      waves: bg.hoverWaves,
      ripples: bg.clickRipple,
      reduced,
      active: showPixels
    })
  }, [isVoid, look, bg.trailSize, bg.trailStrength, bg.hoverWaves, bg.clickRipple, reduced, showPixels])

  // A picture that's gone or can't be decoded: quietly back to the Pixel field (Settings says why).
  useEffect(() => {
    if (bg.kind !== 'custom' || !main) return
    let live = true
    const img = new Image()
    img.onerror = () => live && setProblem("Your background picture couldn't be shown, so the Pixel field is on instead. Choose it again or pick another.")
    img.src = pictureUrl('main', main.version)
    return () => {
      live = false
    }
  }, [bg.kind, main, setProblem])

  return (
    <div className="backdrop" aria-hidden="true" data-still={reduced}>
      <div className="bd-layer bd-aurora" data-on={kind === 'aurora'}>
        <div className="bd-blob bd-blob-a" />
        <div className="bd-blob bd-blob-b" />
        <div className="bd-blob bd-blob-c" />
        <svg className="bd-grain" width={W} height={H}>
          <filter id="bd-grain-filter">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
          </filter>
          <rect width={W} height={H} filter="url(#bd-grain-filter)" />
        </svg>
      </div>

      <div className="bd-layer bd-custom" data-on={kind === 'custom'}>
        {main && <Picture url={pictureUrl('main', main.version)} settings={bg} still={reduced} visible={!(isVoid && voidPicture)} />}
        {voidPicture && <Picture url={pictureUrl('void', voidPicture.version)} settings={bg} still={reduced} visible={isVoid} />}
        <div className="bd-dim" style={{ background: `rgba(0, 0, 0, ${bg.dim / 100})` }} />
      </div>

      <div className="bd-layer bd-pixels" data-on={showPixels}>
        <div className="bd-glow" />
        <canvas ref={dotCanvas} className="bd-canvas" />
        <canvas ref={fieldCanvas} className="bd-canvas" />
      </div>
    </div>
  )
}

function Picture({ url, settings, still, visible }: { url: string; settings: BackgroundSettings; still: boolean; visible: boolean }) {
  const blur = settings.blur
  // Blur softens the edges inwards, so the layer reaches a little past the window.
  const style = { inset: `${-blur * 2}px`, filter: blur ? `blur(${blur}px)` : undefined, opacity: visible ? 1 : 0 }
  if (still) {
    const size = { left: `${-blur * 2}px`, top: `${-blur * 2}px`, width: `${W + blur * 4}px`, height: `${H + blur * 4}px` }
    return <StillPicture url={url} fit={settings.fit} style={{ filter: style.filter, opacity: style.opacity, ...size }} />
  }
  return <div className="bd-picture" data-fit={settings.fit} style={{ ...style, backgroundImage: `url("${url}")` }} />
}

/** With reduced motion: the first frame only (an animated GIF stays still), drawn once. */
function StillPicture({ url, fit, style }: { url: string; fit: BackgroundSettings['fit']; style: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => {
      const canvas = ref.current
      if (!live || !canvas) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = W * dpr
      canvas.height = H * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      if (fit === 'tile') {
        const pattern = ctx.createPattern(img, 'repeat')
        if (pattern) {
          ctx.fillStyle = pattern
          ctx.fillRect(0, 0, W, H)
        }
        return
      }
      const scale = fit === 'fill' ? Math.max(W / iw, H / ih) : fit === 'fit' ? Math.min(W / iw, H / ih) : 1
      const dw = iw * scale
      const dh = ih * scale
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
    img.src = url
    return () => {
      live = false
    }
  }, [url, fit])
  return <canvas ref={ref} className="bd-picture bd-still" style={style} />
}
