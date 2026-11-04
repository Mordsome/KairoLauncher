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
| `installs/<name>/` | One install: its own worlds, settings, mods and logs |
| `cache/` | The last version lists, used when the network is down |

Every download is checked against the SHA-1 Mojang publishes. A file that doesn't match is
deleted and fetched again; if it still fails, the launcher says so instead of starting.

## Licence

GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
