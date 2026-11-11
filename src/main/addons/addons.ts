import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddonChoice, AddonsState, AddonView } from '../../shared/api'
import { KairoError } from '../errors'
import { sniffImage } from '../imageSniff'
import { latestKairoRelease } from '../kairo/github'
import { readFabricModJson } from '../kairo/modjson'
import { satisfies } from '../kairo/semver'
import { listCustom } from '../installs/custom'
import { dataPaths } from '../paths'
import { hashFile } from '../signature'
import { ADDON_ID, addonFile, addonCatalogue, catalogueFile, MAX_JAR, sha256Hex, type CatalogueAddon, type Edition } from './catalogue'

// Installed addons and the player's choices (SPEC.md section 5). Jars are kept
// in <data>/addons/, never inside an install, and the game gets them through
// Fabric Loader's fabric.addMods, so turning one off never moves a file. The
// choices are one file, <data>/addons.json. The launcher never runs or unpacks
// addon code: it only checks hashes and reads fabric.mod.json, as for any mod.

interface Installed {
  version: string
  file: string
  sha256: string
  kairo: boolean
  void: boolean
  /** Kept so the addon stays usable (and explained) after it leaves the catalogue. */
  name: string
  editions: Edition[]
  api: number
  needs: { kairo: string; minecraft: string }
}

interface StateFile {
  schema: 1
  addons: Record<string, Installed>
}

const dir = () => join(dataPaths().root, 'addons')
const stateFile = () => join(dataPaths().root, 'addons.json')
const EDITION_NAME: Record<Edition, string> = { kairo: 'Kairo', void: 'Kairo Void' }
/** The sockets version Kairo 0.3.x and later provide. */
const SOCKETS = 1

function validInstalled(id: string, x: unknown): x is Installed {
  const r = x as Installed
  return (
    ADDON_ID.test(id) &&
    !!r &&
    typeof r.version === 'string' &&
    r.file === addonFile(id, r.version) &&
    typeof r.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(r.sha256) &&
    typeof r.kairo === 'boolean' &&
    typeof r.void === 'boolean' &&
    typeof r.name === 'string' &&
    Array.isArray(r.editions) &&
    r.editions.every((e) => e === 'kairo' || e === 'void') &&
    typeof r.api === 'number' &&
    !!r.needs &&
    typeof r.needs.kairo === 'string' &&
    typeof r.needs.minecraft === 'string'
  )
}

async function load(): Promise<StateFile> {
  try {
    const raw = JSON.parse(await readFile(stateFile(), 'utf8')) as { schema?: unknown; addons?: Record<string, unknown> }
    const addons: Record<string, Installed> = {}
    if (raw.schema === 1 && raw.addons && typeof raw.addons === 'object') {
      for (const [id, a] of Object.entries(raw.addons)) if (validInstalled(id, a)) addons[id] = a
    }
    return { schema: 1, addons }
  } catch {
    return { schema: 1, addons: {} }
  }
}

// Changes queue up, so two quick clicks can't lose one another.
let writing: Promise<unknown> = Promise.resolve()
function change<T>(work: (state: StateFile) => Promise<T>): Promise<T> {
  const next = writing.then(async () => {
    const state = await load()
    const out = await work(state)
    await mkdir(dataPaths().root, { recursive: true })
    await writeFile(`${stateFile()}.tmp`, JSON.stringify(state, null, 2))
    await rename(`${stateFile()}.tmp`, stateFile())
    return out
  })
  writing = next.catch(() => undefined)
  return next
}

/** "> =0.3.0" in plain words: "0.3.0 or newer". */
export function plainRange(range: string): string {
  const parts = range.trim().split(/\s+/)
  if (parts.length !== 1) return range
  const m = /^(>=|>|<=|<|=|~|\^)?(.+)$/.exec(parts[0]!)
  if (!m) return range
  const [, op, v] = m
  if (op === '>=') return `${v} or newer`
  if (op === '>') return `newer than ${v}`
  if (op === '<=') return `${v} or older`
  if (op === '<') return `older than ${v}`
  return v!
}

type Needs = Pick<Installed, 'editions' | 'api' | 'needs'>

/** Why an addon can't be used on this install, in plain words; null if it can. */
export function whyNot(addon: Needs, edition: Edition, kairoVersion: string, mc: string): string | null {
  if (!addon.editions.includes(edition)) return `is made for ${addon.editions.map((e) => EDITION_NAME[e]).join(' and ')} only`
  if (!satisfies(kairoVersion, addon.needs.kairo)) return `needs Kairo ${plainRange(addon.needs.kairo)} (this install has ${kairoVersion.split('+')[0]})`
  if (!satisfies(mc, addon.needs.minecraft)) return `needs Minecraft ${plainRange(addon.needs.minecraft)} (this install has ${mc})`
  if (addon.api > SOCKETS) return 'needs a newer Kairo than this launcher knows about'
  return null
}

