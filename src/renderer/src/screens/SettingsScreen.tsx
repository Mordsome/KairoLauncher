import type { UpdateState } from '../../../shared/api'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { Switch, SwitchRow } from '../components/Switch'
import { maxMemoryGB, useStore, type SettingsTab } from '../state/store'

const TABS: [SettingsTab, string][] = [
  ['game', 'Game'],
  ['launcher', 'Launcher'],
  ['account', 'Account'],
  ['privacy', 'Privacy'],
  ['about', 'About']
]

export const DISCLAIMER = 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.'

export function SettingsScreen({ active }: { active: boolean }) {
  const tab = useStore((s) => s.settingsTab)
  const setTab = useStore((s) => s.setSettingsTab)

  return (
    <div className="page page-plain" data-active={active} inert={!active}>
      <div className="settings">
        <h1 className="page-title">Settings</h1>
        <div className="settings-body">
          <div
            role="tablist"
            aria-label="Settings sections"
            aria-orientation="vertical"
            className="tabs"
            data-roving
            onKeyDown={(e) => rovingKeyDown(e, { select: true })}
          >
            {TABS.map(([id, name]) => (
              <button
                key={id}
                id={`tab-${id}`}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={rovingTabIndex(tab === id)}
                onClick={() => setTab(id)}
              >
                {name}
              </button>
            ))}
          </div>

          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="tabpanel scroll">
            {tab === 'game' && <GameTab />}
            {tab === 'launcher' && <LauncherTab />}
            {tab === 'account' && <AccountTab />}
            {tab === 'privacy' && <PrivacyTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function GameTab() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const info = useStore((s) => s.info)

  const totalGB = info ? Math.max(1, Math.round(info.totalMemoryMB / 1024)) : 16
  const maxGB = maxMemoryGB(info)
  const mem = Math.min(settings.memoryGB, maxGB)
  const tight = mem > totalGB * 0.6
  const javaPlaceholder =
    info?.platform === 'win32' ? 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe' : '/usr/lib/jvm/java-21/bin/java'

  return (
    <>
      <div className="card">
        <label htmlFor="mem" className="mem-label">
          <span>Memory for Minecraft</span>
          <b className="mem-value">{mem} GB</b>
        </label>
        <input
          id="mem"
          className="mem-range"
          type="range"
          min={2}
          max={maxGB}
          step={1}
          value={mem}
          aria-valuetext={`${mem} gigabytes`}
          onChange={(e) => update({ memoryGB: Number(e.target.value) })}
        />
        <span className="mem-note">
          {tight
            ? `That leaves little for the rest of your PC, which has ${totalGB} GB. Most PCs run best with half or less for Minecraft.`
            : `4 GB is plenty for Kairo. More only helps with big modpacks or shader packs. Your PC has ${totalGB} GB.`}
        </span>
      </div>

      <div className="card">
        <div className="setting-text-row">
          <span className="setting-text">
            <span className="setting-name">Use my own Java</span>
            <span className="setting-desc">
              {settings.customJava
                ? 'The launcher uses the Java you choose for every version.'
                : 'Off: the launcher gets the right Java for each Minecraft version from Mojang.'}
            </span>
          </span>
          <Switch checked={settings.customJava} label="Use my own Java" onChange={(customJava) => update({ customJava })} />
        </div>
        {settings.customJava && (
          <label className="java-path">
            <span className="field-label">Path to Java</span>
            <span className="java-path-row">
              <input
                className="text-input"
                type="text"
                spellCheck={false}
                value={settings.javaPath}
                placeholder={javaPlaceholder}
                onChange={(e) => update({ javaPath: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  void window.kairo.settings.pickJava().then((path) => {
                    if (path) update({ javaPath: path })
                  })
                }
              >
                Browse…
              </button>
            </span>
          </label>
        )}
      </div>

      <SwitchRow
        label="Start in fullscreen"
        description="Opens Minecraft fullscreen instead of in a window"
        checked={settings.fullscreen}
        onChange={(fullscreen) => update({ fullscreen })}
      />
      <SwitchRow
        label="Hide the launcher while playing"
        description="It comes back when you close the game"
        checked={settings.hideWhilePlaying}
        onChange={(hideWhilePlaying) => update({ hideWhilePlaying })}
      />
      <SwitchRow
        label="Show snapshots"
        description="Lists Mojang's test versions under Vanilla. They can break worlds."
        checked={settings.showSnapshots}
        onChange={(showSnapshots) => update({ showSnapshots })}
      />
    </>
  )
}

function LauncherTab() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  return (
    <>
      <SwitchRow
        label="Match the selected install"
        description="The launcher turns violet when Kairo Void is selected"
        checked={settings.matchTheme}
        onChange={(matchTheme) => update({ matchTheme })}
      />
      <SwitchRow
        label="Update the launcher automatically"
        description="Downloads from GitHub, checked against its checksum"
        checked={settings.autoUpdate}
        onChange={(autoUpdate) => update({ autoUpdate })}
      />
    </>
  )
}

function secureStoreName(platform: string | undefined): string {
  if (platform === 'darwin') return 'the macOS Keychain'
  if (platform === 'linux') return "your desktop's keyring"
  return 'Windows Credential Manager'
}

function AccountTab() {
  const accounts = useStore((s) => s.accounts)
  const account = useStore((s) => s.account)
  const switchAccount = useStore((s) => s.switchAccount)
  const signOut = useStore((s) => s.signOut)
  const addAccount = useStore((s) => s.addAccount)
  const busy = useStore((s) => s.game.phase !== 'idle')
  const info = useStore((s) => s.info)
  const list = accounts?.accounts ?? []

  return (
    <>
      {list.length === 0 && account?.uuid === null && (
        <div className="card account-card">
          <span className="avatar" aria-hidden="true">
            {account.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-text">
            <b className="account-name">{account.name}</b>
            <span className="setting-desc">Offline dev account · only in development builds</span>
          </span>
        </div>
      )}

      <ul className="account-list" aria-label="Minecraft accounts">
        {list.map((a) => {
          const isActive = a.uuid === accounts?.active
          return (
            <li key={a.uuid} className="card account-card" data-active={isActive}>
              <span className="avatar" aria-hidden="true">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-text">
                <b className="account-name">{a.name}</b>
                <span className="setting-desc">{isActive ? 'Plays now · Microsoft account' : 'Microsoft account'}</span>
              </span>
              {!isActive && (
                <button type="button" className="btn-accent account-use" disabled={busy} onClick={() => switchAccount(a.uuid)} aria-label={`Play as ${a.name}`}>
                  Play as {a.name}
                </button>
              )}
              <button type="button" className="btn-ghost" disabled={busy && isActive} onClick={() => signOut(a.uuid)} aria-label={`Sign out ${a.name}`}>
                Sign out
              </button>
            </li>
          )
        })}
      </ul>

      <button type="button" className="btn-ghost account-add" onClick={addAccount}>
        Add another account
      </button>

      <p className="prose">
        You sign in on Microsoft's own page. The launcher never sees your password, and it keeps each account's sign-in
        tokens in your system's secure storage ({secureStoreName(info?.platform)}), not in a file. Signing out deletes them.
      </p>
    </>
  )
}

// Keep this list exactly in step with what the launcher connects to.
function PrivacyTab() {
  return (
    <div className="card list-card">
      <b className="list-card-title">What the launcher talks to</b>
      <ul>
        <li>Microsoft, Xbox and Mojang, to sign you in and download Minecraft and the Java it runs on.</li>
        <li>Fabric, NeoForge and Forge, to download mod loaders from their official servers.</li>
        <li>Modrinth, to download mods and modpacks.</li>
        <li>GitHub, to download Kairo and launcher updates.</li>
        <li>optifine.net, opened in your browser when you install OptiFine.</li>
      </ul>
      <span className="muted">Nothing else. No accounts of its own, no analytics, no telemetry.</span>
    </div>
  )
}

function updateText(u: UpdateState | null): string {
  switch (u?.status) {
    case undefined:
    case 'off':
      return u?.message ?? 'Updates are off in development builds.'
    case 'idle':
      return 'Updates come from the GitHub releases of Mordsome/KairoLauncher.'
    case 'checking':
      return 'Checking for updates…'
    case 'latest':
      return 'You have the newest version.'
    case 'downloading':
      return `Downloading ${u.version ?? 'the update'}: ${Math.round(u.progress * 100)}%`
    case 'verifying':
      return "Checking that the update really comes from Mordsome…"
    case 'ready':
      return `Version ${u.version} is ready. It installs when you restart the launcher.`
    case 'error':
      return u.message ?? "The update couldn't be checked."
  }
}

function UpdateLine() {
  const update = useStore((s) => s.update)
  const busy = update?.status === 'checking' || update?.status === 'downloading' || update?.status === 'verifying'
  const canCheck = update !== null && update.status !== 'off' && update.status !== 'ready' && !busy
  return (
    <div className="update-line">
      <span className="muted" role="status">
        {updateText(update)}
      </span>
      {update?.status !== 'off' && update?.status !== 'ready' && (
        <button type="button" className="btn-ghost btn-small" disabled={!canCheck} onClick={() => void window.kairo.app.update.check()}>
          Check for updates
        </button>
      )}
    </div>
  )
}

function AboutTab() {
  const info = useStore((s) => s.info)
  const open = (url: string) => void window.kairo.app.openExternal(url)
  return (
    <>
      <div className="card list-card">
        <b className="list-card-title">Kairo Launcher {info?.version ?? ''}</b>
        <span className="muted">Made by Mordsome. Free software under the GPL-3.0 licence.</span>
        <span className="muted">Fonts: Outfit and Pixelify Sans, under the SIL Open Font License.</span>
        <UpdateLine />
        <div className="about-links">
          <button type="button" className="btn-ghost" onClick={() => open('https://github.com/Mordsome/KairoLauncher')}>
            Source code
          </button>
          <button type="button" className="btn-ghost" onClick={() => open('https://mordsome.github.io/Kairo')}>
            Kairo website
          </button>
        </div>
      </div>
      <p className="prose">{DISCLAIMER}</p>
    </>
  )
}
