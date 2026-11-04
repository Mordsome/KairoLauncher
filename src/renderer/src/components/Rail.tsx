import { useStore } from '../state/store'
import { HomeIcon, LibraryIcon, SettingsIcon } from './Icons'
import { Logo } from './Logo'

export function Rail() {
  const screen = useStore((s) => s.screen)
  const homeView = useStore((s) => s.homeView)
  const account = useStore((s) => s.account)
  const go = useStore((s) => s.go)
  const setSettingsTab = useStore((s) => s.setSettingsTab)

  const hidden = screen === 'signin'
  const current = (target: string) => (screen === target && !(target === 'home' && homeView === 'pick') ? 'page' : undefined)
  const name = account?.name ?? ''

  return (
    <nav className="rail" aria-label="Launcher" data-hidden={hidden} inert={hidden}>
      <Logo className="rail-logo" />
      <button type="button" className="railbtn" aria-label="Home" aria-current={current('home')} onClick={() => go('home')}>
        <HomeIcon />
      </button>
      <button type="button" className="railbtn" aria-label="Library" aria-current={current('library')} onClick={() => go('library')}>
        <LibraryIcon />
      </button>
      <button type="button" className="railbtn" aria-label="Settings" aria-current={current('settings')} onClick={() => go('settings')}>
        <SettingsIcon />
      </button>
      <button
        type="button"
        className="rail-account"
        aria-label={`Account: ${name}`}
        onClick={() => {
          setSettingsTab('account')
          go('settings')
        }}
      >
        {name.slice(0, 1).toUpperCase()}
      </button>
    </nav>
  )
}
