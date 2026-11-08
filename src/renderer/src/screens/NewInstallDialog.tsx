import { useEffect, useState } from 'react'
import type { CreateResult, CustomInstallInfo, ExtraInfo, NewInstallKind } from '../../../shared/api'
import { InstallBanner, type BannerKind } from '../components/InstallBanner'
import { Modal } from '../components/Modal'
import { TickIcon } from '../components/Icons'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { EDITIONS, LOADERS, RELEASES, SNAPSHOTS, type Extra } from '../data/catalog'
import { useStore } from '../state/store'

type Kind = NewInstallKind | 'modpack'

const KINDS: { id: Kind; name: string; sub: string; banner: BannerKind }[] = [
  { id: 'kairo', name: 'Kairo', sub: 'Glass menus, HUD, PvP mode', banner: 'kairo' },
  { id: 'void', name: 'Kairo Void', sub: 'Kairo, all the way up', banner: 'void' },
  { id: 'fabric', name: 'Fabric', sub: 'Mods from Modrinth', banner: 'fabric' },
  { id: 'neoforge', name: 'NeoForge', sub: 'Mods from Modrinth', banner: 'neoforge' },
  { id: 'forge', name: 'Forge', sub: 'From Forge’s own site', banner: 'forge' },
  { id: 'optifine', name: 'OptiFine', sub: 'From optifine.net', banner: 'optifine' },
  { id: 'vanilla', name: 'Minecraft', sub: 'Plain, no mods', banner: 'vanilla' },
  { id: 'modpack', name: 'Modpack', sub: 'A .mrpack file', banner: 'modpack' }
]

// Shown first when a loader supports them; everything else is under "More…".
const POPULAR = ['26.3', '1.21.1', '1.20.1', '1.16.5', '1.12.2', '1.8.9']
const HAS_MODS = new Set<Kind>(['kairo', 'void', 'fabric', 'neoforge', 'forge'])

/** "+ New install": Kairo or Kairo Void, a loader, plain Minecraft, or a modpack. */
export function NewInstallDialog({ onClose, onDone }: { onClose(): void; onDone(install: CustomInstallInfo, addMods: boolean): void }) {
  const [kind, setKind] = useState<Kind>('kairo')
  const [created, setCreated] = useState<CustomInstallInfo | null>(null)

  if (created) {
    const modable = HAS_MODS.has(kind) && !created.modpack
    return (
      <Modal
        title={`${created.name} is ready`}
        onClose={() => onDone(created, false)}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => onDone(created, false)} data-autofocus={!modable || undefined}>
              Done
            </button>
            {modable && (
              <button type="button" className="btn-accent" onClick={() => onDone(created, true)} data-autofocus>
                Add mods
              </button>
            )}
          </>
        }
      >
        <p className="modal-text">
          It downloads the first time you press Play.
          {modable ? ' You can add mods from Modrinth now, or any time later from the Library.' : ''}
        </p>
      </Modal>
    )
  }

  return (
    <Modal title="New install" wide onClose={onClose}>
      <div role="radiogroup" aria-label="What to install" className="kind-grid" data-roving onKeyDown={(e) => rovingKeyDown(e, { columns: 4 })}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            className="kind"
            aria-checked={kind === k.id}
            tabIndex={rovingTabIndex(kind === k.id)}
            onClick={() => setKind(k.id)}
          >
            <InstallBanner kind={k.banner} className="kind-banner" />
            <b>{k.name}</b>
            <span>{k.sub}</span>
          </button>
        ))}
      </div>
      <Setup key={kind} kind={kind} onCreated={setCreated} />
    </Modal>
  )
}

