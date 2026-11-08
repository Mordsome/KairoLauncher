import type { EditionId, LoaderId } from '../data/catalog'
import { Logo } from './Logo'

// Drawn banners for the Library and the picker: no screenshots, no other
// projects' logos. Kairo and Void get the ring in their own colours; plain
// Minecraft a little pixel landscape; loaders and modpacks their own colour and mark.

export type BannerKind = 'kairo' | 'void' | 'vanilla' | 'modpack' | 'lite' | LoaderId

export function bannerKind(install: { edition: EditionId; loader?: LoaderId; modpack?: string }): BannerKind {
  if (install.edition === 'kairo' || install.edition === 'void' || install.edition === 'vanilla' || install.edition === 'lite') return install.edition
  if (install.modpack) return 'modpack'
  return install.loader ?? 'fabric'
}

const MARK: Partial<Record<BannerKind, string>> = { fabric: 'F', neoforge: 'N', forge: 'F', optifine: 'O' }

export function InstallBanner({ kind, className = '' }: { kind: BannerKind; className?: string }) {
  return (
    <span className={`thumb banner banner-${kind} ${className}`} aria-hidden="true">
      {(kind === 'kairo' || kind === 'void') && <Logo size={40} />}
      {kind === 'vanilla' && <span className="banner-land" />}
      {kind === 'modpack' && (
        <span className="banner-stack">
          <i />
          <i />
          <i />
        </span>
      )}
      {MARK[kind] && <span className="banner-mark">{MARK[kind]}</span>}
    </span>
  )
}
