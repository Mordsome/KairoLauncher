import { create } from 'zustand'
import type { AccountsState, AppInfo, BackgroundFiles, LauncherSettings, UpdateState, CustomInstallInfo, GameState, InstallLook, KairoStatus, PlayTarget, VersionList } from '../../../shared/api'
import { KAIRO_LOOK, VOID_LOOK } from './look'
import { EDITIONS, LOADERS, type EditionId, type Extra, type LoaderId } from '../data/catalog'

export type Screen = 'signin' | 'home' | 'library' | 'settings'
export type HomeView = 'home' | 'pick'
export type SettingsTab = 'game' | 'launcher' | 'account' | 'privacy' | 'about'
export type Theme = 'kairo' | 'void'

export interface Account {
  name: string
  /** Null for the dev offline account. */
  uuid: string | null
}

export interface Install {
  id: string
  name: string
  edition: EditionId
  mc: string
  loader?: LoaderId
  extras: Extra['name'][]
  mods: { name: string; version: string }[]
  playMinutes: number
  lastPlayed: number | null
  keepUpdated: boolean
  /** False until the first Play has downloaded it. */
  installed: boolean
  /** Modpack name, for installs imported from one. */
  modpack?: string
  /** Kairo installs: the Kairo version once played. */
  kairoVersion?: string | null
  /** The player's own look; null for the default. */
  look: InstallLook | null
}

export interface Selection {
  edition: EditionId
  mc: string
  /** Set when the selection is an existing install. Vanilla gets one on first play. */
  installId: string | null
}

export type Settings = Omit<LauncherSettings, 'lastSelection'>


export const IDLE_GAME: GameState = { phase: 'idle', progress: 0, detail: '', error: null, crash: null }

interface State {
  screen: Screen
  homeView: HomeView
  /** Install shown on the picker (hovered or focused). */
  pickFocus: string | null
  /** A look being tried in the Appearance dialog, shown until it closes. */
  lookPreview: InstallLook | null
  setLookPreview(look: InstallLook | null): void
  /** Saves an install's look (null: back to the default). */
  setInstallLook(id: string, look: InstallLook | null): Promise<boolean>
  settingsTab: SettingsTab
  librarySel: string
  /** The account that plays: the active Microsoft account, or the dev offline one. */
  account: Account | null
  /** Signed-in Microsoft accounts; null until loaded. */
  accounts: AccountsState | null
  /** 'add' when the sign-in screen was opened to add another account. */
  signInMode: 'first' | 'add'
  installs: Install[]
  selection: Selection
  /** Live state of the game, from the main process. */
  game: GameState
  /** A one-off message for the Home status line. */
  notice: string | null
  /** Showing the photosensitivity warning before the first Kairo Void install. */
  voidWarning: boolean
  acceptVoidWarning(): void
  closeVoidWarning(): void
  /** Mojang's version list; null until loaded (or if offline with no saved copy). */
  versions: VersionList | null
  /** The latest Kairo release (and its patch notes), from the main process. */
  kairo: KairoStatus | null
  settings: Settings
  info: AppInfo | null
  /** The launcher's own update, from GitHub. */
  update: UpdateState | null
  setUpdate(update: UpdateState): void
  /** The player's stored background pictures (never paths). */
  bgFiles: BackgroundFiles | null
  /** Set when the custom picture couldn't be shown; the Pixel field shows instead. */
  bgProblem: string | null
  setBgFiles(files: BackgroundFiles): void
  setBgProblem(problem: string | null): void

  go(screen: Screen): void
  openPicker(): void
  closePicker(): void
  setPickFocus(id: string | null): void
  select(selection: Selection): void
  /** A new install from Other or a modpack: list it, select it, go Home. */
  customCreated(install: CustomInstallInfo): void
  refreshCustom(): Promise<void>
  /** Opens the Library with the Mods dialog of this install (right after making it). */
  openModsFor(id: string): void
  /** Install whose Mods dialog the Library should open; cleared once opened. */
  modsFor: string | null
  playOrStop(): void
  setAccounts(state: AccountsState): void
  useDevOffline(name: string): void
  addAccount(): void
  switchAccount(uuid: string): void
  signOut(uuid: string): void
  setSettingsTab(tab: SettingsTab): void
  setLibrarySel(id: string): void
  updateSettings(patch: Partial<Settings>): void
  /** Loads saved settings and the last selection (once, at start). */
  loadSettings(): Promise<void>
  /** True once saved settings are loaded, so nothing is saved over them before that. */
  settingsLoaded: boolean
  updateInstall(id: string, patch: Partial<Install>): void
  setInfo(info: AppInfo): void
  setGame(game: GameState): void
  refreshVersions(): Promise<void>
  refreshKairo(): Promise<void>
  setKeepUpdated(installId: string, on: boolean): void
}

