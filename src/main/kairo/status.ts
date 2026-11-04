import type { KairoEdition, KairoInstallInfo, KairoStatus, ModInfo } from '../../shared/api'
import { emptyRecord, readRecord, writeRecord, type InstallRecord } from '../installs/record'
import { latestKairoRelease } from './github'
import { displayVersion, installDir } from './install'

function info(record: InstallRecord | null): KairoInstallInfo {
  const r = record ?? emptyRecord('kairo')
  const mods: ModInfo[] = []
  if (r.kairo) mods.push({ name: r.kairo.name, version: displayVersion(r.kairo.version) })
  if (r.loader) mods.push({ name: 'Fabric Loader', version: r.loader })
  for (const m of r.mods) mods.push({ name: m.name, version: displayVersion(m.version) })
  return {
    mc: r.mc,
    kairoVersion: r.kairo ? displayVersion(r.kairo.version) : null,
    mods,
    keepUpdated: r.keepUpdated,
    lastPlayed: r.lastPlayed,
    playMinutes: r.playMinutes
  }
}

export async function kairoStatus(): Promise<KairoStatus> {
  const [latest, kairo, voidRecord] = await Promise.all([
    latestKairoRelease().then(
      (r) => ({ version: r.version }),
      () => null
    ),
    readRecord(installDir('kairo')),
    readRecord(installDir('void'))
  ])
  return { latest, installs: { kairo: info(kairo), void: info(voidRecord) } }
}

export async function setKeepUpdated(edition: KairoEdition, on: boolean): Promise<KairoStatus> {
  const dir = installDir(edition)
  const record = (await readRecord(dir)) ?? emptyRecord(edition)
  await writeRecord(dir, { ...record, keepUpdated: on })
  return kairoStatus()
}