const needsOf = (a: CatalogueAddon): Needs => ({ editions: a.editions, api: a.api, needs: { kairo: a.kairo, minecraft: a.minecraft } })

function choiceOf(i: Installed | undefined): AddonChoice {
  if (!i || (!i.kairo && !i.void)) return 'off'
  return i.kairo && i.void ? 'both' : i.kairo ? 'kairo' : 'void'
}

/** What each edition's installs will run, for the notes on the Addons page. */
async function kairoTargets(): Promise<Record<Edition, { kairo: string; mc: string }[]>> {
  const latest = await latestKairoRelease().then(
    (r) => r.version,
    () => null
  )
  const out: Record<Edition, { kairo: string; mc: string }[]> = { kairo: [], void: [] }
  for (const r of await listCustom().catch(() => [])) {
    if (!r.kairo) continue
    // Installs that update (or were never played) get the newest Kairo on their next Play.
    const version = r.kairo.keepUpdated || !r.kairo.jar ? (latest ?? r.kairo.jar?.version) : r.kairo.jar.version
    if (version) out[r.kairo.edition].push({ kairo: version, mc: r.mc })
  }
  return out
}

/** Everything the Addons page shows. */
export async function addonsState(fresh = false): Promise<AddonsState> {
  const [result, state, targets] = await Promise.all([addonCatalogue(fresh), load(), kairoTargets()])
  const listed = result.catalogue?.addons ?? []
  const ids = [...listed.map((a) => a.id), ...Object.keys(state.addons).filter((id) => !listed.some((a) => a.id === id))]
  const addons: AddonView[] = ids.map((id) => {
    const c = listed.find((a) => a.id === id)
    const i = state.addons[id]
    const needs: Needs = i ?? needsOf(c!)
    const choice = choiceOf(i)
    // A note only when an edition it's switched on for has no install it can run in.
    let note: string | null = null
    for (const e of ['kairo', 'void'] as const) {
      if (note || !i || !i[e] || targets[e].length === 0) continue
      const reasons = targets[e].map((t) => whyNot(needs, e, t.kairo, t.mc))
      if (reasons.every((r) => r !== null)) note = `Not loaded in ${EDITION_NAME[e]} yet: it ${reasons[0]}.`
    }
    return {
      id,
      name: c?.name ?? i!.name,
      summary: c?.summary ?? '',
      description: c?.description ?? '',
      version: i?.version ?? c!.version,
      latest: c?.version ?? null,
      editions: needs.editions,
      tags: c?.tags ?? [],
      hasIcon: !!c?.icon,
      installed: i?.version ?? null,
      choice,
      update: i && c && c.version !== i.version && newer(c.version, i.version) ? c.version : null,
      listed: !!c,
      note
    }
  })
  return { catalogue: result.status, addons }
}

function newer(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let k = 0; k < 3; k++) if (x[k]! !== y[k]!) return x[k]! > y[k]!
  return false
}

/** Downloads and checks an addon's jar, then keeps it in <data>/addons. */
async function fetchJar(c: CatalogueAddon): Promise<void> {
  const result = await addonCatalogue()
  if (!result.catalogue) throw new KairoError('http-status', "The addons list can't be reached right now. Try again later.")
  const bytes = await catalogueFile(result.catalogue, c.file, MAX_JAR)
  if (sha256Hex(bytes) !== c.sha256) throw new KairoError('checksum', `${c.name} didn't match its checksum, so it wasn't installed.`)
  await mkdir(dir(), { recursive: true })
  const tmp = join(dir(), `${c.file}.download`)
  await writeFile(tmp, bytes)
  try {
    // A real Fabric mod jar for exactly this addon and version.
    const meta = await readFabricModJson(tmp).catch(() => null)
    if (!meta || meta.id !== `kairo-addon-${c.id}` || meta.version !== c.version) {
      throw new KairoError('checksum', `${c.name} isn't the addon it says it is, so it wasn't installed.`)
    }
    await rename(tmp, join(dir(), c.file))
  } finally {
    await rm(tmp, { force: true })
  }
}

