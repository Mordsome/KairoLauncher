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
| `npm run build` | Typechecks, then builds into `out/` |
| `npm start` | Runs the production build |
| `npm run test:e2e` | Builds, then clicks through every screen of the real app; screenshots land in `test-results/screens/` |

Layout: `src/main` (Electron main process), `src/preload` (the small typed API the UI gets),
`src/renderer` (React UI), `src/shared` (types and the CSP shared by both sides).

## Licence

GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
