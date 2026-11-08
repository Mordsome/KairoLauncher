import { useEffect, useRef, useState } from 'react'
import type { InstalledMod, ModHit, ModsResult } from '../../../shared/api'
import { Modal } from '../components/Modal'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { Switch } from '../components/Switch'
import { LOADERS } from '../data/catalog'
import type { Install } from '../state/store'

type Problem = { title: string; message: string } | null

function downloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M downloads`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K downloads`
  return `${n} downloads`
}

/** Mods for one install: what's in its mods folder, and Modrinth search for its loader and version. */
export function ModsDialog({ install, onClose }: { install: Install; onClose(): void }) {
  const [tab, setTab] = useState<'installed' | 'find'>('installed')
  const [mods, setMods] = useState<InstalledMod[] | null>(null)
  const [problem, setProblem] = useState<Problem>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const apply = (r: ModsResult) => {
    if (r.ok) {
      setMods(r.mods)
      setProblem(null)
    } else setProblem(r.error)
  }

  useEffect(() => {
    void window.kairo.mods.list(install.id).then(apply)
  }, [install.id])

  const act = async (key: string, work: () => Promise<ModsResult>) => {
    setBusy(key)
    try {
      apply(await work())
    } finally {
      setBusy(null)
    }
  }

  const loaderName = install.loader ? LOADERS[install.loader].name : ''
  const count = mods?.length ?? 0

  return (
    <Modal
      title={`Mods: ${install.name}`}
      wide
      onClose={onClose}
      actions={
        <>
          <span className="modal-note log-state">
            {loaderName} {install.mc} · from Modrinth, each file checked
          </span>
          <button type="button" className="btn-ghost" onClick={() => void window.kairo.installs.openFolder(install.id)}>
            Open folder
          </button>
          <button type="button" className="btn-accent" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div role="tablist" aria-label="Mods" className="seg mods-tabs" data-roving onKeyDown={(e) => rovingKeyDown(e, { select: true })}>
        {(
          [
            ['installed', `Installed${mods ? ` (${count})` : ''}`],
            ['find', 'Find mods']
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`mods-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`mods-panel-${id}`}
            className="seg-item"
            tabIndex={rovingTabIndex(tab === id)}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>

      {problem && (
        <p className="modal-error" role="alert">
          <b>{problem.title}</b> {problem.message}
        </p>
      )}

      {tab === 'installed' ? (
        <div id="mods-panel-installed" role="tabpanel" aria-labelledby="mods-tab-installed" className="mods-list scroll">
          {mods === null && <span className="field-label">Loading…</span>}
          {mods?.length === 0 && <p className="modal-note">No mods yet. Find some on the Find mods tab, or put jar files in the install's mods folder.</p>}
          {mods?.map((m) => (
            <div key={m.file} className="mod-item" data-off={!m.enabled}>
              <span className="mod-item-text">
                <b>{m.name}</b>
                <span className="mod-item-sub">
                  {m.version ?? m.file}
                  {!m.managed && <span className="mod-tag">Your file</span>}
                </span>
              </span>
              {m.locked ? (
                <span className="mod-tag">Part of Kairo</span>
              ) : (
                <>
              <Switch
                checked={m.enabled}
                label={`${m.name} on`}
                onChange={(on) => void act(`toggle:${m.file}`, () => window.kairo.mods.setEnabled(install.id, m.file, on))}
              />
              <button
                type="button"
                className="btn-ghost btn-small btn-danger-text"
                disabled={busy !== null}
                aria-label={`Remove ${m.name}`}
                onClick={() => void act(`remove:${m.file}`, () => window.kairo.mods.remove(install.id, m.file))}
              >
                Remove
              </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <FindMods install={install} busy={busy} installed={new Set(mods?.map((m) => m.project).filter((p): p is string => !!p))} onInstall={(hit) =>
          void act(`install:${hit.id}`, () => window.kairo.mods.install(install.id, hit.id))
        } />
      )}
    </Modal>
  )
}

function FindMods({
  install,
  busy,
  installed,
  onInstall
}: {
  install: Install
  busy: string | null
  installed: Set<string>
  onInstall(hit: ModHit): void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [problem, setProblem] = useState<Problem>(null)
  const latest = useRef(0)

  const search = (q: string, offset: number) => {
    const ticket = ++latest.current
    void window.kairo.mods.search(install.id, q, offset).then((r) => {
      if (ticket !== latest.current) return // a newer search already started
      if (!r.ok) {
        setProblem(r.error)
        return
      }
      setProblem(null)
      setTotal(r.search.total)
      setHits((before) => (offset === 0 ? r.search.hits : [...(before ?? []), ...r.search.hits]))
    })
  }

  // Popular mods first; then search as the player types (a short pause, to be kind to Modrinth).
  useEffect(() => {
    const timer = setTimeout(() => search(query, 0), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [query, install.id])

  const loaderName = install.loader ? LOADERS[install.loader].name : ''
  return (
    <div id="mods-panel-find" role="tabpanel" aria-labelledby="mods-tab-find" className="mods-find">
      <input
        className="text-input"
        type="search"
        spellCheck={false}
        value={query}
        maxLength={100}
        placeholder={`Search Modrinth for ${loaderName} ${install.mc} mods`}
        aria-label="Search mods"
        onChange={(e) => setQuery(e.target.value)}
        data-autofocus
      />
      {problem && (
        <p className="modal-error" role="alert">
          <b>{problem.title}</b> {problem.message}
        </p>
      )}
      <div className="mods-list scroll" aria-busy={hits === null}>
        {hits === null && <span className="field-label">Searching Modrinth…</span>}
        {hits?.length === 0 && <p className="modal-note">Nothing on Modrinth matches that for {loaderName} {install.mc}.</p>}
        {hits?.map((h) => {
          const have = h.installed || installed.has(h.slug)
          const working = busy === `install:${h.id}`
          return (
            <div key={h.id} className="mod-hit">
              {h.hasIcon ? (
                <img className="mod-icon" src={`kairo-icon://modrinth/${h.id}`} alt="" width={44} height={44} loading="lazy" />
              ) : (
                <span className="mod-icon mod-icon-empty" aria-hidden="true" />
              )}
              <span className="mod-item-text">
                <b>{h.title}</b>
                <span className="mod-item-sub">
                  by {h.author} · {downloads(h.downloads)}
                </span>
                <span className="mod-desc">{h.description}</span>
              </span>
              <button
                type="button"
                className={have ? 'btn-ghost btn-small' : 'btn-accent btn-small'}
                disabled={have || busy !== null}
                aria-label={have ? `${h.title} is installed` : `Install ${h.title}`}
                onClick={() => onInstall(h)}
              >
                {have ? 'Installed' : working ? 'Installing…' : 'Install'}
              </button>
            </div>
          )
        })}
        {hits && hits.length < total && (
          <button type="button" className="btn-ghost btn-small mods-more" onClick={() => search(query, hits.length)}>
            Show more
          </button>
        )}
      </div>
    </div>
  )
}
