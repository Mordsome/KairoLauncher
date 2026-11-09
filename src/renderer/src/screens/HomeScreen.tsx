import { useEffect, useRef, useState, type RefObject } from 'react'
import { GridIcon, PlayIcon } from '../components/Icons'
import { describeSelection, useStore } from '../state/store'
import { LogsDialog } from './LibraryDialogs'
import { Picker } from './Picker'

export function HomeScreen({ active }: { active: boolean }) {
  const homeView = useStore((s) => s.homeView)
  const layout = useStore((s) => s.settings.homeLayout)
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
      requestAnimationFrame(() => pickerRoot.current?.querySelector<HTMLElement>('.pick-tile[aria-checked="true"], .pick-tile')?.focus())
    } else {
      requestAnimationFrame(() => pickerButton.current?.focus())
    }
  }, [homeView])

  return (
    <div className="page" data-active={active} inert={!active}>
      <div className="shade shade-home" data-layout={layout} data-on={!pick} aria-hidden="true" />
      <div className="shade shade-pick" data-on={pick} aria-hidden="true" />
      <HomeMain visible={!pick} pickerButton={pickerButton} />
      <Picker visible={pick} rootRef={pickerRoot} />
    </div>
  )
}

/** "What's new in Kairo": the latest release's notes, as plain text, with a link to the full page. */
function PatchNotesCard() {
  const show = useStore((s) => s.settings.showPatchNotes)
  const latest = useStore((s) => s.kairo?.latest ?? null)
  if (!show || !latest?.notes) return null
  const { points, url } = latest.notes
  return (
    <aside className="notes" aria-labelledby="notes-title">
      <span className="notes-kicker">Patch notes</span>
      <h2 id="notes-title" className="notes-title">
        What's new in Kairo {latest.version}
      </h2>
      {points.length ? (
        <ul className="notes-list">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="notes-empty">This release has no notes yet.</p>
      )}
      {url && (
        <button type="button" className="btn-ghost btn-small notes-more" onClick={() => void window.kairo.app.openExternal(url)}>
          Read the full notes
        </button>
      )}
    </aside>
  )
}

function HomeMain({ visible, pickerButton }: { visible: boolean; pickerButton: RefObject<HTMLButtonElement | null> }) {
  const selection = useStore((s) => s.selection)
  const installs = useStore((s) => s.installs)
  const game = useStore((s) => s.game)
  const notice = useStore((s) => s.notice)
  const account = useStore((s) => s.account)
  const playOrStop = useStore((s) => s.playOrStop)
  const layout = useStore((s) => s.settings.homeLayout)
  const openPicker = useStore((s) => s.openPicker)
  const [showLog, setShowLog] = useState(false)

  const sel = describeSelection(selection, installs)
  // The install that just ran: the selected one, or the vanilla install for that version.
  const crashed =
    installs.find((i) => i.id === selection.installId) ??
    (selection.edition === 'vanilla' ? installs.find((i) => i.edition === 'vanilla' && i.mc === selection.mc) : undefined)
  const { phase, progress } = game
  const percent = Math.round(progress * 100)

  const label = phase === 'idle' ? 'Play' : phase === 'download' ? `${percent}%` : phase === 'launch' ? 'Starting' : 'Stop'
  const playAria =
    phase === 'running'
      ? 'Stop the game'
      : phase === 'idle'
        ? `Play ${sel.title} on Minecraft ${sel.mc}`
        : phase === 'download'
          ? `Downloading, ${percent}%. Press to cancel`
          : 'Starting Minecraft'

  const idleStatus = () => {
    if (notice) return notice
    if (game.error) return `${game.error.title}\n${game.error.message}`
    if (game.crash) return `${game.crash.title}\n${game.crash.message}`
    const who = account?.uuid === null ? `Offline dev account: ${account.name}` : `Signed in as ${account?.name ?? ''}`
    return `${who}\nReady to play`
  }
  const status =
    phase === 'idle'
      ? idleStatus()
      : phase === 'download'
        ? game.detail || 'Downloading game files'
        : phase === 'launch'
          ? 'Starting Minecraft'
          : `${sel.title} is running`

  return (
    <section className="screen screen-home" data-layout={layout} data-on={visible} inert={!visible} aria-label="Home">
      <div className="home-stage">
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
          <span className="status" role="status" data-tone={phase === 'idle' && (game.error || game.crash) ? 'error' : undefined}>
            {status}
          </span>
          {phase === 'idle' && game.crash && !notice && (
            <div className="crash-actions">
              {game.crash.hasReport && (
                <button type="button" className="btn-ghost btn-small" onClick={() => void window.kairo.game.openCrashReport()}>
                  Open crash report
                </button>
              )}
              {crashed && (
                <button type="button" className="btn-ghost btn-small" onClick={() => setShowLog(true)}>
                  View log
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {showLog && crashed && <LogsDialog install={crashed} onClose={() => setShowLog(false)} />}
      <PatchNotesCard />
    </section>
  )
}
