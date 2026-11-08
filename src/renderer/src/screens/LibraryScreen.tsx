import { useEffect, useState } from 'react'
import type { CustomInstallInfo } from '../../../shared/api'
import { bannerKind, InstallBanner } from '../components/InstallBanner'
import { PlayIcon } from '../components/Icons'
import { LOADERS } from '../data/catalog'
import { selectionFor, useStore, type Install } from '../state/store'
import { ChangeVersionDialog, DeleteDialog, LogsDialog, RenameDialog } from './LibraryDialogs'
import { ModsDialog } from './ModsDialog'
import { sharesMinecraft } from './GameFolderCard'
import { NewInstallDialog } from './NewInstallDialog'
import { installState, orderInstalls } from './Picker'

/** Modpacks pin their own versions; Forge and OptiFine need a new installer file; Kairo picks its own. */
function canChangeVersion(i: Install): boolean {
  return !i.modpack && i.loader !== 'forge' && i.loader !== 'optifine' && i.edition !== 'kairo' && i.edition !== 'void'
}

function hasMods(i: Install): boolean {
  return i.loader === 'fabric' || i.loader === 'neoforge' || i.loader === 'forge'
}

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
    const edition = i.edition === 'void' ? 'Kairo Void' : 'Kairo'
    if (!i.installed) return `${edition} · downloads the first time you press Play`
    return `${edition} ${i.kairoVersion ?? ''} · ${playtime(i)}`
  }
  if (i.modpack) return `Modpack · ${loader} · ${playtime(i)}`
  const extras = i.extras.length ? ` · ${i.extras.join(', ')}` : ''
  return `${loader}${extras} · ${playtime(i)}`
}

