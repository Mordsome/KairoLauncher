import { useStore } from '../state/store'
import { CloseIcon, MinimiseIcon } from './Icons'

export function TitleBar() {
  const screen = useStore((s) => s.screen)
  // Home has the big edition title instead, so the label only shows elsewhere.
  const showLabel = screen !== 'home'
  const hasRail = screen !== 'signin'
  const update = useStore((s) => s.update)
  const phase = useStore((s) => s.game.phase)
  const ready = update?.status === 'ready'

  return (
    <header className="titlebar" data-label={showLabel} data-rail={hasRail}>
      <span className="titlebar-label" aria-hidden={!showLabel}>
        Kairo Launcher
      </span>
      {ready && (
        <button
          type="button"
          className="update-pill"
          disabled={phase !== 'idle'}
          title={phase !== 'idle' ? 'Close Minecraft first' : undefined}
          onClick={() => void window.kairo.app.update.install()}
        >
          Restart to update to {update.version}
        </button>
      )}
      <div className="winctl">
        <button type="button" className="winbtn" aria-label="Minimise" onClick={() => window.kairo.window.minimize()}>
          <MinimiseIcon />
        </button>
        <button type="button" className="winbtn winbtn-close" aria-label="Close" onClick={() => window.kairo.window.close()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
