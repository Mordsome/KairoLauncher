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

## Licence

GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
