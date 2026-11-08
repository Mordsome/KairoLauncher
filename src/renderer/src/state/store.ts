import { create } from 'zustand'
import type { AccountsState, AppInfo, BackgroundFiles, LauncherSettings, UpdateState, CustomInstallInfo, GameState, KairoEdition, KairoStatus, PlayTarget, VersionList } from '../../../shared/api'
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
}

export interface Selection {
  edition: EditionId
  mc: string
  /** Set when the selection is an existing install. Vanilla gets one on first play. */
  installId: string | null
}

export type Settings = Omit<LauncherSettings, 'lastSelection'>

// Kairo and Kairo Void are always listed; their details come from the main
// process (kairo status). Vanilla and Other entries are kept here until Phase 6.
const KAIRO_INSTALLS: Install[] = [
  { id: 'kairo', name: 'Kairo', edition: 'kairo', mc: '26.3', loader: 'fabric', extras: [], mods: [], playMinutes: 0, lastPlayed: null, keepUpdated: true, installed: false },
  { id: 'void', name: 'Kairo Void', edition: 'void', mc: '26.3', loader: 'fabric', extras: [], mods: [], playMinutes: 0, lastPlayed: null, keepUpdated: true, installed: false }
]

export const IDLE_GAME: GameState = { phase: 'idle', progress: 0, detail: '', error: null, crash: null }

interface State {
  screen: Screen
  homeView: HomeView
  /** Edition shown on the picker (hovered or focused). */
  pickFocus: EditionId
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
  /** Kairo releases and the two Kairo installs, from the main process. */
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
  setPickFocus(edition: EditionId): void
  select(selection: Selection): void
  /** A new install from Other or a modpack: list it, select it, go Home. */
  customCreated(install: CustomInstallInfo): void
  refreshCustom(): Promise<void>
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
  setKeepUpdated(edition: KairoEdition, on: boolean): void
}

const EXTRA_NAME: Record<string, Extra['name']> = { sodium: 'Sodium', iris: 'Iris', lithium: 'Lithium' }

function fromCustom(c: CustomInstallInfo): Install {
  return {
    id: c.id,
    name: c.name,
    edition: c.loader === 'vanilla' ? 'vanilla' : 'other',
    mc: c.mc,
    ...(c.loader !== 'vanilla' ? { loader: c.loader } : {}),
    extras: c.extras.map((x) => EXTRA_NAME[x]).filter((x): x is Extra['name'] => !!x),
    mods: c.mods,
    playMinutes: c.playMinutes,
    lastPlayed: c.lastPlayed,
    keepUpdated: false,
    installed: c.installed,
    ...(c.modpack ? { modpack: c.modpack.name } : {})
  }
}

function playTarget(selection: Selection): PlayTarget {
  // A specific vanilla install (chosen in the Library) plays that one; otherwise the version's own install.
  if (selection.edition === 'vanilla') return selection.installId ? { kind: 'custom', id: selection.installId } : { kind: 'vanilla', mc: selection.mc }
  if (selection.edition === 'other') return { kind: 'custom', id: selection.installId ?? '' }
  return { kind: 'kairo', edition: selection.edition === 'void' ? 'void' : 'kairo' }
}

function applyKairo(installs: Install[], status: KairoStatus): Install[] {
  return installs.map((i) => {
    if (i.edition !== 'kairo' && i.edition !== 'void') return i
    const s = status.installs[i.edition]
    return {
      ...i,
      mc: s.mc ?? i.mc,
      mods: s.mods,
      playMinutes: s.playMinutes,
      lastPlayed: s.lastPlayed,
      keepUpdated: s.keepUpdated,
      installed: s.kairoVersion !== null
    }
  })
}

