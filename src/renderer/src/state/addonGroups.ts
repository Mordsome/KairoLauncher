import type { AddonGroup } from '../../../shared/api'

// The Addons page lists addons under a heading per group, in this order
// (SPEC.md section 5). Empty groups get no heading; anything the launcher
// doesn't know is "Other".

export const GROUPS: { id: AddonGroup; name: string; sub: string }[] = [
  { id: 'themes', name: 'Themes', sub: 'How Kairo looks' },
  { id: 'effects', name: 'Effects', sub: 'Animations and effects' },
  { id: 'fun', name: 'Fun', sub: 'Playful extras' },
  { id: 'tools', name: 'Tools', sub: 'Useful helpers' },
  { id: 'other', name: 'Other', sub: 'Everything else' }
]

/** The addons under their group headings, in the page's order; inside a group the order stays as it was. */
export function groupAddons<T extends { group?: string | null }>(addons: T[]): { group: (typeof GROUPS)[number]; addons: T[] }[] {
  const known = new Set(GROUPS.map((g) => g.id as string))
  const of = (a: T) => (typeof a.group === 'string' && known.has(a.group) ? a.group : 'other')
  return GROUPS.map((group) => ({ group, addons: addons.filter((a) => of(a) === group.id) })).filter((g) => g.addons.length > 0)
}
