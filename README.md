# Kairo Launcher

A desktop launcher for the [Kairo](https://github.com/Mordsome/Kairo) Minecraft clients, by Mordsome.

Status: in development. See `design/` for the screens it follows.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

## Develop

Needs Node.js 22.12 or newer.

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies and downloads Electron |
| `npm run dev` | Runs the launcher with hot reload |
| `npm run dev:offline` | Same, plus a dev-only offline account so Vanilla can be launched without signing in |
| `npm run build` | Typechecks, then builds into `out/` |
| `npm start` | Runs the production build |
| `npm run test:e2e` | Builds, then clicks through every screen of the real app; screenshots land in `test-results/screens/` |
| `npm run test:launch` | Downloads and really launches Minecraft 26.3, 1.20.1, 1.12.2 and 1.8.9 (several GB the first time) |

The offline account exists only in `--mode offline` builds (it is compiled out of every other
build) and refuses to work in a packaged app. It never ships in a release.

Layout: `src/main` (Electron main process), `src/preload` (the small typed API the UI gets),
`src/renderer` (React UI), `src/shared` (types and the CSP shared by both sides).

### Where the launcher keeps things

Everything lives in the app's data folder (`%APPDATA%\Kairo Launcher` on Windows):

| Folder | What's in it |
| --- | --- |
| `game/` | Minecraft versions, libraries and assets, shared by every install |
| `runtimes/` | Java runtimes from Mojang, one per Java version |
| `installs/<name>/` | One install: its own worlds, settings, mods and logs, plus `kairo-launcher.json` |
| `cache/` | The last version lists and Kairo release, used when the network is down |

Every download is checked: Mojang files against their SHA-1, Kairo jars against the
release's `SHA256SUMS.txt`, Modrinth files against their SHA-512, Fabric libraries against the
SHA-1 Fabric publishes. A file that doesn't match is deleted and fetched again; if it still
fails, the launcher says so instead of starting.

### Kairo installs

`installs/Kairo` and `installs/Kairo Void` each hold Fabric Loader, Fabric API, Sodium and
exactly one Kairo jar, from the newest release of
[Mordsome/Kairo](https://github.com/Mordsome/Kairo/releases) that has both jars and a
`SHA256SUMS.txt`. The Minecraft version, the loader version and the mods come from the jar's
own `fabric.mod.json`, so they always fit together.

With **Keep Kairo updated** on, every Play moves Kairo, Fabric Loader, Fabric API and Sodium to
the newest versions that match. With it off, the install stays exactly as recorded. Files a
player adds to `mods/` are left alone; a Kairo jar of the other edition is removed.

### Other installs and modpacks

**Other** builds an install from a loader and a Minecraft version, both read live from the
loader's official source, plus optional Sodium, Iris and Lithium from Modrinth (only offered
where Modrinth has them for that loader and version; their required dependencies come along).
Versions are chosen on the first Play and then kept.

| Loader | Where it comes from |
| --- | --- |
| Fabric | Fabric's meta and maven, checked against Fabric's SHA-1 |
| NeoForge | NeoForge's maven, checked against the `.sha1` it publishes |
| Forge | Forge asks launchers not to download it automatically (its download page's ads pay for it). The launcher opens Forge's own page; the player downloads the installer and picks it; it's checked against the SHA-1 Forge publishes before it's used. |
| OptiFine | Its licence forbids redistributing or automatically downloading it. The launcher opens optifine.net; the player downloads the jar and picks it. |

**Modpacks** (`.mrpack`) are untrusted input: every file path must stay inside the install
folder, every download must come from a service the launcher already talks to (in practice
Modrinth's CDN; packs that need anything else are refused, so the Privacy tab stays true), every
file is checked against the pack's SHA-512, and unpacked files have size limits. Fabric and
NeoForge packs install directly; Forge packs ask for the Forge installer the same way as above.
Quilt isn't supported.

### Library, settings and crashes

Plain Minecraft installs are real installs too (`installs/vanilla-<version>`), made the first
time a version is played. In the **Library**, every install except Kairo and Kairo Void can be
renamed (only the name changes, not the folder), duplicated (worlds, settings and mods are
copied; logs and crash reports aren't), moved to another Minecraft version (the mods the
launcher added are swapped on the next Play; modpacks, Forge and OptiFine can't, since they're
tied to their version), or deleted, which moves the folder to the Recycle Bin / Trash. **Logs**
shows the game's output, live while it runs.

Settings and the last selection are saved in `settings.json`. Every field is checked when it's
read and written; a file that can't be read is set aside as `settings.json.broken-<time>` and
the defaults are used.

When Minecraft closes with an error, Home says why in plain words where it can (out of
memory, Java refusing the memory setting, mods that don't fit together, Java too old) and
offers **Open crash report** (only a report inside that install's folder) and **View log**.

## Licence

GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
