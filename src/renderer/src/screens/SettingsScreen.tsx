import { useState } from 'react'
import type { HomeLayout, UpdateState } from '../../../shared/api'
import { Avatar } from '../components/Avatar'
import { Menu } from '../components/Menu'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { Switch, SwitchRow } from '../components/Switch'
import { BackgroundSection } from './BackgroundSettings'
import { GameFolderCard } from './GameFolderCard'
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

      <GameFolderCard />

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
      <HomeLayoutPicker value={settings.homeLayout} onChange={(homeLayout) => update({ homeLayout })} />
      <BackgroundSection />
      <SwitchRow
        label="Show Kairo patch notes on Home"
        description="What's new in the latest Kairo release, from its GitHub page"
        checked={settings.showPatchNotes}
        onChange={(showPatchNotes) => update({ showPatchNotes })}
      />
      <SwitchRow
        label="Match the selected install"
        description="The launcher takes the look of the selected install: its colour and corners"
        checked={settings.matchTheme}
        onChange={(matchTheme) => update({ matchTheme })}
      />
      <SwitchRow
        label="Update the launcher automatically"
        description="Downloads from GitHub, checked against its checksum and Mordsome's signature"
        checked={settings.autoUpdate}
        onChange={(autoUpdate) => update({ autoUpdate })}
      />
    </>
  )
}

const LAYOUTS: { id: HomeLayout; name: string; desc: string }[] = [
  { id: 'classic', name: 'Classic', desc: 'Big title on the left, Play below it' },
  { id: 'centre', name: 'Centred', desc: 'Everything in the middle' },
  { id: 'panel', name: 'Side panel', desc: 'A panel on the right, the background free' },
  { id: 'compact', name: 'Bottom bar', desc: 'One slim bar along the bottom' }
]

