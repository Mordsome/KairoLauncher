import { useEffect, useRef, useState } from 'react'
import type { InstalledMod, ModHit, ModsResult, ModSort } from '../../../shared/api'
import { ChevronIcon } from '../components/Icons'
import { Menu } from '../components/Menu'
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

  const act = async (key: string, work: () => Promise<ModsResult>): Promise<boolean> => {
    setBusy(key)
    try {
      const r = await work()
      apply(r)
      return r.ok
    } catch {
      return false
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
        <FindMods
          install={install}
          busy={busy}
          installed={new Set(mods?.map((m) => m.project).filter((p): p is string => !!p))}
          onInstall={(ids) => act('install', () => window.kairo.mods.install(install.id, ids))}
        />
      )}
    </Modal>
  )
}

const SORTS: [ModSort, string][] = [
  ['relevance', 'Best match'],
  ['downloads', 'Most downloaded'],
  ['follows', 'Most followed'],
  ['newest', 'Newest'],
  ['updated', 'Recently updated']
]

/** A mod picked to install: being checked, fine (with the version it gets), or with nothing for this version. */
type Pick = { title: string; state: 'checking' } | { title: string; state: 'ok'; version: string } | { title: string; state: 'none'; message: string }

function FindMods({
  install,
  busy,
  installed,
  onInstall
}: {
  install: Install
  busy: string | null
  installed: Set<string>
  /** True when they were installed. */
  onInstall(ids: string[]): Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ModSort>('relevance')
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [hits, setHits] = useState<ModHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [problem, setProblem] = useState<Problem>(null)
  const [picked, setPicked] = useState<Map<string, Pick>>(new Map())
  const latest = useRef(0)

  const search = (q: string, offset: number) => {
    const ticket = ++latest.current
    if (offset === 0) setHits(null)
    void window.kairo.mods.search(install.id, q, offset, sort).then((r) => {
      if (ticket !== latest.current) return // a newer search already started
      if (!r.ok) {
        setProblem(r.error)
        setHits((h) => h ?? [])
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
  }, [query, sort, install.id])

  const setPick = (id: string, pick: Pick | null) =>
    setPicked((before) => {
      const next = new Map(before)
      if (pick) next.set(id, pick)
      else next.delete(id)
      return next
    })

  // Picking a mod checks that Modrinth really has a file for this loader and version.
  const toggle = (h: ModHit) => {
    if (picked.has(h.id)) {
      setPick(h.id, null)
      return
    }
    setPick(h.id, { title: h.title, state: 'checking' })
    void window.kairo.mods.check(install.id, h.id).then(
      (r) =>
        setPicked((before) => {
          if (!before.has(h.id)) return before // un-picked meanwhile
          const next = new Map(before)
          next.set(h.id, r.ok ? { title: h.title, state: 'ok', version: r.version } : { title: h.title, state: 'none', message: r.message })
          return next
        }),
      () => setPick(h.id, { title: h.title, state: 'none', message: "Couldn't check it" })
    )
  }

  const okPicks = [...picked].filter((e): e is [string, Extract<Pick, { state: 'ok' }>] => e[1].state === 'ok')
  const ready = okPicks.map(([id]) => id)
  const checking = [...picked.values()].some((p) => p.state === 'checking')
  const installing = busy === 'install'
  const mods = (n: number) => (n === 1 ? 'mod' : 'mods')

  const installPicked = async () => {
    const ids = ready
    // If it fails, the picks stay (the reason shows at the top).
    if (!(await onInstall(ids))) return
    setPicked((before) => new Map([...before].filter(([id]) => !ids.includes(id))))
  }

  const loaderName = install.loader ? LOADERS[install.loader].name : ''
  const sortName = SORTS.find(([id]) => id === sort)?.[1] ?? ''
  return (
    <div id="mods-panel-find" role="tabpanel" aria-labelledby="mods-tab-find" className="mods-find">
      <div className="mods-search-row">
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
        <button
          type="button"
          className="btn-ghost mods-sort"
          aria-haspopup="menu"
          aria-expanded={sortMenu !== null}
          aria-label={`Sort: ${sortName}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setSortMenu({ x: r.left, y: r.bottom + 6 })
          }}
        >
          <span className="mods-sort-label">Sort</span>
          {sortName}
          <ChevronIcon />
        </button>
      </div>
      {sortMenu && (
        <Menu
          label="Sort mods"
          at={sortMenu}
          onClose={() => setSortMenu(null)}
          items={SORTS.map(([id, name]) => ({ label: name, checked: id === sort, onSelect: () => setSort(id) }))}
        />
      )}
      {problem && (
        <p className="modal-error" role="alert">
          <b>{problem.title}</b> {problem.message}
        </p>
      )}
      <div className="mods-list scroll" aria-busy={hits === null}>
        {hits === null && <span className="field-label">Searching Modrinth…</span>}
        {hits?.length === 0 && !problem && (
          <p className="modal-note">
            Nothing on Modrinth matches that for {loaderName} {install.mc}.
          </p>
        )}
        {hits?.map((h) => {
          const have = h.installed || installed.has(h.slug)
          const pick = picked.get(h.id)
          const on = !!pick && pick.state !== 'none'
          const status =
            pick?.state === 'checking' ? 'Checking…' : pick?.state === 'ok' ? `Gets ${pick.version}` : pick?.state === 'none' ? pick.message : null
          return (
            <div key={h.id} className="mod-hit" data-picked={on || undefined}>
              {h.hasIcon ? (
                <img className="mod-icon" src={`kairo-icon://modrinth/${h.id}`} alt="" width={44} height={44} loading="lazy" />
              ) : (
                <span className="mod-icon mod-icon-empty" aria-hidden="true" />
              )}
              <span className="mod-item-text">
                <b>{h.title}</b>
                <span className="mod-item-sub">
                  by {h.author} · {downloads(h.downloads)}
                  {status && (
                    <span className="mod-tag" data-tone={pick?.state === 'none' ? 'bad' : pick?.state === 'ok' ? 'ok' : undefined}>
                      {status}
                    </span>
                  )}
                </span>
                <span className="mod-desc">{h.description}</span>
              </span>
              {have ? (
                <button type="button" className="btn-ghost btn-small" disabled aria-label={`${h.title} is installed`}>
                  Installed
                </button>
              ) : (
                <button
                  type="button"
                  className={on ? 'btn-accent btn-small mod-pick' : 'btn-ghost btn-small mod-pick'}
                  aria-pressed={on}
                  disabled={installing || pick?.state === 'none'}
                  aria-label={on ? `Unpick ${h.title}` : `Pick ${h.title}`}
                  onClick={() => toggle(h)}
                >
                  {pick?.state === 'none' ? 'Not available' : on ? 'Picked' : 'Pick'}
                </button>
              )}
            </div>
          )
        })}
        {hits && hits.length < total && (
          <button type="button" className="btn-ghost btn-small mods-more" onClick={() => search(query, hits.length)}>
            Show more
          </button>
        )}
      </div>
      <div className="mods-tray" role="status">
        <span className="mods-tray-text">
          {installing
            ? `Installing ${ready.length} ${mods(ready.length)} and what they need…`
            : ready.length
              ? `${ready.length} picked: ${okPicks.map(([, p]) => p.title).join(', ')}`
              : checking
                ? 'Checking…'
                : `Pick a few mods, then install them together. Only ${loaderName} ${install.mc} files are used.`}
        </span>
        {picked.size > 0 && (
          <button type="button" className="btn-ghost btn-small" disabled={installing} onClick={() => setPicked(new Map())}>
            Clear
          </button>
        )}
        <button
          type="button"
          className="btn-accent btn-small"
          disabled={installing || checking || ready.length === 0}
          onClick={() => void installPicked()}
        >
          {installing ? 'Installing…' : ready.length ? `Install ${ready.length} ${mods(ready.length)}` : 'Install'}
        </button>
      </div>
    </div>
  )
}
