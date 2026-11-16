import { useCallback, useEffect, useState } from 'react'
import type { AddonChoice, AddonClash, AddonsResult, AddonsState, AddonView, KairoEdition } from '../../../shared/api'
import { Modal } from '../components/Modal'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { groupAddons } from '../state/addonGroups'
import { useStore } from '../state/store'

// Addons: small official extras for Kairo and Kairo Void, from
// Mordsome/KairoAddons. Chosen once for the whole launcher; each one can be
// on for both editions, one of them, or off. Changes apply the next time the
// game starts.

const EDITION: Record<KairoEdition, string> = { kairo: 'Kairo', void: 'Kairo Void' }

const CHOICES: { id: AddonChoice; name: string; needs: KairoEdition[] }[] = [
  { id: 'both', name: 'Kairo and Kairo Void', needs: ['kairo', 'void'] },
  { id: 'kairo', name: 'Kairo only', needs: ['kairo'] },
  { id: 'void', name: 'Kairo Void only', needs: ['void'] },
  { id: 'off', name: 'Off', needs: [] }
]

function stateLabel(a: AddonView): { text: string; tone?: 'muted' | 'update' } {
  if (!a.installed) return { text: 'Not installed', tone: 'muted' }
  if (a.update) return { text: 'Update available', tone: 'update' }
  if (!a.listed) return { text: 'No longer listed', tone: 'muted' }
  if (a.choice === 'off') return { text: 'Installed, off', tone: 'muted' }
  return { text: 'Installed' }
}