/** How Home is laid out, each with a small drawing of it. */
function HomeLayoutPicker({ value, onChange }: { value: HomeLayout; onChange(layout: HomeLayout): void }) {
  return (
    <div className="card">
      <span className="setting-name" id="home-layout-label">
        Home layout
      </span>
      <div
        role="radiogroup"
        aria-labelledby="home-layout-label"
        className="layouts"
        data-roving
        onKeyDown={(e) => rovingKeyDown(e, { select: true })}
      >
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            className="layout-tile"
            aria-checked={value === l.id}
            aria-label={l.name}
            aria-describedby={`layout-${l.id}-desc`}
            tabIndex={rovingTabIndex(value === l.id)}
            onClick={() => onChange(l.id)}
          >
            <span className="layout-mini" data-layout={l.id} aria-hidden="true">
              <i className="lm-title" />
              <i className="lm-text" />
              <i className="lm-play" />
            </span>
            <b>{l.name}</b>
            <span id={`layout-${l.id}-desc`} className="layout-desc">
              {l.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
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
  const askSignOut = useStore((s) => s.askSignOut)
  const addAccount = useStore((s) => s.addAccount)
  const busy = useStore((s) => s.game.phase !== 'idle')
  const info = useStore((s) => s.info)
  const list = accounts?.accounts ?? []
  const active = list.find((a) => a.uuid === accounts?.active)
  const others = list.filter((a) => a !== active)
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)

  return (
    <>
      {list.length === 0 && account?.uuid === null && (
        <div className="card account-hero">
          <Avatar uuid={null} name={account.name} skin={false} className="avatar-hero" />
          <span className="account-text">
            <span className="account-kicker">Playing now</span>
            <b className="account-name">{account.name}</b>
            <span className="setting-desc">Offline dev account · only in development builds</span>
          </span>
        </div>
      )}

      {active && (
        <div className="card account-hero" data-active="true">
          <Avatar uuid={active.uuid} name={active.name} skin={active.skin} className="avatar-hero" />
          <span className="account-text">
            <span className="account-kicker">Playing now</span>
            <b className="account-name">{active.name}</b>
            <span className="setting-desc">Microsoft account</span>
          </span>
          <span className="account-actions">
            <PictureButton uuid={active.uuid} name={active.name} onProblem={setProblem} />
            <button type="button" className="btn-ghost" onClick={() => askSignOut(active.uuid)} aria-label={`Sign out of ${active.name}`}>
              Sign out
            </button>
          </span>
        </div>
      )}
      {problem && (
        <p className="detail-error" role="alert">
          <b>{problem.title}.</b> {problem.message}
        </p>
      )}

      {others.length > 0 && (
        <>
          <span className="field-label account-others">Other accounts</span>
          <ul className="account-list" aria-label="Other Minecraft accounts">
            {others.map((a) => (
              <li key={a.uuid} className="card account-card">
                <Avatar uuid={a.uuid} name={a.name} skin={a.skin} className="avatar-row" />
                <span className="account-text">
                  <b className="account-row-name">{a.name}</b>
                  <span className="setting-desc">Microsoft account</span>
                </span>
                <button
                  type="button"
                  className="btn-accent account-use"
                  disabled={busy}
                  title={busy ? 'Close the game to switch' : undefined}
                  onClick={() => switchAccount(a.uuid)}
                  aria-label={`Play as ${a.name}`}
                >
                  Play as {a.name}
                </button>
                <AccountMore uuid={a.uuid} name={a.name} onProblem={setProblem} />
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="btn-ghost account-add" onClick={addAccount}>
        Add another account
      </button>

      <p className="prose">
        You sign in on Microsoft's own page. The launcher never sees your password, and it keeps each account's sign-in
        tokens in your system's secure storage ({secureStoreName(info?.platform)}), not in a file. Signing out deletes them.
        Account pictures are the head of the skin you wear (from Mojang), or a picture you choose, kept on this PC only.
      </p>
    </>
  )
}

type OnProblem = (p: { title: string; message: string } | null) => void

/** Choose a picture for an account, or go back to its skin head. */
function usePicture(uuid: string, onProblem: OnProblem) {
  const own = useStore((s) => !!s.bgFiles?.accounts[uuid])
  const setBgFiles = useStore((s) => s.setBgFiles)
  const slot = `account:${uuid}` as const
  const choose = async () => {
    const r = await window.kairo.background.pick(slot)
    if (r.ok) {
      setBgFiles(r.files)
      onProblem(null)
    } else if (!r.cancelled) onProblem(r.error)
  }
  const reset = async () => {
    setBgFiles(await window.kairo.background.remove(slot))
    onProblem(null)
  }
  return { own, choose, reset }
}

function PictureButton({ uuid, name, onProblem }: { uuid: string; name: string; onProblem: OnProblem }) {
  const { own, choose, reset } = usePicture(uuid, onProblem)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={`Change the picture for ${name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.left, y: r.bottom + 6 })
        }}
      >
        Change picture
      </button>
      {at && (
        <Menu
          label={`Picture for ${name}`}
          at={at}
          onClose={() => setAt(null)}
          items={[
            { label: 'Choose a picture…', hint: 'PNG, JPG, WebP or GIF', onSelect: () => void choose() },
            { label: 'Use my skin', hint: 'The head of the skin you wear', disabled: !own, onSelect: () => void reset() }
          ]}
        />
      )}
    </>
  )
}

function AccountMore({ uuid, name, onProblem }: { uuid: string; name: string; onProblem: OnProblem }) {
  const { own, choose, reset } = usePicture(uuid, onProblem)
  const askSignOut = useStore((s) => s.askSignOut)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        className="detail-dots"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={`More for ${name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.right - 200, y: r.bottom + 6 })
        }}
      >
        ⋯
      </button>
      {at && (
        <Menu
          label={`More for ${name}`}
          at={at}
          onClose={() => setAt(null)}
          items={[
            { label: 'Choose a picture…', onSelect: () => void choose() },
            { label: 'Use my skin', disabled: !own, onSelect: () => void reset() },
            { label: 'Sign out…', danger: true, separated: true, onSelect: () => askSignOut(uuid) }
          ]}
        />
      )}
    </>
  )
}

// Keep this list exactly in step with what the launcher connects to.
function PrivacyTab() {
  return (
    <div className="card list-card">
      <b className="list-card-title">What the launcher talks to</b>
      <ul>
        <li>Microsoft, Xbox and Mojang, to sign you in, download Minecraft and the Java it runs on, and show your skin's head as your account picture.</li>
        <li>Fabric, NeoForge and Forge, to download mod loaders from their official servers.</li>
        <li>Modrinth, to find and download mods and modpacks.</li>
        <li>GitHub, for Kairo, its patch notes and launcher updates.</li>
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
