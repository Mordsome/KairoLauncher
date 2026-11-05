import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import type { CreateResult, ExtraInfo, LoaderVersions } from '../../../shared/api'
import { BackIcon, TickIcon } from '../components/Icons'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import {
  EDITION_ORDER,
  EDITIONS,
  LATEST_RELEASE,
  LOADER_ORDER,
  LOADERS,
  RELEASES,
  SNAPSHOTS,
  type EditionId,
  type Extra,
  type LoaderId
} from '../data/catalog'
import { useStore } from '../state/store'

interface Props {
  visible: boolean
  rootRef: RefObject<HTMLElement | null>
}

export function Picker({ visible, rootRef }: Props) {
  const focus = useStore((s) => s.pickFocus)
  const selection = useStore((s) => s.selection)
  const setPickFocus = useStore((s) => s.setPickFocus)
  const closePicker = useStore((s) => s.closePicker)
  const [moreVanilla, setMoreVanilla] = useState(false)

  const edition = EDITIONS[focus]

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()
    }
  }

  return (
    <section
      ref={rootRef}
      className="screen screen-pick"
      data-on={visible}
      inert={!visible}
      aria-label="Choose what to play"
      onKeyDown={onKeyDown}
    >
      <div className="pick-head">
        <button type="button" className="back" aria-label="Back to Home" onClick={closePicker}>
          <BackIcon />
        </button>
        <h1 className="pick-title">Choose what to play</h1>
      </div>

      <div role="radiogroup" aria-label="Edition" className="eds" data-roving onKeyDown={(e) => rovingKeyDown(e)}>
        {EDITION_ORDER.map((id) => {
          const e = EDITIONS[id]
          const on = id === focus
          const current = id === selection.edition
          const ready = id === 'other' || e.versions.some((v) => !v.unavailable)
          const tag = current ? `playing ${selection.mc}` : ready ? '' : 'soon'
          const pickThis = () => setPickFocus(id)
          return (
            <button
              key={id}
              type="button"
              role="radio"
              className="ed"
              aria-checked={on}
              data-soon={!ready && !on}
              tabIndex={rovingTabIndex(on)}
              onClick={pickThis}
              onMouseEnter={pickThis}
              onFocus={pickThis}
            >
              {e.name}
              {tag && (
                <span className="ed-tag" data-current={current}>
                  {tag}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section className="fx" aria-label={`${edition.title} versions`}>
        <span className="fx-title">{edition.title}</span>
        <p className="fx-blurb">{edition.blurb}</p>
        {focus === 'other' ? (
          <OtherBuilder />
        ) : focus === 'vanilla' && moreVanilla ? (
          <VanillaGrid onDone={() => setMoreVanilla(false)} />
        ) : (
          <VersionList edition={focus} onMore={() => setMoreVanilla(true)} />
        )}
      </section>
    </section>
  )
}

function VersionList({ edition, onMore }: { edition: EditionId; onMore(): void }) {
  const selection = useStore((s) => s.selection)
  const installs = useStore((s) => s.installs)
  const versions = useStore((s) => s.versions)
  const kairo = useStore((s) => s.kairo)
  const select = useStore((s) => s.select)
  const e = EDITIONS[edition]
  const isKairo = edition === 'kairo' || edition === 'void'
  const install = installs.find((i) => i.id === edition)

  // Game files are shared between installs, so a version is "Ready" once it's downloaded for any of them.
  const ready = new Set(versions?.ready ?? [])
  const readyState = (mc: string) => {
    if (isKairo) {
      const info = kairo?.installs[edition]
      if (!info?.kairoVersion) return 'Download'
      return kairo?.latest && kairo.latest.version !== info.kairoVersion ? 'Update' : 'Installed'
    }
    return ready.has(mc) ? 'Ready' : 'Download'
  }
  const latest = versions?.latest ?? LATEST_RELEASE

  // Kairo's playable row follows the real release: its version and Minecraft version.
  const rows = e.versions.map((v, i) => {
    if (!isKairo || i !== 0 || v.unavailable) return v
    const info = kairo?.installs[edition]
    const version = kairo?.latest?.version ?? info?.kairoVersion
    return { ...v, mc: install?.mc ?? v.mc, sub: version ? `${e.title} ${version} · latest` : v.sub }
  })

  return (
    <>
      {rows.map((v) => {
        const current = selection.edition === edition && selection.mc === v.mc
        const ok = !v.unavailable
        const state = current ? 'Selected' : (v.unavailable ?? readyState(v.mc))
        return (
          <button
            key={v.mc}
            type="button"
            className="vrow"
            data-sel={current}
            disabled={!ok}
            aria-label={`${e.title} for Minecraft ${v.mc}, ${state.toLowerCase()}`}
            onClick={() => select({ edition, mc: v.mc, installId: edition === 'kairo' || edition === 'void' ? edition : null })}
          >
            <b className="vrow-mc">{v.mc}</b>
            <span className="vrow-sub">{v.sub}</span>
            <span className="vrow-state" data-tone={current ? 'accent' : ok ? 'ok' : 'muted'}>
              {state}
            </span>
          </button>
        )
      })}
      {edition === 'vanilla' && (
        <button type="button" className="more" aria-expanded="false" onClick={onMore}>
          <span>More versions</span>
          <span className="more-sub">Every release from 1.8 to {latest}</span>
        </button>
      )}
    </>
  )
}

function VanillaGrid({ onDone }: { onDone(): void }) {
  const selection = useStore((s) => s.selection)
  const showSnapshots = useStore((s) => s.settings.showSnapshots)
  const live = useStore((s) => s.versions)
  const select = useStore((s) => s.select)

  // Mojang's live list; the built-in copy only until it loads.
  const releases = live?.releases ?? RELEASES
  const snapshots = live?.snapshots ?? SNAPSHOTS
  const versions = showSnapshots ? [...snapshots, ...releases] : releases
  const checked = (mc: string) => selection.edition === 'vanilla' && selection.mc === mc
  const anyChecked = versions.some(checked)

  return (
    <>
      <div
        role="radiogroup"
        aria-label="All Minecraft versions"
        className="vgrid scroll"
        data-roving
        onKeyDown={(e) => rovingKeyDown(e, { columns: 4 })}
      >
        {versions.map((mc, i) => (
          <button
            key={mc}
            type="button"
            role="radio"
            className={mc.includes('snapshot') ? 'vcell vcell-snap' : 'vcell'}
            aria-checked={checked(mc)}
            tabIndex={rovingTabIndex(anyChecked ? checked(mc) : i === 0)}
            onClick={() => {
              select({ edition: 'vanilla', mc, installId: null })
              onDone()
            }}
          >
            {mc}
          </button>
        ))}
      </div>
      <button type="button" className="more more-small" aria-expanded="true" onClick={onDone}>
        Fewer versions
      </button>
    </>
  )
}

// Shown first when a loader supports them; everything else is under "More…".
const POPULAR = ['26.3', '1.21.1', '1.20.1', '1.16.5', '1.12.2', '1.8.9']

function OtherBuilder() {
  const customCreated = useStore((s) => s.customCreated)
  const [loader, setLoader] = useState<LoaderId>('fabric')
  const [mc, setMc] = useState('1.20.1')
  const [more, setMore] = useState(false)
  const [picked, setPicked] = useState<Record<Extra['id'], boolean>>({ sodium: true, iris: true, lithium: false })
  const [versions, setVersions] = useState<LoaderVersions | null>(null)
  const [available, setAvailable] = useState<ExtraInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)

  // Minecraft versions, live from the loader's official source.
  useEffect(() => {
    let live = true
    setVersions(null)
    window.kairo.loaders.versions(loader).then(
      (v) => live && setVersions(v),
      () => live && setVersions({ mcs: [], loaderVersions: {} })
    )
    return () => {
      live = false
    }
  }, [loader])

  const all = versions?.mcs ?? []
  const mcOk = all.includes(mc) ? mc : (POPULAR.find((p) => all.includes(p)) ?? all[0] ?? mc)
  const popular = POPULAR.filter((p) => all.includes(p)).slice(0, 4)
  const shortList = popular.length ? (popular.includes(mcOk) ? popular : [...popular, mcOk]) : all.slice(0, 4)
  const mcList = more ? all : shortList
  const handOff = loader === 'forge' || loader === 'optifine'

  // Extras Modrinth actually has for this loader and version.
  useEffect(() => {
    let live = true
    setAvailable(null)
    if (!versions || handOff) {
      setAvailable([])
      return
    }
    window.kairo.loaders.extras(loader, mcOk).then(
      (x) => live && setAvailable(x),
      () => live && setAvailable([])
    )
    return () => {
      live = false
    }
  }, [loader, mcOk, versions, handOff])

  const chosen = (available ?? []).filter((x) => picked[x.id as Extra['id']])
  const L = LOADERS[loader]
  const forgeVersion = versions?.loaderVersions[mcOk]

  const finish = async (result: Promise<CreateResult>) => {
    setBusy(true)
    setError(null)
    try {
      const r = await result
      if (r.ok) customCreated(r.install)
      else if (!r.cancelled) setError(r.error)
    } finally {
      setBusy(false)
    }
  }
  const create = () => void finish(window.kairo.installs.create({ loader, mc: mcOk, extras: chosen.map((x) => x.id) }))

  const note =
    loader === 'optifine'
      ? 'OptiFine is downloaded from optifine.net, which is the only place allowed to share it. Get it there, then choose the file here.'
      : loader === 'forge'
        ? `Forge asks to be downloaded from its own site, which its ads pay for${forgeVersion ? ` (Forge ${forgeVersion} is the one to get)` : ''}. Then choose the file here.`
        : `Mods come from Modrinth, always the version made for ${mcOk}.`

  return (
    <div className="builder">
      <div className="field">
        <span className="field-label" id="loader-label">
          Loader
        </span>
        <div role="radiogroup" aria-labelledby="loader-label" className="chips" data-roving onKeyDown={(e) => rovingKeyDown(e, { select: true })}>
          {LOADER_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              className="chip chip-loader"
              aria-checked={id === loader}
              tabIndex={rovingTabIndex(id === loader)}
              onClick={() => {
                setLoader(id)
                setError(null)
              }}
            >
              {LOADERS[id].name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label" id="mc-label">
          Minecraft version
        </span>
        {/* As in the design, "More…" sits in the group; arrow keys skip it, Tab reaches it. */}
        <div
          role="radiogroup"
          aria-labelledby="mc-label"
          aria-busy={!versions}
          className={more ? 'chips chips-scroll scroll' : 'chips'}
          data-roving
          onKeyDown={(e) => rovingKeyDown(e, { select: true })}
        >
          {!versions && <span className="field-label">Checking {L.name}…</span>}
          {mcList.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              className="chip chip-mc"
              aria-checked={v === mcOk}
              tabIndex={rovingTabIndex(v === mcOk)}
              onClick={() => setMc(v)}
            >
              {v}
            </button>
          ))}
          {versions && all.length > shortList.length && (
            <button type="button" className="chip chip-more" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? 'Fewer' : 'More…'}
            </button>
          )}
        </div>
      </div>

      {!handOff && (available === null || available.length > 0) && (
        <div className="field">
          <span className="field-label" id="extras-label">
            Add to it
          </span>
          <div className="chips" role="group" aria-labelledby="extras-label" aria-busy={available === null}>
            {available === null && <span className="field-label">Checking Modrinth…</span>}
            {(available ?? []).map((x) => (
              <button
                key={x.id}
                type="button"
                role="checkbox"
                className="chip chip-extra"
                aria-checked={!!picked[x.id as Extra['id']]}
                onClick={() => setPicked({ ...picked, [x.id]: !picked[x.id as Extra['id']] })}
              >
                <span className="tickbox">
                  <TickIcon />
                </span>
                {x.name}
                <span className="extra-sub">{x.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="builder-note">{note}</p>

      {error && (
        <p className="builder-error" role="alert">
          <b>{error.title}</b> {error.message}
        </p>
      )}

      <div className="builder-actions">
        {handOff ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void window.kairo.loaders.openDownloadPage(loader as 'forge' | 'optifine', mcOk)}
            >
              {loader === 'forge' ? "Open Forge's download page" : 'Open optifine.net'}
            </button>
            <button type="button" className="btn-accent btn-create" disabled={busy || !versions} onClick={create}>
              Choose the downloaded file
            </button>
          </>
        ) : (
          <button type="button" className="btn-accent btn-create" disabled={busy || !versions || !all.length} onClick={create}>
            Create {L.name} {mcOk}
          </button>
        )}
        <button type="button" className="link-button" disabled={busy} onClick={() => void finish(window.kairo.installs.importModpack())}>
          Import a modpack instead
        </button>
      </div>
    </div>
  )
}
