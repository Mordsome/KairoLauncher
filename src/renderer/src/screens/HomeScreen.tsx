import { useEffect, useRef, type RefObject } from 'react'
import { EDITION_ORDER, type EditionId } from '../data/catalog'
import { GridIcon, PlayIcon } from '../components/Icons'
import { describeSelection, lookEdition, useStore } from '../state/store'
import { Picker } from './Picker'

const BG_CLASS: Record<EditionId, string> = {
  kairo: 'bg-kairo',
  void: 'bg-void',
  lite: 'bg-lite',
  vanilla: 'bg-vanilla',
  other: 'bg-other'
}

export function HomeScreen({ active }: { active: boolean }) {
  const homeView = useStore((s) => s.homeView)
  const look = useStore(lookEdition)
  const pick = homeView === 'pick'

  const pickerButton = useRef<HTMLButtonElement>(null)
  const pickerRoot = useRef<HTMLElement>(null)
  const lastView = useRef(homeView)

  // Move keyboard focus with the slide, so keyboard users land in the new view.
  useEffect(() => {
    const was = lastView.current
    lastView.current = homeView
    if (was === homeView) return
    if (homeView === 'pick') {
      requestAnimationFrame(() => pickerRoot.current?.querySelector<HTMLElement>('.ed[aria-checked="true"]')?.focus())
    } else {
      requestAnimationFrame(() => pickerButton.current?.focus())
    }
  }, [homeView])

  return (
    <div className="page" data-active={active} inert={!active}>
      {EDITION_ORDER.map((id) => (
        <div key={id} className={`bg ${BG_CLASS[id]}`} data-on={id === look} aria-hidden="true" />
      ))}
      <div className="shade shade-home" data-on={!pick} aria-hidden="true" />
      <div className="shade shade-pick" data-on={pick} aria-hidden="true" />
      <HomeMain visible={!pick} pickerButton={pickerButton} />
      <Picker visible={pick} rootRef={pickerRoot} />
    </div>
  )
}

function HomeMain({ visible, pickerButton }: { visible: boolean; pickerButton: RefObject<HTMLButtonElement | null> }) {
  const selection = useStore((s) => s.selection)
  const installs = useStore((s) => s.installs)
  const play = useStore((s) => s.play)
  const account = useStore((s) => s.account)
  const playOrStop = useStore((s) => s.playOrStop)
  const openPicker = useStore((s) => s.openPicker)

  const sel = describeSelection(selection, installs)
  const { phase, progress } = play
  const percent = Math.round(progress * 100)

  const label = phase === 'idle' ? 'Play' : phase === 'download' ? `${percent}%` : phase === 'launch' ? 'Starting' : 'Stop'
  const playAria =
    phase === 'running'
      ? 'Stop the game'
      : phase === 'idle'
        ? `Play ${sel.title} on Minecraft ${sel.mc}`
        : phase === 'download'
          ? `Downloading, ${percent}%`
          : 'Starting Minecraft'
  const status =
    phase === 'idle'
      ? `Signed in as ${account?.name ?? ''}\nReady to play`
      : phase === 'download'
        ? 'Downloading game files'
        : phase === 'launch'
          ? 'Starting Minecraft'
          : `${sel.title} is running`

  return (
    <section className="screen screen-home" data-on={visible} inert={!visible} aria-label="Home">
      <div className="hero">
        <span className="hero-ver">Minecraft {sel.mc}</span>
        <h1 className="hero-title">{sel.title}</h1>
        <p className="hero-blurb">{sel.blurb}</p>
      </div>

      <div className="home-actions">
        <div className="split" data-running={phase === 'running'}>
          <button type="button" className="half half-play" aria-label={playAria} onClick={playOrStop}>
            <span className="fill" style={{ width: phase === 'download' ? `${percent}%` : '0%' }} />
            {phase === 'idle' && <PlayIcon />}
            <span className="half-label">{label}</span>
          </button>
          <button
            ref={pickerButton}
            type="button"
            className="half half-pick"
            disabled={phase !== 'idle'}
            aria-label={`Choose what to play. Now: ${sel.title}, Minecraft ${sel.mc}`}
            onClick={openPicker}
          >
            <span className="pick-text">
              <b>{sel.title}</b>
              <span>{sel.mc}</span>
            </span>
            <GridIcon />
          </button>
        </div>
        <span className="status" role="status">
          {status}
        </span>
      </div>
    </section>
  )
}
