import { useState } from 'react'
import { useStore } from '../state/store'
import { Avatar } from './Avatar'
import { HomeIcon, LibraryIcon, SettingsIcon } from './Icons'
import { Logo } from './Logo'
import { Menu, type MenuItem } from './Menu'

export function Rail() {
  const screen = useStore((s) => s.screen)
  const homeView = useStore((s) => s.homeView)
  const account = useStore((s) => s.account)
  const go = useStore((s) => s.go)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  const hidden = screen === 'signin'
  const current = (target: string) => (screen === target && !(target === 'home' && homeView === 'pick') ? 'page' : undefined)
  const name = account?.name ?? ''
  const skin = useStore((s) => s.accounts?.accounts.find((a) => a.uuid === account?.uuid)?.skin ?? false)

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
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenuAt({ x: r.right + 12, y: r.bottom })
        }}
      >
        {account && <Avatar uuid={account.uuid} name={name} skin={skin} className="avatar-rail" />}
      </button>
      {menuAt && <AccountMenu at={menuAt} onClose={() => setMenuAt(null)} />}
    </nav>
  )
}

/** The small account menu from the rail: switch account, add one, or go to Settings → Account. */
function AccountMenu({ at, onClose }: { at: { x: number; y: number }; onClose(): void }) {
  const accounts = useStore((s) => s.accounts)
  const account = useStore((s) => s.account)
  const busy = useStore((s) => s.game.phase !== 'idle')
  const switchAccount = useStore((s) => s.switchAccount)
  const addAccount = useStore((s) => s.addAccount)
  const askSignOut = useStore((s) => s.askSignOut)
  const go = useStore((s) => s.go)
  const setSettingsTab = useStore((s) => s.setSettingsTab)
  const list = accounts?.accounts ?? []

  const items: MenuItem[] = list.map((a) => {
    const isActive = a.uuid === accounts?.active
    return {
      label: a.name,
      hint: isActive ? 'Plays now' : busy ? 'Close the game to switch' : 'Switch to this account',
      icon: <Avatar uuid={a.uuid} name={a.name} skin={a.skin} className="avatar-menu" />,
      checked: isActive,
      disabled: busy && !isActive,
      onSelect: () => {
        if (!isActive) switchAccount(a.uuid)
      }
    }
  })
  if (list.length === 0 && account) {
    items.push({ label: account.name, hint: 'Offline dev account', icon: <Avatar uuid={null} name={account.name} skin={false} className="avatar-menu" />, checked: true, onSelect: () => undefined })
  }
  items.push(
    { label: 'Add another account', separated: true, onSelect: addAccount },
    {
      label: 'Manage accounts',
      onSelect: () => {
        setSettingsTab('account')
        go('settings')
      }
    }
  )
  const active = list.find((a) => a.uuid === accounts?.active)
  if (active) items.push({ label: `Sign out of ${active.name}…`, danger: true, separated: true, onSelect: () => askSignOut(active.uuid) })

  return <Menu label="Accounts" at={at} items={items} onClose={onClose} />
}
