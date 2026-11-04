import { PlayIcon } from '../components/Icons'
import { LOADERS, type EditionId } from '../data/catalog'
import { useStore, type Install } from '../state/store'

const THUMB: Record<EditionId, string> = {
  kairo: 'thumb-kairo',
  void: 'thumb-void',
  lite: 'thumb-lite',
  vanilla: 'thumb-vanilla',
  other: 'thumb-other'
}

// Rows for editions that aren't out yet. Shown, but not selectable.
const UPCOMING = [
  { id: 'lite', name: 'Kairo Lite', mc: '1.8.9', sub: 'The Kairo look for classic PvP', state: 'Coming soon', thumb: 'thumb-lite' },
  { id: 'kairo-121', name: 'Kairo', mc: '1.21.x', sub: 'For servers still on 1.21', state: 'Later', thumb: 'thumb-later' }
]

function playtime(i: Install): string {
  if (i.lastPlayed === null) return 'not played yet'
  const h = Math.round(i.playMinutes / 60)
  if (h < 1) return 'under an hour played'
  return `${h} ${h === 1 ? 'hour' : 'hours'} played`
}

function lastPlayed(at: number | null): string {
  if (at === null) return 'never'
  const days = Math.floor((startOfDay(Date.now()) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function summary(i: Install): string {
  const loader = i.loader ? LOADERS[i.loader].name : 'Vanilla'
  if (i.edition === 'kairo' || i.edition === 'void') {
    return `${i.mods[0]?.name ?? i.name} ${i.mods[0]?.version ?? ''} · ${loader} · ${playtime(i)}`
  }
  const extras = i.extras.length ? ` · ${i.extras.join(', ')}` : ''
  return `${loader}${extras} · ${playtime(i)}`
}

export function LibraryScreen({ active }: { active: boolean }) {
  const installs = useStore((s) => s.installs)
  const librarySel = useStore((s) => s.librarySel)
  const setLibrarySel = useStore((s) => s.setLibrarySel)
  const updateInstall = useStore((s) => s.updateInstall)
  const select = useStore((s) => s.select)
  const playOrStop = useStore((s) => s.playOrStop)
  const phase = useStore((s) => s.game.phase)

  const detail = installs.find((i) => i.id === librarySel) ?? installs[0]
  const isKairo = detail?.edition === 'kairo' || detail?.edition === 'void'

  const playDetail = () => {
    if (!detail) return
    select({ edition: detail.edition, mc: detail.mc, installId: detail.id })
    if (phase === 'idle') playOrStop()
  }

  return (
    <div className="page page-plain" data-active={active} inert={!active}>
      <div className="lib">
        <section className="lib-main" aria-labelledby="library-title">
          <div className="page-head">
            <h1 id="library-title" className="page-title">
              Library
            </h1>
            <span className="page-sub">Each install keeps its own mods, worlds and settings.</span>
          </div>

          <div className="lib-rows scroll">
            {installs.map((i) => {
              const sel = detail?.id === i.id
              return (
                <button key={i.id} type="button" className="librow" aria-pressed={sel} onClick={() => setLibrarySel(i.id)}>
                  <span className={`thumb ${THUMB[i.edition]}`} aria-hidden="true" />
                  <span className="librow-text">
                    <span className="librow-head">
                      <b className="librow-name">{i.name}</b>
                      <span className="mc-chip">{i.mc}</span>
                    </span>
                    <span className="librow-sub">{summary(i)}</span>
                  </span>
                  <span className="librow-state">{isUpToDate(i) ? 'Up to date' : 'Ready'}</span>
                </button>
              )
            })}
            {UPCOMING.map((u) => (
              <button key={u.id} type="button" className="librow" disabled aria-label={`${u.name} for Minecraft ${u.mc}, ${u.state.toLowerCase()}`}>
                <span className={`thumb ${u.thumb}`} aria-hidden="true" />
                <span className="librow-text">
                  <span className="librow-head">
                    <b className="librow-name">{u.name}</b>
                    <span className="mc-chip">{u.mc}</span>
                  </span>
                  <span className="librow-sub">{u.sub}</span>
                </span>
                <span className="librow-state">{u.state}</span>
              </button>
            ))}
          </div>
        </section>

        {detail && (
          <aside className="lib-detail" aria-label="Install details">
            <div className="detail-head">
              <span className="detail-mc">Minecraft {detail.mc}</span>
              <h2 className="detail-name">{detail.name}</h2>
              <span className="detail-last">Last played {lastPlayed(detail.lastPlayed)}</span>
            </div>

            <div className="detail-mods">
              <span className="field-label">{detail.mods.length ? 'Installed for you' : 'Nothing extra installed'}</span>
              {detail.mods.map((m) => (
                <div key={m.name} className="mod-row">
                  <span>{m.name}</span>
                  <span className="mod-ver">{m.version}</span>
                </div>
              ))}
            </div>

            {isKairo && (
              <label className="keep-updated">
                <span>
                  Keep Kairo updated
                  <br />
                  <span className="keep-sub">Fabric API and Sodium update with it</span>
                </span>
                <input type="checkbox" checked={detail.keepUpdated} onChange={(e) => updateInstall(detail.id, { keepUpdated: e.target.checked })} />
              </label>
            )}

            <div className="detail-actions">
              <button type="button" className="btn-accent detail-play" onClick={playDetail} disabled={phase !== 'idle'}>
                <PlayIcon size={18} />
                Play
              </button>
              <button type="button" className="btn-ghost">
                Open folder
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function isUpToDate(i: Install): boolean {
  return (i.edition === 'kairo' || i.edition === 'void') && i.keepUpdated
}
