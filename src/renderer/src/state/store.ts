import { create } from 'zustand'
import type { AppInfo } from '../../../shared/api'
import { EDITIONS, KAIRO_VERSION, LOADERS, type EditionId, type Extra, type LoaderId } from '../data/catalog'

export type Screen = 'signin' | 'home' | 'library' | 'settings'
export type HomeView = 'home' | 'pick'
export type SettingsTab = 'game' | 'launcher' | 'account' | 'privacy' | 'about'
export type PlayPhase = 'idle' | 'download' | 'launch' | 'running'
export type Theme = 'kairo' | 'void'

export interface Account {
  name: string
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
}

export interface Selection {
  edition: EditionId
  mc: string
  /** Set when the selection is an existing install. Vanilla gets one on first play. */
  installId: string | null
}

export interface Settings {
  memoryGB: number
  customJava: boolean
  javaPath: string
  fullscreen: boolean
  hideWhilePlaying: boolean
  showSnapshots: boolean
  matchTheme: boolean
  autoUpdate: boolean
  sounds: boolean
}

const HOUR = 60 * 60 * 1000

const kairoMods = (name: string) => [
  { name, version: KAIRO_VERSION },
  { name: 'Fabric Loader', version: '0.17' },
  { name: 'Fabric API', version: '0.165.0' },
  { name: 'Sodium', version: '0.9.2' }
]

const MOCK_INSTALLS: Install[] = [
  { id: 'kairo', name: 'Kairo', edition: 'kairo', mc: '26.3', loader: 'fabric', extras: [], mods: kairoMods('Kairo'), playMinutes: 38 * 60, lastPlayed: Date.now() - 2 * HOUR, keepUpdated: true },
  { id: 'void', name: 'Kairo Void', edition: 'void', mc: '26.3', loader: 'fabric', extras: [], mods: kairoMods('Kairo Void'), playMinutes: 12 * 60, lastPlayed: Date.now() - 26 * HOUR, keepUpdated: true }
]

interface State {
  screen: Screen
  homeView: HomeView
  /** Edition shown on the picker (hovered or focused). */
  pickFocus: EditionId
  settingsTab: SettingsTab
  librarySel: string
  account: Account | null
  installs: Install[]
  selection: Selection
  play: { phase: PlayPhase; progress: number }
  settings: Settings
  info: AppInfo | null

  go(screen: Screen): void
  openPicker(): void
  closePicker(): void
  setPickFocus(edition: EditionId): void
  select(selection: Selection): void
  createOther(loader: LoaderId, mc: string, extras: Extra['name'][]): void
  playOrStop(): void
  signIn(account: Account): void
  signOut(): void
  setSettingsTab(tab: SettingsTab): void
  setLibrarySel(id: string): void
  updateSettings(patch: Partial<Settings>): void
  updateInstall(id: string, patch: Partial<Install>): void
  setInfo(info: AppInfo): void
}

let playTimer: ReturnType<typeof setInterval> | null = null
let launchTimer: ReturnType<typeof setTimeout> | null = null

function stopTimers() {
  if (playTimer) clearInterval(playTimer)
  if (launchTimer) clearTimeout(launchTimer)
  playTimer = null
  launchTimer = null
}

function uniqueName(installs: Install[], base: string): string {
  if (!installs.some((i) => i.name === base)) return base
  let n = 2
  while (installs.some((i) => i.name === `${base} ${n}`)) n++
  return `${base} ${n}`
}

export const useStore = create<State>()((set, get) => ({
  screen: 'signin',
  homeView: 'home',
  pickFocus: 'kairo',
  settingsTab: 'game',
  librarySel: 'kairo',
  account: null,
  installs: MOCK_INSTALLS,
  selection: { edition: 'kairo', mc: '26.3', installId: 'kairo' },
  play: { phase: 'idle', progress: 0 },
  settings: {
    memoryGB: 4,
    customJava: false,
    javaPath: '',
    fullscreen: false,
    hideWhilePlaying: true,
    showSnapshots: false,
    matchTheme: true,
    autoUpdate: true,
    sounds: true
  },
  info: null,

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
    set({ selection: { ...selection, installId }, homeView: 'home', screen: 'home' })
  },

  createOther: (loader, mc, extras) => {
    const L = LOADERS[loader]
    const installs = get().installs
    const install: Install = {
      id: `other-${Date.now().toString(36)}`,
      name: uniqueName(installs, L.name),
      edition: 'other',
      mc,
      loader,
      extras,
      mods: [{ name: `${L.name}${loader === 'optifine' ? '' : ' Loader'}`, version: 'latest' }, ...extras.map((name) => ({ name, version: 'latest' }))],
      playMinutes: 0,
      lastPlayed: null,
      keepUpdated: false
    }
    set({
      installs: [...installs, install],
      selection: { edition: 'other', mc, installId: install.id },
      librarySel: install.id,
      homeView: 'home',
      screen: 'home'
    })
  },

  // Mock play cycle from the design: download, start, run, stop.
  playOrStop: () => {
    const { phase } = get().play
    if (phase === 'running') {
      stopTimers()
      set({ play: { phase: 'idle', progress: 0 } })
      return
    }
    if (phase !== 'idle') return

    const sel = get().selection
    if (sel.edition === 'vanilla' && !sel.installId) {
      const installs = get().installs
      const install: Install = {
        id: `vanilla-${sel.mc}`,
        name: uniqueName(installs, `Minecraft ${sel.mc}`),
        edition: 'vanilla',
        mc: sel.mc,
        extras: [],
        mods: [],
        playMinutes: 0,
        lastPlayed: null,
        keepUpdated: false
      }
      set({ installs: [...installs, install], selection: { ...sel, installId: install.id } })
    }

    set({ play: { phase: 'download', progress: 0 } })
    playTimer = setInterval(() => {
      const progress = Math.min(1, get().play.progress + 0.04 + Math.random() * 0.03)
      if (progress < 1) {
        set({ play: { phase: 'download', progress } })
        return
      }
      stopTimers()
      set({ play: { phase: 'launch', progress: 1 } })
      launchTimer = setTimeout(() => {
        const id = get().selection.installId
        if (id) get().updateInstall(id, { lastPlayed: Date.now() })
        set({ play: { phase: 'running', progress: 0 } })
      }, 1300)
    }, 120)
  },

  signIn: (account) => set({ account, screen: 'home', homeView: 'home' }),
  signOut: () => {
    stopTimers()
    set({ account: null, screen: 'signin', homeView: 'home', play: { phase: 'idle', progress: 0 } })
  },
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setLibrarySel: (librarySel) => set({ librarySel }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  updateInstall: (id, patch) => set((s) => ({ installs: s.installs.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  setInfo: (info) => set({ info })
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
  return { title: install?.name ?? loaderName, mc: selection.mc, blurb: `${loaderName} for Minecraft ${selection.mc}${withExtras}` }
}
