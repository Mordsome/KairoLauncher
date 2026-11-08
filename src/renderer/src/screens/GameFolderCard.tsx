import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { useStore, type Install } from '../state/store'

/** Installs that can share .minecraft: their mods load from their own folder (or they have none). */
export function sharesMinecraft(install: Pick<Install, 'edition' | 'loader' | 'modpack'>): boolean {
  if (install.edition === 'kairo' || install.edition === 'void' || install.edition === 'vanilla') return true
  return install.edition === 'other' && install.loader === 'fabric' && !install.modpack
}

/** Settings > Game: Kairo's own folders, or Minecraft's .minecraft. */
export function GameFolderCard() {
  const shared = useStore((s) => s.settings.sharedMinecraft)
  const folder = useStore((s) => s.info?.minecraftFolder ?? null)
  const update = useStore((s) => s.updateSettings)
  const choices: [boolean, string, string][] = [
    [false, "Kairo's own folders", 'Each install keeps its own worlds, resource packs and settings.'],
    [
      true,
      'Share with Minecraft',
      "Your worlds, resource packs, shader packs and settings from Minecraft's own .minecraft folder. Mods stay in each install's own folder: your .minecraft/mods is never used or changed."
    ]
  ]
  return (
    <div className="card">
      <span className="setting-name">Game folder</span>
      <div
        role="radiogroup"
        aria-label="Game folder"
        className="folder-choices"
        data-roving
        onKeyDown={(e) => rovingKeyDown(e, { select: true, columns: 2 })}
      >
        {choices.map(([value, name, text]) => (
          <button
            key={name}
            type="button"
            role="radio"
            className="folder-choice"
            aria-checked={shared === value}
            tabIndex={rovingTabIndex(shared === value)}
            disabled={value && !folder}
            onClick={() => update({ sharedMinecraft: value })}
          >
            <b>{name}</b>
            <span>{text}</span>
          </button>
        ))}
      </div>
      <span className="setting-desc">
        {folder ? `Found at ${folder}. ` : "There's no .minecraft folder on this PC yet (Minecraft's own launcher makes it). "}
        Kairo, Kairo Void, plain Minecraft and Fabric installs can share it; NeoForge, Forge, OptiFine and modpacks keep their own
        folders. Before the first shared Play, the launcher keeps a copy of your options, server list and configs in its own folder.
      </span>
    </div>
  )
}
