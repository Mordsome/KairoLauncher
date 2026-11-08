import { shell } from 'electron'
import { cp, rm, mkdir } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import type { LibraryResult } from '../../shared/api'
import { describeError, KairoError } from '../errors'
import { listVersions } from '../game/manifest'
import { installDir as kairoDir } from '../kairo/install'
import { loaderVersions } from '../loaders/meta'
import { safeRelative } from '../loaders/mrpack'
import { redact } from '../redact'
import { customDir, freeName, getCustom, installsDir, newRecord, toInfo, writeCustom, type CustomRecord } from './custom'
import { canShare, minecraftDir } from '../minecraftDir'
import { loadSettings } from '../settings'

// Library actions on custom and vanilla installs. Kairo and Kairo Void are
// the launcher's own installs: they can be opened and their logs read, but
// not renamed, copied, deleted or moved to another version (they follow the
// Kairo release).

export type InstallRef = string // a custom install id, or "kairo" / "void"

export function refDir(ref: InstallRef): Promise<string | null> {
  if (ref === 'kairo' || ref === 'void') return Promise.resolve(kairoDir(ref))
  return getCustom(ref).then((r) => (r ? customDir(r) : null))
}

/** True if path is a folder inside installs/ (never installs/ itself or anything outside it). */
export function insideInstalls(path: string): boolean {
  const root = normalize(installsDir()) + sep
  return normalize(path).startsWith(root) && normalize(path).length > root.length
}

const ok = (record: CustomRecord): LibraryResult => ({ ok: true, install: toInfo(record) })
const fail = (error: unknown): LibraryResult => ({ ok: false, error: describeError(error, redact) })

async function need(id: string): Promise<CustomRecord> {
  const record = await getCustom(id)
  if (!record) throw new KairoError('unknown-version', 'This install no longer exists.')
  return record
}

export async function renameInstall(id: string, name: string): Promise<LibraryResult> {
  try {
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
    if (clean.length < 1 || clean.length > 48) throw new KairoError('unknown-version', 'Names need 1 to 48 characters.')
    const record = { ...(await need(id)), name: clean }
    // Only the name changes; the folder (and the worlds in it) stays where it is.
    await writeCustom(record)
    return ok(record)
  } catch (error) {
    return fail(error)
  }
}

export async function duplicateInstall(id: string): Promise<LibraryResult> {
  try {
    const source = await need(id)
    // "Fabric 1.21.1 copy", or "... copy (2)" if that is taken.
    const name = freeName(`${source.name} copy`.slice(0, 40))
    const folder = name
    // Everything but the id, so the copy gets a new one.
    const { id: _sourceId, ...rest } = source
    const copy = newRecord({ ...rest, name, folder, createdAt: Date.now(), lastPlayed: null, playMinutes: 0 })
    const from = customDir(source)
    const to = customDir(copy)
    if (!insideInstalls(to)) throw new KairoError('unknown-version', 'Unexpected install folder.')
    // Worlds, settings, mods and the installers; logs and crash reports stay behind.
    await cp(from, to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (src) => {
        const rel = src.slice(from.length + 1).split(/[\\/]/)[0]
        return rel !== 'logs' && rel !== 'crash-reports' && !src.endsWith('kairo-launcher.json')
      }
    })
    await writeCustom(copy)
    return ok(copy)
  } catch (error) {
    return fail(error)
  }
}

/** Moves the install folder to the Recycle Bin / Trash, so nothing is lost for good by mistake. */
export async function deleteInstall(id: string): Promise<{ ok: true } | { ok: false; error: { title: string; message: string } }> {
  try {
    const record = await need(id)
    const dir = customDir(record)
    if (!insideInstalls(dir)) throw new KairoError('unknown-version', 'Unexpected install folder.')
    await shell.trashItem(dir)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeError(error, redact) }
  }
}

/**
 * Moves an install to another Minecraft version. Loader versions are picked
 * again on the next Play, and the mods the launcher put there (made for the
 * old version) are removed; anything the player added stays.
 */
export async function changeVersion(id: string, mc: string): Promise<LibraryResult> {
  try {
    const record = await need(id)
    if (record.modpack) throw new KairoError('unknown-version', 'A modpack decides its own Minecraft version. Import a newer version of the pack instead.')
    if (record.loader === 'forge' || record.loader === 'optifine') {
      throw new KairoError('unknown-version', `${record.loader === 'forge' ? 'Forge' : 'OptiFine'} installers are made for one Minecraft version. Create a new install with the installer for the version you want.`)
    }
    const supported =
      record.loader === 'vanilla' ? [...(await listVersions()).releases, ...(await listVersions()).snapshots] : (await loaderVersions(record.loader)).mcs
    if (!supported.includes(mc)) throw new KairoError('unknown-version', `That loader has no Minecraft ${mc}.`)
    if (mc === record.mc) return ok(record)

    const dir = customDir(record)
    for (const mod of record.mods) {
      const rel = safeRelative(mod.filename)
      if (rel) await rm(join(dir, rel), { force: true })
    }
    const next: CustomRecord = {
      ...record,
      mc,
      loaderVersion: record.loader === 'neoforge' ? ((await loaderVersions('neoforge')).loaderVersions[mc] ?? null) : null,
      versionId: null,
      mods: []
    }
    await writeCustom(next)
    return ok(next)
  } catch (error) {
    return fail(error)
  }
}

/** .minecraft, when this install shares it (Settings > Game > Game folder); else null. */
export async function sharedGameDir(ref: InstallRef): Promise<string | null> {
  if (!(await loadSettings()).sharedMinecraft) return null
  if (ref === 'kairo' || ref === 'void') return minecraftDir()
  const record = await getCustom(ref)
  return record && canShare(record.loader, record.modpack !== null) ? minecraftDir() : null
}

export async function openInstallFolder(ref: InstallRef): Promise<void> {
  const dir = await refDir(ref)
  if (!dir || !insideInstalls(dir)) return
  // An install that was never played has no folder yet: make it, so there is something to open.
  await mkdir(dir, { recursive: true })
  await shell.openPath(dir)
}
