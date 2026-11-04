// Phase 1 mock data. Later phases replace these lists with live data:
// Kairo releases from GitHub, Minecraft versions from Mojang's manifest,
// loader versions from each loader's official meta, extras from Modrinth.

export type EditionId = 'kairo' | 'void' | 'lite' | 'vanilla' | 'other'
export type LoaderId = 'fabric' | 'neoforge' | 'forge' | 'optifine'

export const EDITION_ORDER: EditionId[] = ['kairo', 'void', 'lite', 'vanilla', 'other']

export interface VersionOption {
  mc: string
  sub: string
  /** Shown when the version can't be played yet. */
  unavailable?: 'Coming soon' | 'Planned' | 'Later'
}

export interface Edition {
  id: EditionId
  /** Short name in the picker. */
  name: string
  /** Big title on Home. */
  title: string
  blurb: string
  versions: VersionOption[]
}

export const KAIRO_VERSION = '0.2.0'

export const EDITIONS: Record<EditionId, Edition> = {
  kairo: {
    id: 'kairo',
    name: 'Kairo',
    title: 'Kairo',
    blurb: 'Frosted glass menus, a HUD you drag into place, PvP mode, cosmetics and emotes.',
    versions: [
      { mc: '26.3', sub: `Kairo ${KAIRO_VERSION} · latest` },
      { mc: '1.21.x', sub: 'For servers still on 1.21', unavailable: 'Later' }
    ]
  },
  void: {
    id: 'void',
    name: 'Void',
    title: 'Kairo Void',
    blurb: 'Kairo turned all the way up: energy blades, nine atmospheres and a cosmic night sky.',
    versions: [{ mc: '26.3', sub: `Kairo Void ${KAIRO_VERSION} · latest` }]
  },
  lite: {
    id: 'lite',
    name: 'Lite',
    title: 'Kairo Lite',
    blurb: 'Kairo for the older versions people still love: light, fast, and made for PvP.',
    versions: [
      { mc: '1.8.9', sub: 'Classic PvP', unavailable: 'Coming soon' },
      { mc: '1.12.2', sub: 'World of Color', unavailable: 'Planned' }
    ]
  },
  vanilla: {
    id: 'vanilla',
    name: 'Vanilla',
    title: 'Minecraft',
    blurb: 'Plain Minecraft, no mods. Downloaded from Mojang the first time you play it.',
    versions: [
      { mc: '26.3', sub: 'Latest release' },
      { mc: '1.20.1', sub: 'Trails & Tales' },
      { mc: '1.16.5', sub: 'Nether Update' },
      { mc: '1.12.2', sub: 'World of Color' },
      { mc: '1.8.9', sub: 'Bountiful Update' }
    ]
  },
  other: {
    id: 'other',
    name: 'Other',
    title: 'Other',
    blurb: 'Build your own install: pick a loader and a version, and add the performance mods you want.',
    versions: []
  }
}

/** Every release from 1.8 up, newest first (snapshot of Mojang's manifest). */
export const RELEASES: string[] = (
  '26.3,26.2,26.1.2,26.1.1,26.1,1.21.11,1.21.10,1.21.9,1.21.8,1.21.7,1.21.6,1.21.5,1.21.4,1.21.3,1.21.2,' +
  '1.21.1,1.21,1.20.6,1.20.5,1.20.4,1.20.3,1.20.2,1.20.1,1.20,1.19.4,1.19.3,1.19.2,1.19.1,1.19,1.18.2,1.18.1,' +
  '1.18,1.17.1,1.17,1.16.5,1.16.4,1.16.3,1.16.2,1.16.1,1.16,1.15.2,1.15.1,1.15,1.14.4,1.14.3,1.14.2,1.14.1,' +
  '1.14,1.13.2,1.13.1,1.13,1.12.2,1.12.1,1.12,1.11.2,1.11.1,1.11,1.10.2,1.10.1,1.10,1.9.4,1.9.3,1.9.2,1.9.1,' +
  '1.9,1.8.9,1.8.8,1.8.7,1.8.6,1.8.5,1.8.4,1.8.3,1.8.2,1.8.1,1.8'
).split(',')

export const SNAPSHOTS: string[] = ['26.4-snapshot-7', '26.4-snapshot-6', '26.4-snapshot-5']

export const LATEST_RELEASE = RELEASES[0] ?? '26.3'

// One version per release line, newest first. Used by the loader version lists.
const LINES = [
  '26.3', '1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1',
  '1.16.5', '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.9'
]
const linesDownTo = (oldest: string): string[] => LINES.slice(0, LINES.indexOf(oldest) + 1)

export interface Extra {
  id: 'sodium' | 'iris' | 'lithium'
  name: string
  sub: string
}

export interface Loader {
  id: LoaderId
  name: string
  popular: string[]
  all: string[]
  extras: Extra[]
}

const SODIUM: Extra = { id: 'sodium', name: 'Sodium', sub: 'faster' }
const IRIS: Extra = { id: 'iris', name: 'Iris', sub: 'shaders' }
const LITHIUM: Extra = { id: 'lithium', name: 'Lithium', sub: 'smoother' }

export const LOADERS: Record<LoaderId, Loader> = {
  fabric: { id: 'fabric', name: 'Fabric', popular: ['26.3', '1.21.1', '1.20.1', '1.16.5'], all: linesDownTo('1.14.4'), extras: [SODIUM, IRIS, LITHIUM] },
  neoforge: { id: 'neoforge', name: 'NeoForge', popular: ['26.3', '1.21.1', '1.20.1'], all: linesDownTo('1.20.1'), extras: [SODIUM, IRIS] },
  forge: { id: 'forge', name: 'Forge', popular: ['1.20.1', '1.16.5', '1.12.2', '1.8.9'], all: LINES.slice(1), extras: [] },
  optifine: { id: 'optifine', name: 'OptiFine', popular: ['1.20.1', '1.16.5', '1.12.2', '1.8.9'], all: LINES.slice(1), extras: [] }
}

export const LOADER_ORDER: LoaderId[] = ['fabric', 'neoforge', 'forge', 'optifine']
