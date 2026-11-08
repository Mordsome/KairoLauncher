import type { KairoStatus } from '../../shared/api'
import { latestKairoRelease } from './github'

export async function kairoStatus(): Promise<KairoStatus> {
  const latest = await latestKairoRelease().then(
    (r) => ({ version: r.version, notes: r.notes ?? null }),
    () => null
  )
  return { latest }
}
