import { useState, type KeyboardEvent, type RefObject } from 'react'
import { BackIcon } from '../components/Icons'
import { bannerKind, InstallBanner } from '../components/InstallBanner'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { selectionFor, useStore, type Install } from '../state/store'
import { NewInstallDialog } from './NewInstallDialog'

interface Props {
  visible: boolean
  rootRef: RefObject<HTMLElement | null>
}

/** Kairo installs first, then the most recently played. */
export function orderInstalls(installs: Install[]): Install[] {
  const kairoFirst = (i: Install) => (i.edition === 'kairo' ? 0 : i.edition === 'void' ? 1 : 2)
  return [...installs].sort((a, b) => kairoFirst(a) - kairoFirst(b) || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

export function installState(i: Install, latestKairo: string | null): string {
  if (!i.installed) return 'Downloads on Play'
  if ((i.edition === 'kairo' || i.edition === 'void') && latestKairo && i.kairoVersion && latestKairo !== i.kairoVersion) {
    return i.keepUpdated ? 'Updates on Play' : 'Update available'
  }
  return 'Ready'
}

/** Choose what to play: your installs, and a way to make a new one. */
export function Picker({ visible, rootRef }: Props) {
  const installs = useStore((s) => s.installs)
  const selection = useStore((s) => s.selection)
  const latestKairo = useStore((s) => s.kairo?.latest?.version ?? null)
  const select = useStore((s) => s.select)
  const setPickFocus = useStore((s) => s.setPickFocus)
  const closePicker = useStore((s) => s.closePicker)
  const customCreated = useStore((s) => s.customCreated)
  const openMods = useStore((s) => s.openModsFor)
  const [adding, setAdding] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !adding) {
      event.preventDefault()
      closePicker()
    }
  }

  return (
    <section ref={rootRef} className="screen screen-pick" data-on={visible} inert={!visible} aria-label="Choose what to play" onKeyDown={onKeyDown}>
      <div className="pick-head">
        <button type="button" className="back" aria-label="Back to Home" onClick={closePicker}>
          <BackIcon />
        </button>
        <h1 className="pick-title">Choose what to play</h1>
      </div>

      <div role="radiogroup" aria-label="Your installs" className="pick-grid scroll" data-roving onKeyDown={(e) => rovingKeyDown(e, { columns: 3 })}>
        {orderInstalls(installs).map((i) => {
          const on = i.id === selection.installId
          const focus = () => setPickFocus(i.id)
          return (
            <button
              key={i.id}
              type="button"
              role="radio"
              className="pick-tile"
              aria-checked={on}
              aria-label={`${i.name}, Minecraft ${i.mc}, ${installState(i, latestKairo).toLowerCase()}`}
              tabIndex={rovingTabIndex(on || (!selection.installId && i === installs[0]))}
              onClick={() => select(selectionFor(i))}
              onMouseEnter={focus}
              onFocus={focus}
            >
              <InstallBanner kind={bannerKind(i)} className="pick-banner" />
              <span className="tile-text">
                <b>{i.name}</b>
                <span>
                  Minecraft {i.mc} · {on ? 'Selected' : installState(i, latestKairo)}
                </span>
              </span>
            </button>
          )
        })}
        <button type="button" className="pick-tile pick-new" onClick={() => setAdding(true)}>
          <span className="thumb pick-banner pick-plus" aria-hidden="true">
            +
          </span>
          <span className="tile-text">
            <b>New install</b>
            <span>Kairo, a loader, plain Minecraft or a modpack</span>
          </span>
        </button>
        <div className="pick-tile pick-soon" aria-label="Kairo Lite for Minecraft 1.8.9, coming soon">
          <InstallBanner kind="lite" className="pick-banner" />
          <span className="tile-text">
            <b>Kairo Lite</b>
            <span>Minecraft 1.8.9 · Coming soon</span>
          </span>
        </div>
      </div>

      {adding && (
        <NewInstallDialog
          onClose={() => setAdding(false)}
          onDone={(install, addMods) => {
            setAdding(false)
            customCreated(install)
            if (addMods) openMods(install.id)
          }}
        />
      )}
    </section>
  )
}