function Setup({ kind, onCreated }: { kind: Kind; onCreated(install: CustomInstallInfo): void }) {
  const live = useStore((s) => s.versions)
  const showSnapshots = useStore((s) => s.settings.showSnapshots)
  const isKairo = kind === 'kairo' || kind === 'void'
  const loader = kind === 'fabric' || kind === 'neoforge' || kind === 'forge' || kind === 'optifine' ? kind : null
  const handOff = kind === 'forge' || kind === 'optifine'

  const [all, setAll] = useState<string[] | null>(null)
  const [loaderVersions, setLoaderVersions] = useState<Record<string, string>>({})
  const [mc, setMc] = useState('')
  const [more, setMore] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Record<Extra['id'], boolean>>({ sodium: true, iris: false, lithium: false })
  const [extras, setExtras] = useState<ExtraInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)

  // Versions: Kairo's own list; a loader's, live from its official source; or Mojang's.
  useEffect(() => {
    let alive = true
    if (isKairo) {
      setAll(EDITIONS[kind].versions.filter((v) => !v.unavailable).map((v) => v.mc))
    } else if (kind === 'vanilla') {
      const releases = live?.releases ?? RELEASES
      setAll(showSnapshots ? [...(live?.snapshots ?? SNAPSHOTS), ...releases] : releases)
    } else if (loader) {
      setAll(null)
      window.kairo.loaders.versions(loader).then(
        (v) => {
          if (!alive) return
          setAll(v.mcs)
          setLoaderVersions(v.loaderVersions)
        },
        () => alive && setAll([])
      )
    } else setAll([])
    return () => {
      alive = false
    }
  }, [kind, isKairo, loader, live, showSnapshots])

  const list = all ?? []
  const mcOk = list.includes(mc) ? mc : (POPULAR.find((p) => list.includes(p)) ?? list[0] ?? '')
  const popular = POPULAR.filter((p) => list.includes(p)).slice(0, 5)
  const shortList = popular.length ? (popular.includes(mcOk) ? popular : [...popular, mcOk]) : list.slice(0, 5)
  const shown = more ? list : shortList

  // Sodium, Iris and Lithium, where Modrinth has them for this loader and version.
  useEffect(() => {
    let alive = true
    setExtras(null)
    if ((kind !== 'fabric' && kind !== 'neoforge') || !mcOk) {
      setExtras([])
      return
    }
    window.kairo.loaders.extras(kind, mcOk).then(
      (x) => alive && setExtras(x),
      () => alive && setExtras([])
    )
    return () => {
      alive = false
    }
  }, [kind, mcOk])

  const finish = async (result: Promise<CreateResult>) => {
    setBusy(true)
    setError(null)
    try {
      const r = await result
      if (r.ok) onCreated(r.install)
      else if (!r.cancelled) setError(r.error)
    } finally {
      setBusy(false)
    }
  }

  if (kind === 'modpack') {
    return (
      <div className="setup">
        <p className="modal-note">
          Choose a Modrinth modpack file (.mrpack). Every file it lists is downloaded from Modrinth and checked; packs that need
          anything else are refused.
        </p>
        <Problem error={error} />
        <div className="setup-actions">
          <button type="button" className="btn-accent" disabled={busy} onClick={() => void finish(window.kairo.installs.importModpack())}>
            Choose a modpack file
          </button>
        </div>
      </div>
    )
  }

  const kindName = isKairo ? EDITIONS[kind].title : kind === 'vanilla' ? 'Minecraft' : LOADERS[loader!].name
  const defaultName = isKairo ? kindName : `${kindName} ${mcOk}`
  const chosenExtras = (extras ?? []).filter((x) => picked[x.id as Extra['id']]).map((x) => x.id)
  const create = () => void finish(window.kairo.installs.create({ loader: kind, mc: mcOk, extras: chosenExtras, name: name.trim() || undefined }))
  const forgeVersion = loaderVersions[mcOk]

  return (
    <div className="setup">
      <div className="field">
        <span className="field-label" id="nv-mc">
          {isKairo ? 'Version' : 'Minecraft version'}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="nv-mc"
          aria-busy={all === null}
          className={more ? 'chips chips-scroll scroll' : 'chips'}
          data-roving
          onKeyDown={(e) => rovingKeyDown(e, { select: true })}
        >
          {all === null && <span className="field-label">Checking versions…</span>}
          {shown.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              className="chip chip-mc"
              aria-checked={v === mcOk}
              tabIndex={rovingTabIndex(v === mcOk)}
              onClick={() => setMc(v)}
            >
              {isKairo ? `Minecraft ${v}` : v}
            </button>
          ))}
          {all && list.length > shortList.length && (
            <button type="button" className="chip chip-more" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? 'Fewer' : 'More…'}
            </button>
          )}
        </div>
        {isKairo && <span className="modal-note">The newest {kindName} for this version, checked against its release. More versions come with new Kairo releases.</span>}
      </div>

      {(kind === 'fabric' || kind === 'neoforge') && (extras === null || extras.length > 0) && (
        <div className="field">
          <span className="field-label" id="nv-extras">
            Add to it
          </span>
          <div className="chips" role="group" aria-labelledby="nv-extras" aria-busy={extras === null}>
            {extras === null && <span className="field-label">Checking Modrinth…</span>}
            {(extras ?? []).map((x) => (
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

      <label className="field">
        <span className="field-label">Name</span>
        <input className="text-input" type="text" value={name} maxLength={48} placeholder={defaultName} spellCheck={false} onChange={(e) => setName(e.target.value)} />
      </label>

      {handOff && (
        <p className="modal-note">
          {kind === 'optifine'
            ? 'OptiFine can only be downloaded from optifine.net. Get it there, then choose the file here.'
            : `Forge asks to be downloaded from its own site, which its ads pay for${forgeVersion ? ` (Forge ${forgeVersion} is the one to get)` : ''}. Then choose the file here.`}
        </p>
      )}
      <Problem error={error} />

      <div className="setup-actions">
        {handOff ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => void window.kairo.loaders.openDownloadPage(kind as 'forge' | 'optifine', mcOk)}>
              {kind === 'forge' ? "Open Forge's download page" : 'Open optifine.net'}
            </button>
            <button type="button" className="btn-accent" disabled={busy || !mcOk} onClick={create}>
              Choose the downloaded file
            </button>
          </>
        ) : (
          <button type="button" className="btn-accent" disabled={busy || !mcOk} onClick={create}>
            {busy ? 'Creating…' : `Create ${name.trim() || defaultName}`}
          </button>
        )}
      </div>
    </div>
  )
}

function Problem({ error }: { error: { title: string; message: string } | null }) {
  if (!error) return null
  return (
    <p className="modal-error" role="alert">
      <b>{error.title}</b> {error.message}
    </p>
  )
}