/** Installs an addon, or updates it to the catalogue's version. The choice stays as it was. */
export async function installAddon(id: string): Promise<void> {
  const result = await addonCatalogue(true)
  const c = result.catalogue?.addons.find((a) => a.id === id)
  if (!c) throw new KairoError('unknown-version', "That addon isn't in the addons list.")
  const before = (await load()).addons[id]
  if (before?.version === c.version) return
  await fetchJar(c)
  await change(async (state) => {
    const old = state.addons[id]
    state.addons[id] = {
      version: c.version,
      file: c.file,
      sha256: c.sha256,
      // New: on for every edition it's made for. Updated: as the player had it.
      kairo: old ? old.kairo && c.editions.includes('kairo') : c.editions.includes('kairo'),
      void: old ? old.void && c.editions.includes('void') : c.editions.includes('void'),
      name: c.name,
      editions: c.editions,
      api: c.api,
      needs: { kairo: c.kairo, minecraft: c.minecraft }
    }
    // The old jar goes only once the new one has checked out.
    if (old && old.file !== c.file) await rm(join(dir(), old.file), { force: true })
  })
}

/** Deletes the addon's jar and the launcher's record of it. Its options inside the game stay. */
export async function uninstallAddon(id: string): Promise<void> {
  await change(async (state) => {
    const i = state.addons[id]
    if (!i) return
    await rm(join(dir(), i.file), { force: true })
    delete state.addons[id]
  })
}

export async function setAddonChoice(id: string, choice: AddonChoice): Promise<void> {
  await change(async (state) => {
    const i = state.addons[id]
    if (!i) throw new KairoError('unknown-version', "That addon isn't installed.")
    const kairo = choice === 'both' || choice === 'kairo'
    const voidOn = choice === 'both' || choice === 'void'
    // A choice the addon isn't made for isn't offered, and isn't accepted either.
    if ((kairo && !i.editions.includes('kairo')) || (voidOn && !i.editions.includes('void'))) {
      throw new KairoError('unknown-version', `${i.name} isn't made for that.`)
    }
    i.kairo = kairo
    i.void = voidOn
  })
}

/** Mod ids of the jars the player put in an install's mods folder (turned-off ones don't count). */
async function handPlaced(modsDir: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const name of await readdir(modsDir).catch(() => [] as string[])) {
    if (!name.toLowerCase().endsWith('.jar')) continue
    const meta = await readFabricModJson(join(modsDir, name)).catch(() => null)
    if (meta) ids.add(meta.id)
  }
  return ids
}

export interface LaunchAddons {
  /** Jars for -Dfabric.addMods. */
  jars: string[]
  /** One line per addon that's on but not loaded, in plain words. */
  notes: string[]
}

/**
 * The addon jars a Kairo or Kairo Void install starts with: installed,
 * switched on for its edition, compatible, and not already in its mods
 * folder. With "Keep Kairo updated", the ones it uses update first.
 */
export async function addonsForLaunch(edition: Edition, kairoVersion: string, mc: string, modsDir: string, keepUpdated: boolean): Promise<LaunchAddons> {
  let state = await load()
  if (keepUpdated && Object.values(state.addons).some((i) => i[edition])) {
    const result = await addonCatalogue().catch(() => null)
    for (const c of result?.catalogue?.addons ?? []) {
      const i = state.addons[c.id]
      if (i?.[edition] && newer(c.version, i.version)) await installAddon(c.id).catch(() => undefined)
    }
    state = await load()
  }

  const placed = await handPlaced(modsDir)
  const jars: string[] = []
  const notes: string[] = []
  for (const [id, i] of Object.entries(state.addons)) {
    if (!i[edition]) continue
    if (placed.has(`kairo-addon-${id}`)) continue // the player's own copy in mods/ loads instead
    const why = whyNot(i, edition, kairoVersion, mc)
    if (why) {
      notes.push(`${i.name} isn't loaded: it ${why}.`)
      continue
    }
    const path = join(dir(), i.file)
    const hash = await hashFile(path, 'sha256').catch(() => null)
    if (hash !== i.sha256) {
      notes.push(`${i.name} isn't loaded: its file is missing or damaged. Install it again on the Addons page.`)
      continue
    }
    jars.push(path)
  }
  return { jars, notes }
}

// Icons: only the ones the catalogue lists, checked against SHA256SUMS.txt and to be real PNGs.
const icons = new Map<string, Buffer>()

export async function addonIcon(id: string): Promise<Buffer | null> {
  if (!ADDON_ID.test(id)) return null
  const result = await addonCatalogue()
  const c = result.catalogue?.addons.find((a) => a.id === id)
  if (!c?.icon) return null
  const hit = icons.get(c.icon.sha256)
  if (hit) return hit
  const bytes = await catalogueFile(result.catalogue!, c.icon.file, 512 * 1024)
  if (sha256Hex(bytes) !== c.icon.sha256 || sniffImage(bytes)?.mime !== 'image/png') return null
  icons.set(c.icon.sha256, bytes)
  return bytes
}