export function LibraryScreen({ active }: { active: boolean }) {
  const installs = useStore((s) => s.installs)
  const librarySel = useStore((s) => s.librarySel)
  const setLibrarySel = useStore((s) => s.setLibrarySel)
  const setKeepUpdated = useStore((s) => s.setKeepUpdated)
  const latestKairo = useStore((s) => s.kairo?.latest?.version ?? null)
  const select = useStore((s) => s.select)
  const playOrStop = useStore((s) => s.playOrStop)
  const phase = useStore((s) => s.game.phase)

  const detail = installs.find((i) => i.id === librarySel) ?? installs[0]
  const isKairo = detail?.edition === 'kairo' || detail?.edition === 'void'

  const refreshCustom = useStore((s) => s.refreshCustom)
  const sharedSetting = useStore((s) => s.settings.sharedMinecraft && s.info?.minecraftFolder != null)
  const sharedNow = !!detail && sharedSetting && sharesMinecraft(detail)
  const [dialog, setDialog] = useState<'logs' | 'rename' | 'version' | 'delete' | 'mods' | 'new' | null>(null)
  const modsFor = useStore((s) => s.modsFor)

  // Right after making an install with "Add mods": open its Mods dialog.
  useEffect(() => {
    if (!modsFor || !installs.some((i) => i.id === modsFor)) return
    setLibrarySel(modsFor)
    setDialog('mods')
    useStore.setState({ modsFor: null })
  }, [modsFor, installs, setLibrarySel])

  const created = async (install: CustomInstallInfo, addMods: boolean) => {
    setDialog(null)
    await refreshCustom()
    setLibrarySel(install.id)
    if (addMods) setDialog('mods')
  }
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const close = () => setDialog(null)
  const done = () => {
    setDialog(null)
    setProblem(null)
    void refreshCustom()
  }

  // A problem belongs to the install it happened on.
  useEffect(() => setProblem(null), [detail?.id])

  const duplicate = async () => {
    if (!detail) return
    const r = await window.kairo.installs.duplicate(detail.id)
    if (!r.ok) return setProblem(r.error)
    setProblem(null)
    await refreshCustom()
    setLibrarySel(r.install.id)
  }

  const playDetail = () => {
    if (!detail) return
    select(selectionFor(detail))
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
            <button type="button" className="btn-accent btn-small lib-new" onClick={() => setDialog('new')}>
              <span aria-hidden="true">+</span> New install
            </button>
          </div>

          <div className="lib-rows scroll">
            {orderInstalls(installs).map((i) => {
              const sel = detail?.id === i.id
              return (
                <button key={i.id} type="button" className="librow" aria-pressed={sel} onClick={() => setLibrarySel(i.id)}>
                  <InstallBanner kind={bannerKind(i)} />
                  <span className="librow-text">
                    <span className="librow-head">
                      <b className="librow-name">{i.name}</b>
                      <span className="mc-chip">{i.mc}</span>
                    </span>
                    <span className="librow-sub">{summary(i)}</span>
                  </span>
                  <span className="librow-state" data-tone={i.installed ? undefined : 'muted'}>
                    {installState(i, latestKairo)}
                  </span>
                </button>
              )
            })}
            {installs.length === 0 && <p className="modal-note">No installs yet. Make one with New install.</p>}
            <button type="button" className="librow" disabled aria-label="Kairo Lite for Minecraft 1.8.9, coming soon">
              <InstallBanner kind="lite" />
              <span className="librow-text">
                <span className="librow-head">
                  <b className="librow-name">Kairo Lite</b>
                  <span className="mc-chip">1.8.9</span>
                </span>
                <span className="librow-sub">The Kairo look for classic PvP</span>
              </span>
              <span className="librow-state">Coming soon</span>
            </button>
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
              <span className="field-label">
                {detail.mods.length
                  ? 'Installed for you'
                  : isKairo
                    ? 'Kairo, Fabric, Fabric API and Sodium download the first time you press Play'
                    : detail.edition === 'other' && !detail.installed
                      ? 'Everything downloads the first time you press Play'
                      : 'Nothing extra installed'}
              </span>
              {detail.mods.map((m) => (
                <div key={m.name} className="mod-row">
                  <span>{m.name}</span>
                  <span className="mod-ver">{m.version}</span>
                </div>
              ))}
            </div>

            {sharedNow && <span className="detail-shared">Worlds, packs and settings: your .minecraft folder</span>}

            {isKairo && (
              <label className="keep-updated">
                <span>
                  Keep Kairo updated
                  <br />
                  <span className="keep-sub">Fabric API and Sodium update with it</span>
                </span>
                <input
                  type="checkbox"
                  checked={detail.keepUpdated}
                  onChange={(e) => setKeepUpdated(detail.id, e.target.checked)}
                />
              </label>
            )}

            <div className="detail-actions">
              <button type="button" className="btn-accent detail-play" onClick={playDetail} disabled={phase !== 'idle'}>
                <PlayIcon size={18} />
                Play
              </button>
              <button type="button" className="btn-ghost" onClick={() => void window.kairo.installs.openFolder(detail.id)}>
                Open folder
              </button>
            </div>

            <div className="detail-more" role="group" aria-label="More for this install">
              <button type="button" className="btn-ghost btn-small" onClick={() => setDialog('logs')}>
                Logs
              </button>
              {(
                <>
                  {hasMods(detail) && (
                    <button type="button" className="btn-ghost btn-small" onClick={() => setDialog('mods')}>
                      Mods
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-small" onClick={() => setDialog('rename')}>
                    Rename
                  </button>
                  <button type="button" className="btn-ghost btn-small" onClick={() => void duplicate()} disabled={phase !== 'idle'}>
                    Duplicate
                  </button>
                  {canChangeVersion(detail) && (
                    <button type="button" className="btn-ghost btn-small" onClick={() => setDialog('version')} disabled={phase !== 'idle'}>
                      Change version
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-small btn-danger-text" onClick={() => setDialog('delete')} disabled={phase !== 'idle'}>
                    Delete
                  </button>
                </>
              )}
            </div>
            {problem && (
              <p className="detail-error" role="alert">
                <b>{problem.title}</b> {problem.message}
              </p>
            )}
          </aside>
        )}
      </div>
      {dialog === 'new' && <NewInstallDialog onClose={close} onDone={(install, addMods) => void created(install, addMods)} />}
      {detail && dialog === 'logs' && <LogsDialog install={detail} onClose={close} />}
      {detail && dialog === 'mods' && <ModsDialog install={detail} onClose={done} />}
      {detail && dialog === 'rename' && <RenameDialog install={detail} onDone={done} onClose={close} />}
      {detail && dialog === 'version' && <ChangeVersionDialog install={detail} onDone={done} onClose={close} />}
      {detail && dialog === 'delete' && <DeleteDialog install={detail} onDone={done} onClose={close} />}
    </div>
  )
}

