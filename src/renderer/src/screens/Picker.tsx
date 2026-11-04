import { useState, type KeyboardEvent, type RefObject } from 'react'
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

function OtherBuilder() {
  const createOther = useStore((s) => s.createOther)
  const go = useStore((s) => s.go)
  const [loader, setLoader] = useState<LoaderId>('fabric')
  const [mc, setMc] = useState('1.20.1')
  const [more, setMore] = useState(false)
  const [extras, setExtras] = useState<Record<Extra['id'], boolean>>({ sodium: true, iris: true, lithium: false })

  const L = LOADERS[loader]
  const mcOk = L.all.includes(mc) ? mc : (L.popular[0] ?? mc)
  const shortList = L.popular.includes(mcOk) ? L.popular : [...L.popular, mcOk]
  const mcList = more ? L.all : shortList
  const chosen = L.extras.filter((x) => extras[x.id]).map((x) => x.name)

  const note =
    loader === 'optifine'
      ? 'OptiFine is downloaded from optifine.net, which is the only place allowed to share it.'
      : loader === 'forge'
        ? 'Forge and its mods come from their official sites.'
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
                if (!LOADERS[id].all.includes(mc)) setMc(LOADERS[id].popular[0] ?? mc)
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
          className={more ? 'chips chips-scroll scroll' : 'chips'}
          data-roving
          onKeyDown={(e) => rovingKeyDown(e, { select: true })}
        >
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
          <button type="button" className="chip chip-more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? 'Fewer' : 'More…'}
          </button>
        </div>
      </div>

      {L.extras.length > 0 && (
        <div className="field">
          <span className="field-label" id="extras-label">
            Add to it
          </span>
          <div className="chips" role="group" aria-labelledby="extras-label">
            {L.extras.map((x) => (
              <button
                key={x.id}
                type="button"
                role="checkbox"
                className="chip chip-extra"
                aria-checked={!!extras[x.id]}
                onClick={() => setExtras({ ...extras, [x.id]: !extras[x.id] })}
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

      <div className="builder-actions">
        <button type="button" className="btn-accent btn-create" onClick={() => createOther(loader, mcOk, chosen)}>
          Create {L.name} {mcOk}
        </button>
        <button type="button" className="link-button" onClick={() => go('library')}>
          Import a modpack instead
        </button>
      </div>
    </div>
  )
}
