import { useState } from 'react'
import type { BackgroundKind, BackgroundResult, BackgroundSettings, BackgroundSlot } from '../../../shared/api'
import { pictureUrl, previewTrail, useReducedMotion } from '../background/Background'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { SwitchRow } from '../components/Switch'
import { useStore } from '../state/store'

const MAX_BYTES = 50 * 1024 * 1024
const PIXEL_DEFAULTS: Partial<BackgroundSettings> = { trailSize: 50, trailStrength: 'normal', hoverWaves: true, clickRipple: true }

type Problem = { title: string; message: string } | null

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: [T, string][]
  onChange(value: T): void
}) {
  return (
    <div className="seg-row">
      <span className="field-label">{label}</span>
      <div role="radiogroup" aria-label={label} className="seg" data-roving onKeyDown={(e) => rovingKeyDown(e, { select: true })}>
        {options.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="radio"
            className="seg-item"
            aria-checked={value === id}
            tabIndex={rovingTabIndex(value === id)}
            onClick={() => onChange(id)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  shown,
  ends,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  shown: string
  ends?: [string, string, string?]
  onChange(value: number): void
}) {
  const id = `bg-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="bg-slider">
      <label htmlFor={id} className="mem-label">
        <span>{label}</span>
        <b className="mem-value">{shown}</b>
      </label>
      <input
        id={id}
        className="mem-range"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {ends && (
        <span className="bg-slider-ends" aria-hidden="true">
          <span>{ends[0]}</span>
          {ends[2] && <span>{ends[2]}</span>}
          <span>{ends[1]}</span>
        </span>
      )}
    </div>
  )
}

function sizeName(size: number): string {
  return size < 34 ? 'Small' : size > 66 ? 'Large' : 'Medium'
}

export function BackgroundSection() {
  const bg = useStore((s) => s.settings.background)
  const reduceSetting = useStore((s) => s.settings.reduceMotion)
  const files = useStore((s) => s.bgFiles)
  const problem = useStore((s) => s.bgProblem)
  const update = useStore((s) => s.updateSettings)
  const setFiles = useStore((s) => s.setBgFiles)
  const reduced = useReducedMotion()
  const [error, setError] = useState<Problem>(null)
  const [dragging, setDragging] = useState(false)

  const setBg = (patch: Partial<BackgroundSettings>) => update({ background: { ...bg, ...patch } })

  const handle = (result: BackgroundResult, slot: BackgroundSlot) => {
    if (result.ok) {
      setFiles(result.files)
      setError(null)
      setBg(slot === 'main' ? { kind: 'custom' } : { separateVoid: true })
    } else if (!result.cancelled) setError(result.error)
  }

  const choose = (slot: BackgroundSlot) => void window.kairo.background.pick(slot).then((r) => handle(r, slot))

  const remove = async (slot: BackgroundSlot) => {
    setFiles(await window.kairo.background.remove(slot))
    setError(null)
    setBg(slot === 'main' ? { kind: 'pixels' } : { separateVoid: false })
  }

  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError({ title: 'That picture is too big', message: 'Pick one under 50 MB.' })
      return
    }
    handle(await window.kairo.background.importBytes('main', new Uint8Array(await file.arrayBuffer())), 'main')
  }

  const pick = (kind: BackgroundKind) => {
    setError(null)
    if (kind === 'custom' && !files?.main) choose('main')
    else setBg({ kind })
  }

  const main = files?.main ?? null
  const cards: [BackgroundKind, string][] = [
    ['pixels', 'Pixel field'],
    ['aurora', 'Aurora'],
    ['custom', 'Custom']
  ]

  return (
    <div
      className="card bg-card"
      data-dragging={dragging}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => void drop(e)}
    >
      <span className="setting-name">Background</span>
      <div role="radiogroup" aria-label="Background" className="bg-cards" data-roving onKeyDown={(e) => rovingKeyDown(e, { columns: 3 })}>
        {cards.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="radio"
            className="bg-choice"
            aria-checked={bg.kind === id}
            tabIndex={rovingTabIndex(bg.kind === id)}
            onClick={() => pick(id)}
          >
            <span className={`bg-preview bg-preview-${id}`} aria-hidden="true">
              {id === 'pixels' && <PixelPreview />}
              {id === 'aurora' && (
                <>
                  <span className="pv-blob pv-blob-a" />
                  <span className="pv-blob pv-blob-b" />
                  <span className="pv-blob pv-blob-c" />
                </>
              )}
              {id === 'custom' &&
                (main ? (
                  <span className="pv-picture" style={{ backgroundImage: `url("${pictureUrl('main', main.version)}")` }} />
                ) : (
                  <span className="pv-empty">Choose image…</span>
                ))}
            </span>
            <span className="bg-choice-name">{name}</span>
          </button>
        ))}
      </div>

      {problem && bg.kind === 'custom' && (
        <p className="modal-error" role="status">
          {problem}
        </p>
      )}
      {error && (
        <p className="modal-error" role="alert">
          <b>{error.title}</b> {error.message}
        </p>
      )}

      {bg.kind === 'pixels' && (
        <div className="bg-options">
          <Slider
            label="Trail size"
            value={bg.trailSize}
            min={0}
            max={100}
            shown={sizeName(bg.trailSize)}
            ends={['Small', 'Large', 'Medium']}
            onChange={(trailSize) => {
              setBg({ trailSize })
              requestAnimationFrame(previewTrail)
            }}
          />
          <Segmented
            label="Trail strength"
            value={bg.trailStrength}
            options={[
              ['subtle', 'Subtle'],
              ['normal', 'Normal'],
              ['bright', 'Bright']
            ]}
            onChange={(trailStrength) => setBg({ trailStrength })}
          />
          <SwitchRow
            label="Hover waves"
            description="A soft wave from buttons you point at or move to with the keyboard"
            checked={bg.hoverWaves}
            onChange={(hoverWaves) => setBg({ hoverWaves })}
          />
          <SwitchRow
            label="Click ripple"
            description="A small ring of light where you click"
            checked={bg.clickRipple}
            onChange={(clickRipple) => setBg({ clickRipple })}
          />
          <div>
            <button type="button" className="btn-ghost btn-small" onClick={() => setBg(PIXEL_DEFAULTS)}>
              Reset to defaults
            </button>
          </div>
        </div>
      )}

      {bg.kind === 'aurora' && <p className="setting-desc">Slow, soft colour in the launcher's own colours.</p>}

      {bg.kind === 'custom' && main && (
        <div className="bg-options">
          <div className="bg-buttons">
            <button type="button" className="btn-ghost btn-small" onClick={() => choose('main')}>
              Choose image…
            </button>
            <button type="button" className="btn-ghost btn-small btn-danger-text" onClick={() => void remove('main')}>
              Remove image
            </button>
            <span className="setting-desc">Or drop a PNG, JPG, WebP or GIF here.</span>
          </div>
          <Segmented
            label="Fit"
            value={bg.fit}
            options={[
              ['fill', 'Fill'],
              ['fit', 'Fit'],
              ['centre', 'Centre'],
              ['tile', 'Tile']
            ]}
            onChange={(fit) => setBg({ fit })}
          />
          <Slider label="Dim" value={bg.dim} min={0} max={80} shown={`${bg.dim}%`} onChange={(dim) => setBg({ dim })} />
          <Slider label="Blur" value={bg.blur} min={0} max={20} shown={`${bg.blur} px`} onChange={(blur) => setBg({ blur })} />
          <SwitchRow
            label="Pixel field on top"
            description="The dot grid, trail and waves over your picture"
            checked={bg.pixelsOnTop}
            onChange={(pixelsOnTop) => setBg({ pixelsOnTop })}
          />
          <SwitchRow
            label="Use a different image for Kairo Void"
            description="It fades in when the launcher turns violet"
            checked={bg.separateVoid}
            onChange={(on) => (on && !files?.void ? choose('void') : setBg({ separateVoid: on }))}
          />
          {bg.separateVoid && files?.void && (
            <div className="bg-buttons">
              <span className="pv-thumb" style={{ backgroundImage: `url("${pictureUrl('void', files.void.version)}")` }} aria-hidden="true" />
              <button type="button" className="btn-ghost btn-small" onClick={() => choose('void')}>
                Choose Void image…
              </button>
              <button type="button" className="btn-ghost btn-small btn-danger-text" onClick={() => void remove('void')}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      <SwitchRow
        label="Reduce motion"
        description={
          reduced && !reduceSetting ? 'On because your system asks for less motion.' : 'Keeps the background still: no trail, waves or moving colour.'
        }
        checked={reduced}
        onChange={(reduceMotion) => update({ reduceMotion })}
      />
    </div>
  )
}

/** A still sample of the Pixel field: a few lit cells on the dot grid. */
function PixelPreview() {
  const cells: [number, number, number][] = [
    [5, 2, 0.25],
    [6, 2, 0.45],
    [6, 3, 0.6],
    [7, 3, 0.85],
    [7, 4, 0.5],
    [8, 4, 0.3],
    [5, 3, 0.2],
    [8, 5, 0.18]
  ]
  return (
    <svg viewBox="0 0 180 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      {cells.map(([c, r, o]) => (
        <rect key={`${c}-${r}`} x={c * 14 + 3} y={r * 14 + 3} width={9} height={9} fill={o > 0.8 ? 'var(--hot)' : 'var(--accent)'} opacity={o} />
      ))}
    </svg>
  )
}