const EXTRA_NAME: Record<string, Extra['name']> = { sodium: 'Sodium', iris: 'Iris', lithium: 'Lithium' }

function fromCustom(c: CustomInstallInfo): Install {
  return {
    id: c.id,
    name: c.name,
    edition: c.kairo ? c.kairo.edition : c.loader === 'vanilla' ? 'vanilla' : 'other',
    mc: c.mc,
    ...(c.loader !== 'vanilla' ? { loader: c.loader } : {}),
    ...(c.kairo ? { kairoVersion: c.kairo.version } : {}),
    extras: c.extras.map((x) => EXTRA_NAME[x]).filter((x): x is Extra['name'] => !!x),
    mods: c.mods,
    playMinutes: c.playMinutes,
    lastPlayed: c.lastPlayed,
    keepUpdated: c.kairo?.keepUpdated ?? false,
    installed: c.installed,
    look: c.look,
    ...(c.modpack ? { modpack: c.modpack.name } : {})
  }
}

function playTarget(selection: Selection): PlayTarget {
  return selection.installId ? { kind: 'custom', id: selection.installId } : { kind: 'vanilla', mc: selection.mc }
}

/** What Home shows when nothing (or something deleted) is selected: a Kairo install, else the first one. */
function fallbackSelection(installs: Install[]): Selection | null {
  const pick = installs.find((i) => i.edition === 'kairo') ?? installs[0]
  return pick ? { edition: pick.edition, mc: pick.mc, installId: pick.id } : null
}

export function selectionFor(install: Install): Selection {
  return { edition: install.edition, mc: install.mc, installId: install.id }
}


/** Largest memory setting the main process accepts on this PC. */
export function maxMemoryGB(info: AppInfo | null): number {
  const whole = info ? Math.floor(info.totalMemoryMB / 1024) : 16
  return Math.max(2, Math.min(32, whole))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Saves settings and the selection shortly after the last change. */
function saveSoon(get: () => State): void {
  if (!get().settingsLoaded) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { settings, selection } = get()
    void window.kairo.settings.set({ ...settings, lastSelection: selection }).catch(() => undefined)
  }, 300)
}