function AddonIcon({ addon, big }: { addon: AddonView; big?: boolean }) {
  const [failed, setFailed] = useState(false)
  const cls = big ? 'addon-icon addon-icon-big' : 'addon-icon'
  if (!addon.hasIcon || failed) {
    return (
      <span className={`${cls} addon-icon-empty`} aria-hidden="true">
        {addon.name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return <img className={cls} src={`kairo-icon://addon/${addon.id}`} alt="" onError={() => setFailed(true)} />
}

function Editions({ editions }: { editions: KairoEdition[] }) {
  return (
    <span className="addon-editions">
      {editions.map((e) => (
        <span key={e} className="addon-edition" data-edition={e}>
          {EDITION[e]}
        </span>
      ))}
    </span>
  )
}

export function AddonsScreen({ active }: { active: boolean }) {
  const phase = useStore((s) => s.game.phase)
  const [state, setState] = useState<AddonsState | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const refresh = useCallback(async (fresh = false) => {
    setChecking(fresh)
    try {
      setState(await window.kairo.addons.state(fresh))
    } finally {
      setChecking(false)
    }
  }, [])

  // Fresh each time the page opens.
  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  const [clash, setClash] = useState<AddonClash | null>(null)

  const act = async (key: string, work: () => Promise<AddonsResult>) => {
    setBusy(key)
    try {
      const r = await work()
      setState(r.state)
      setProblem(r.ok ? null : r.error)
      // Two addons that don't go together: the player picks which one to keep.
      setClash(r.ok ? (r.clash ?? null) : null)
    } finally {
      setBusy(null)
    }
  }

  const addons = state?.addons ?? []
  const detail = addons.find((a) => a.id === sel) ?? addons[0]
  useEffect(() => setProblem(null), [detail?.id])
  const running = phase !== 'idle'

  return (
    <div className="page page-plain" data-active={active} inert={!active}>
      <div className="lib">
        <section className="lib-main" aria-labelledby="addons-title">
          <div className="page-head">
            <h1 id="addons-title" className="page-title">
              Addons
            </h1>
            <span className="page-sub">Extras for Kairo and Kairo Void.</span>
            <button type="button" className="btn-ghost btn-small lib-new" disabled={checking} onClick={() => void refresh(true)}>
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          </div>

          <div className="lib-rows scroll" aria-busy={state === null}>
            {state === null && <span className="field-label">Loading the addons…</span>}
            {state && addons.length === 0 && (
              <div className="card addons-empty">
                <b>{state.catalogue === 'offline' ? "The addons list can't be reached right now" : 'No addons yet'}</b>
                <span className="setting-desc">
                  {state.catalogue === 'offline'
                    ? 'The launcher looks again the next time you open this page.'
                    : 'When Mordsome publishes addons for Kairo, they show up here.'}
                </span>
              </div>
            )}
            {groupAddons(addons).map(({ group, addons: inGroup }) => (
              <section key={group.id} className="addon-group" aria-labelledby={`addon-group-${group.id}`}>
                <h2 id={`addon-group-${group.id}`} className="addon-group-head">
                  {group.name}
                  <span className="addon-group-sub">{group.sub}</span>
                </h2>
                {inGroup.map((a) => {
                  const label = stateLabel(a)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="librow addonrow"
                      aria-pressed={detail?.id === a.id}
                      onClick={() => setSel(a.id)}
                    >
                      <AddonIcon addon={a} />
                      <span className="librow-text">
                        <span className="librow-head">
                          <b className="librow-name">{a.name}</b>
                          <span className="mc-chip">{a.version}</span>
                        </span>
                        <span className="librow-sub">{a.summary || 'Installed by you earlier.'}</span>
                        <Editions editions={a.editions} />
                      </span>
                      <span className="librow-state" data-tone={label.tone}>
                        {label.text}
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
            {state?.catalogue === 'offline' && addons.length > 0 && (
              <p className="modal-note">The addons list can't be reached right now. Installed addons keep working.</p>
            )}
          </div>
        </section>

        {detail && (
          <aside className="lib-detail addon-detail" aria-label="Addon details">
            <div className="addon-detail-head">
              <AddonIcon addon={detail} big />
              <span className="detail-head">
                <span className="detail-mc">
                  {detail.installed ? `Version ${detail.installed}` : `Version ${detail.version}`}
                  {detail.update ? ` · ${detail.update} available` : ''}
                </span>
                <h2 className="detail-name">{detail.name}</h2>
                <Editions editions={detail.editions} />
              </span>
            </div>

            <p className="addon-desc scroll">
              {detail.description ||
                detail.summary ||
                "This addon isn't in the addons list any more. It keeps working until you uninstall it."}
            </p>

            {detail.installed && (
              <div className="addon-choice">
                <span className="field-label" id="addon-choice-label">
                  Used in
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="addon-choice-label"
                  className="seg addon-choices"
                  data-roving
                  onKeyDown={(e) => rovingKeyDown(e, { select: true })}
                >
                  {CHOICES.filter((c) => c.needs.every((e) => detail.editions.includes(e))).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      className="seg-item"
                      aria-checked={detail.choice === c.id}
                      tabIndex={rovingTabIndex(detail.choice === c.id)}
                      disabled={busy !== null}
                      onClick={() => void act('choice', () => window.kairo.addons.setChoice(detail.id, c.id))}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {detail.clashes.length > 0 && (
              <p className="addon-clash">
                Doesn't go together with {joinNames(detail.clashes.map((c) => c.name))}: only one of them can be on at a time.
              </p>
            )}
            {detail.note && (
              <p className="addon-note" role="note">
                {detail.note}
              </p>
            )}
            {running && <p className="modal-note">Changes apply the next time you start the game.</p>}

            <div className="detail-actions">
              {!detail.installed && (
                <button
                  type="button"
                  className="btn-accent detail-play"
                  disabled={busy !== null || running || !detail.listed}
                  onClick={() => void act('install', () => window.kairo.addons.install(detail.id))}
                >
                  {busy === 'install' ? 'Installing…' : 'Install'}
                </button>
              )}
              {detail.update && (
                <button
                  type="button"
                  className="btn-accent detail-play"
                  disabled={busy !== null || running}
                  onClick={() => void act('install', () => window.kairo.addons.install(detail.id))}
                >
                  {busy === 'install' ? 'Updating…' : `Update to ${detail.update}`}
                </button>
              )}
              {detail.installed && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy !== null || running}
                  aria-label={`Uninstall ${detail.name}`}
                  onClick={() => void act('uninstall', () => window.kairo.addons.uninstall(detail.id))}
                >
                  {busy === 'uninstall' ? 'Removing…' : 'Uninstall'}
                </button>
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
      {clash && (
        <ClashDialog
          clash={clash}
          onKeep={(keep) =>
            void act('choice', () => window.kairo.addons.setChoice(clash.id, clash.choice, keep)).then(() => setClash(null))
          }
          onClose={() => setClash(null)}
        />
      )}
    </div>
  )
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "X and Y don't go together": keep one; the other is turned off where they'd meet. */
function ClashDialog({ clash, onKeep, onClose }: { clash: AddonClash; onKeep(keep: 'this' | 'other'): void; onClose(): void }) {
  const where = clash.editions.map((e) => EDITION[e]).join(' and ')
  return (
    <Modal
      title={`${clash.name} and ${clash.otherName} don't go together`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={() => onKeep('other')} data-autofocus>
            Keep {clash.otherName}
          </button>
          <button type="button" className="btn-accent" onClick={() => onKeep('this')}>
            Keep {clash.name}
          </button>
        </>
      }
    >
      <p className="modal-note">
        They change the same parts of Kairo, so only one of them can be on in {where}. Which one do you want to keep there?
      </p>
      <p className="modal-note">The other one stays installed and is turned off in {where}. You can change this any time.</p>
    </Modal>
  )
}
