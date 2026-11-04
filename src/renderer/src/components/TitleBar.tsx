import { useStore } from '../state/store'
import { CloseIcon, MinimiseIcon } from './Icons'

export function TitleBar() {
  const screen = useStore((s) => s.screen)
  // Home has the big edition title instead, so the label only shows elsewhere.
  const showLabel = screen !== 'home'
  const hasRail = screen !== 'signin'

  return (
    <header className="titlebar" data-label={showLabel} data-rail={hasRail}>
      <span className="titlebar-label" aria-hidden={!showLabel}>
        Kairo Launcher
      </span>
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
