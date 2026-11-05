import { join } from 'node:path'
import { safeRelative } from './mrpack'
import type { CustomLoader, ExtraInfo, InstallLoader } from '../../shared/api'
import { KairoError } from '../errors'
import type { Stage } from '../game/runtime'
import type { ManagedMod } from '../installs/record'
import { modrinthCandidates, modrinthProject } from '../kairo/modrinth'

// The optional performance mods in the "Other" builder, all from Modrinth,
// always the version made for the chosen Minecraft version and loader.

export const EXTRAS: ExtraInfo[] = [
  { id: 'sodium', name: 'Sodium', sub: 'faster' },
  { id: 'iris', name: 'Iris', sub: 'shaders' },
  { id: 'lithium', name: 'Lithium', sub: 'smoother' }
]

export function modrinthLoader(loader: InstallLoader): 'fabric' | 'neoforge' | null {
  return loader === 'fabric' || loader === 'neoforge' ? loader : null
}

/** Only the extras Modrinth actually has for this loader and Minecraft version. */
export async function availableExtras(loader: CustomLoader, mc: string): Promise<ExtraInfo[]> {
  const slug = modrinthLoader(loader)
  if (!slug) return []
  const found = await Promise.all(
    EXTRAS.map((x) =>
      modrinthCandidates(x.id, mc, slug).then(
        () => x,
        () => null
      )
    )
  )
  return found.filter((x): x is ExtraInfo => x !== null)
}

/**
 * Picks the newest fitting version of each wanted project, plus whatever
 * they require (Iris needs Sodium, some mods need Fabric API), and downloads
 * them into mods/, each checked against Modrinth's SHA-512.
 */
export async function resolveModrinthMods(
  wanted: string[],
  mc: string,
  loader: 'fabric' | 'neoforge',
  installDir: string,
  stage: Stage,
  signal: AbortSignal
): Promise<ManagedMod[]> {
  const chosen = new Map<string, ManagedMod>()
  const queue = [...wanted]
  while (queue.length > 0) {
    const next = queue.shift()!
    const project = await modrinthProject(next, signal)
    if (chosen.has(project.id)) continue
    const [file] = await modrinthCandidates(project.slug, mc, loader, signal).catch(() => {
      throw new KairoError('http-status', `Modrinth has no ${project.title} for ${loader === 'fabric' ? 'Fabric' : 'NeoForge'} ${mc}.`)
    })
    if (!file) continue
    chosen.set(project.id, {
      project: project.slug,
      name: project.title,
      version: file.versionNumber,
      filename: `mods/${file.filename}`,
      url: file.url,
      hash: { algorithm: 'sha512', value: file.sha512 }
    })
    queue.push(...file.requires)
  }
  const mods = [...chosen.values()]
  await downloadMods(mods, installDir, stage, signal)
  return mods
}

/** Downloads (or re-checks) recorded files, relative to the install folder. Every file is verified against its hash. */
export async function downloadMods(mods: ManagedMod[], installDir: string, stage: Stage, signal: AbortSignal): Promise<void> {
  if (mods.length === 0) return
  if (mods.some((m) => !safeRelative(m.filename))) throw new KairoError('unknown-version', 'A recorded file points outside its install folder.')
  await stage.run(
    {
      schemaVersion: 1,
      tasks: [
        {
          id: 'mods',
          type: 'files',
          files: mods.map((m) => ({
            path: join(installDir, m.filename),
            urls: [m.url],
            checksum: { algorithm: m.hash.algorithm, value: m.hash.value },
            // Modpacks can also ship configs; only archives get the zip check.
            ...(/.(jar|zip)$/i.test(m.filename) ? { validator: 'zip' as const } : {})
          }))
        }
      ]
    },
    signal
  )
}