function uniqueName(installs: Install[], base: string): string {
  if (!installs.some((i) => i.name === base)) return base
  let n = 2
  while (installs.some((i) => i.name === `${base} ${n}`)) n++
  return `${base} ${n}`
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
  pickFocus: 'kairo',
  settingsTab: 'game',
  librarySel: 'kairo',
  account: null,
  accounts: null,
  signInMode: 'first',
  installs: KAIRO_INSTALLS,
  selection: { edition: 'kairo', mc: '26.3', installId: 'kairo' },
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
    reduceMotion: false
  },
  info: null,
  update: null,
  bgFiles: null,
  bgProblem: null,
  settingsLoaded: false,

  go: (screen) => set({ screen, homeView: 'home' }),
  openPicker: () => set((s) => ({ screen: 'home', homeView: 'pick', pickFocus: s.selection.edition })),
  closePicker: () => set({ homeView: 'home' }),
  setPickFocus: (pickFocus) => {
    if (get().pickFocus !== pickFocus) set({ pickFocus })
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
      selection: { edition: 'other', mc: install.mc, installId: install.id },
      librarySel: install.id,
      homeView: 'home',
      screen: 'home',
      notice: null
    }))
    saveSoon(get)
  },

  refreshCustom: async () => {
    try {
      const list = await window.kairo.installs.list()
      set((st) => {
        const installs = [...st.installs.filter((i) => i.edition !== 'other' && i.edition !== 'vanilla'), ...list.map(fromCustom)]
        // A selected install that no longer exists (deleted) falls back to Kairo.
        const sel = st.selection
        const gone = (sel.edition === 'other' || sel.edition === 'vanilla') && sel.installId && !installs.some((i) => i.id === sel.installId)
        const selection = gone
          ? sel.edition === 'vanilla'
            ? { ...sel, installId: null }
            : { edition: 'kairo' as const, mc: installs.find((i) => i.id === 'kairo')?.mc ?? '26.3', installId: 'kairo' }
          : sel
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

    // Lite isn't out yet; an Other selection must point at a real install.
    if (selection.edition === 'lite') return
    if (selection.edition === 'other' && !selection.installId) {
      set({ notice: 'Create the install first.\nPick Other in the picker and choose a loader.' })
      return
    }

    // Kairo Void's visuals can flash: warn once, before it's first installed.
    const voidInstall = get().installs.find((i) => i.id === 'void')
    if (selection.edition === 'void' && !settings.voidWarningSeen && !voidInstall?.installed) {
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
      set((s) => {
        const installs = applyKairo(s.installs, status)
        const sel = s.selection
        const current = installs.find((i) => i.id === sel.installId)
        // Kairo's Minecraft version follows its installed release.
        const selection = current && (sel.edition === 'kairo' || sel.edition === 'void') ? { ...sel, mc: current.mc } : sel
        return { kairo: status, installs, selection }
      })
    } catch {
      // keep what we have
    }
  },

  setKeepUpdated: (edition, on) => {
    get().updateInstall(edition, { keepUpdated: on })
    void window.kairo.kairo.setKeepUpdated(edition, on).then(
      (status) => set((s) => ({ kairo: status, installs: applyKairo(s.installs, status) })),
      () => get().updateInstall(edition, { keepUpdated: !on })
    )
  }
}))

/** The edition whose look the launcher shows right now. */
export function lookEdition(s: Pick<State, 'screen' | 'homeView' | 'pickFocus' | 'selection'>): EditionId {
  return s.screen === 'home' && s.homeView === 'pick' ? s.pickFocus : s.selection.edition
}

export function selectTheme(s: State): Theme {
  if (s.screen === 'signin' || !s.settings.matchTheme) return 'kairo'
  return lookEdition(s) === 'void' ? 'void' : 'kairo'
}

export interface SelectionView {
  title: string
  mc: string
  blurb: string
}

export function describeSelection(selection: Selection, installs: Install[]): SelectionView {
  if (selection.edition !== 'other') {
    const e = EDITIONS[selection.edition]
    return { title: e.title, mc: selection.mc, blurb: e.blurb }
  }
  const install = installs.find((i) => i.id === selection.installId)
  const loaderName = install?.loader ? LOADERS[install.loader].name : 'Custom'
  const extras = install?.extras ?? []
  const withExtras = extras.length ? `, with ${extras.join(' and ')}.` : ', no extra mods.'
  if (install?.modpack) return { title: install.modpack, mc: selection.mc, blurb: `A ${loaderName} modpack for Minecraft ${selection.mc}.` }
  return { title: loaderName, mc: selection.mc, blurb: `${loaderName} for Minecraft ${selection.mc}${withExtras}` }
}