export const useStore = create<State>()((set, get) => ({
  screen: 'signin',
  homeView: 'home',
  pickFocus: null,
  lookPreview: null,
  settingsTab: 'game',
  librarySel: '',
  modsFor: null,
  account: null,
  accounts: null,
  signInMode: 'first',
  installs: [],
  selection: { edition: 'kairo', mc: '26.3', installId: null },
  game: IDLE_GAME,
  notice: null,
  voidWarning: false,
  versions: null,
  kairo: null,
  settings: {
    memoryGB: 4,
    customJava: false,
    javaPath: '',
    fullscreen: false,
    hideWhilePlaying: true,
    showSnapshots: false,
    matchTheme: true,
    autoUpdate: true,
    voidWarningSeen: false,
    background: {
      kind: 'pixels',
      trailSize: 50,
      trailStrength: 'normal',
      hoverWaves: true,
      clickRipple: true,
      fit: 'fill',
      dim: 35,
      blur: 0,
      pixelsOnTop: true,
      separateVoid: false
    },
    showPatchNotes: true,
    sharedMinecraft: false,
    reduceMotion: false
  },
  info: null,
  update: null,
  bgFiles: null,
  bgProblem: null,
  settingsLoaded: false,

  go: (screen) => set({ screen, homeView: 'home' }),
  openPicker: () => set((s) => ({ screen: 'home', homeView: 'pick', pickFocus: s.selection.installId })),
  closePicker: () => set({ homeView: 'home' }),
  setPickFocus: (pickFocus) => {
    if (get().pickFocus !== pickFocus) set({ pickFocus })
  },

  setLookPreview: (lookPreview) => set({ lookPreview }),
  setInstallLook: async (id, look) => {
    const r = await window.kairo.installs.setLook(id, look).catch(() => null)
    if (!r?.ok) return false
    get().updateInstall(id, { look: r.install.look })
    return true
  },

  select: (selection) => {
    let installId = selection.installId
    if (!installId && selection.edition === 'vanilla') {
      installId = get().installs.find((i) => i.edition === 'vanilla' && i.mc === selection.mc)?.id ?? null
    }
    set({ selection: { ...selection, installId }, homeView: 'home', screen: 'home', notice: null })
    saveSoon(get)
  },

  customCreated: (install) => {
    set((st) => ({
      installs: [...st.installs.filter((i) => i.id !== install.id), fromCustom(install)],
      selection: selectionFor(fromCustom(install)),
      librarySel: install.id,
      homeView: 'home',
      screen: 'home',
      notice: null
    }))
    saveSoon(get)
  },

  openModsFor: (id) => set({ screen: 'library', homeView: 'home', librarySel: id, modsFor: id }),

  refreshCustom: async () => {
    try {
      const list = await window.kairo.installs.list()
      set((st) => {
        const installs = list.map(fromCustom)
        // Nothing selected yet, or the selected install was deleted: a Kairo install, else the first one.
        const current = installs.find((i) => i.id === st.selection.installId)
        const selection = current ? selectionFor(current) : (fallbackSelection(installs) ?? st.selection)
        return { installs, selection }
      })
    } catch {
      // keep what we have
    }
  },

  playOrStop: () => {
    const { game, selection, settings, info } = get()
    if (game.phase === 'running' || game.phase === 'download') {
      void window.kairo.game.stop()
      return
    }
    if (game.phase !== 'idle') return

    // Lite isn't out yet; anything else must be a real install.
    if (selection.edition === 'lite') return
    const chosen = get().installs.find((i) => i.id === selection.installId)
    if (!chosen) {
      set({ notice: 'Choose what to play first.\nMake an install with New install in the picker or the Library.' })
      return
    }

    // Kairo Void's visuals can flash: warn once, before it's first installed.
    if (chosen.edition === 'void' && !settings.voidWarningSeen && !chosen.installed) {
      set({ voidWarning: true, notice: null })
      return
    }

    const javaPath = settings.customJava && settings.javaPath.trim() ? settings.javaPath.trim() : null
    set({ notice: null })
    window.kairo.game
      .play({
        target: playTarget(selection),
        memoryGB: Math.min(settings.memoryGB, maxMemoryGB(info)),
        javaPath,
        fullscreen: settings.fullscreen,
        hideWhilePlaying: settings.hideWhilePlaying
      })
      .catch(() => set({ notice: "The launcher couldn't start that.\nCheck the Java path and memory in Settings." }))
  },

  acceptVoidWarning: () => {
    set({ voidWarning: false })
    get().updateSettings({ voidWarningSeen: true })
    get().playOrStop()
  },

  closeVoidWarning: () => set({ voidWarning: false }),

  setAccounts: (accounts) => {
    const active = accounts.accounts.find((a) => a.uuid === accounts.active) ?? null
    set((s) => ({
      accounts,
      // Keep the dev offline account if that's what is being used and nobody signed in.
      account: active ? { name: active.name, uuid: active.uuid } : s.account?.uuid === null ? s.account : null
    }))
  },
  useDevOffline: (name) => set({ account: { name, uuid: null }, screen: 'home', homeView: 'home' }),
  addAccount: () => set({ signInMode: 'add', screen: 'signin' }),
  switchAccount: (uuid) => {
    void window.kairo.auth.switchTo(uuid).then((state) => get().setAccounts(state))
  },
  signOut: (uuid) => {
    const active = get().accounts?.active === uuid
    if (active) void window.kairo.game.stop()
    void window.kairo.auth.signOut(uuid).then((state) => {
      get().setAccounts(state)
      if (state.accounts.length === 0 && get().account === null) set({ screen: 'signin', signInMode: 'first', homeView: 'home' })
    })
  },
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setLibrarySel: (librarySel) => set({ librarySel }),
  updateSettings: (patch) => {
    set((st) => ({ settings: { ...st.settings, ...patch } }))
    saveSoon(get)
  },

  loadSettings: async () => {
    try {
      const saved = await window.kairo.settings.get()
      const { lastSelection, ...settings } = saved
      set({ settings, settingsLoaded: true })
      if (lastSelection && lastSelection.edition !== 'lite') {
        const { installs } = get()
        const exists = lastSelection.installId === null || installs.some((i) => i.id === lastSelection.installId)
        if (exists) set({ selection: lastSelection })
      }
    } catch {
      set({ settingsLoaded: true })
    }
  },
  updateInstall: (id, patch) => set((s) => ({ installs: s.installs.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  setInfo: (info) => set({ info }),
  setUpdate: (update) => set({ update }),
  // A new picture gets a fresh chance to load.
  setBgFiles: (bgFiles) => set({ bgFiles, bgProblem: null }),
  setBgProblem: (bgProblem) => set({ bgProblem }),

  setGame: (game) => {
    const before = get().game.phase
    set({ game })
    if (game.phase === 'running' && before !== 'running') {
      const id = get().selection.installId
      if (id) get().updateInstall(id, { lastPlayed: Date.now() })
    }
    // A finished download changes which versions are "Ready" and what's installed.
    if (game.phase !== 'download' && before === 'download') {
      void get().refreshVersions()
      void get().refreshKairo()
    }
    // Play time and last played are saved when the game closes.
    if (game.phase === 'idle' && before === 'running') {
      void get().refreshKairo()
      void get().refreshCustom()
    }
    if (game.phase !== 'download' && before === 'download') void get().refreshCustom()
  },

  refreshVersions: async () => {
    try {
      set({ versions: await window.kairo.game.versions() })
    } catch {
      // Offline and nothing saved yet: the picker keeps its built-in list.
    }
  },

  refreshKairo: async () => {
    try {
      const status = await window.kairo.kairo.status()
      set({ kairo: status })
    } catch {
      // keep what we have
    }
  },

  setKeepUpdated: (installId, on) => {
    get().updateInstall(installId, { keepUpdated: on })
    void window.kairo.kairo.setKeepUpdated(installId, on).then(
      (r) => {
        if (!r.ok) get().updateInstall(installId, { keepUpdated: !on })
      },
      () => get().updateInstall(installId, { keepUpdated: !on })
    )
  }
}))

/** The install whose look the launcher shows right now: the one hovered on the picker, else the one selected. */
function lookInstall(s: State): Install | undefined {
  if (s.screen === 'signin' || !s.settings.matchTheme) return undefined
  const id = s.screen === 'home' && s.homeView === 'pick' && s.pickFocus ? s.pickFocus : s.selection.installId
  return s.installs.find((i) => i.id === id)
}

/** An install's look: its own, or the default (Void for Kairo Void, Kairo otherwise). */
export function installLook(i: Pick<Install, 'look' | 'edition'>): InstallLook {
  return i.look ?? (i.edition === 'void' ? VOID_LOOK : KAIRO_LOOK)
}

/** The look on screen now. Always the same object for the same look, so it's safe as a selector. */
export function selectLook(s: State): InstallLook {
  if (s.lookPreview) return s.lookPreview
  const install = lookInstall(s)
  return install ? installLook(install) : KAIRO_LOOK
}

/** Void's extras (stars in the Pixel field, the separate Void picture) follow Kairo Void installs. */
export function selectTheme(s: State): Theme {
  if (s.screen === 'signin' || !s.settings.matchTheme) return 'kairo'
  const install = lookInstall(s)
  return (install ? install.edition : s.selection.edition) === 'void' ? 'void' : 'kairo'
}

export interface SelectionView {
  title: string
  mc: string
  blurb: string
}

export function describeSelection(selection: Selection, installs: Install[]): SelectionView {
  const install = installs.find((i) => i.id === selection.installId)
  if (selection.edition !== 'other') {
    const e = EDITIONS[selection.edition]
    return { title: install?.name ?? e.title, mc: install?.mc ?? selection.mc, blurb: e.blurb }
  }
  const loaderName = install?.loader ? LOADERS[install.loader].name : 'Custom'
  const extras = install?.extras ?? []
  const withExtras = extras.length ? `, with ${extras.join(' and ')}.` : ', no extra mods.'
  if (install?.modpack) return { title: install.name, mc: selection.mc, blurb: `A ${loaderName} modpack for Minecraft ${selection.mc}.` }
  return { title: install?.name ?? loaderName, mc: selection.mc, blurb: `${loaderName} for Minecraft ${selection.mc}${withExtras}` }
}
