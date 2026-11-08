# Security and privacy review

Phase 8, before the first release (version 0.1.0). It covers Microsoft sign-in, token
storage, the bridge between the UI and the rest of the app, downloads and checksums, starting
Minecraft, Electron's own settings, launcher updates, the release pipeline, and privacy: what
the launcher sends, stores and shows, and what the project and its installers give away.

**Result:** no serious problems in the launcher itself. Eleven weaker spots were fixed, each
with a test. The biggest remaining risk (everything depending on one GitHub account) is now
covered by signed updates. The rest is listed under "Accepted" with the reason.

## How each area holds up

| Area | What was checked | Verdict |
| --- | --- | --- |
| Microsoft sign-in | Auth code flow with PKCE (S256) in the system browser; random `state` checked on return; the local callback listens on 127.0.0.1/::1 only, answers one request, closes after 10 minutes; the address opened must be Microsoft's; MSAL logging off; its network calls go through the launcher's guard | Good |
| Token storage | Tokens only in the OS secure store (split into chunks, written safely); `accounts.json` holds only player name, UUID and Microsoft account ID; signing out deletes the tokens; tokens are hidden from every log and message | Good |
| UI ↔ app bridge | The page gets one small API, no raw IPC; every handler checks the caller is the launcher's own page and validates each argument (IDs, versions, paths); malformed calls are refused (tested) | Good |
| Electron settings | Sandbox, context isolation, no Node in the page, strict CSP (`'self'` only), no new windows, no navigation away, no webviews, permissions all denied, DevTools off in installed builds, spellcheck off (no dictionary downloads), page served from its own `kairo://` scheme that can't read the disk | Good |
| Network | One guarded client for everything: HTTPS only, an exact list of hosts (some limited to paths, e.g. GitHub only under Mordsome), own User-Agent on every request, every redirect hop rechecked; the page itself can't reach the network at all; the game-file library is always handed the guarded client | Good |
| Downloads | Mojang files and Java against Mojang's SHA-1; Fabric, NeoForge and Forge against their published SHA-1; Modrinth against SHA-512; Kairo against the release's `SHA256SUMS.txt`; mismatches are deleted; file names from services are reduced to plain names; modpacks can't write outside their folder (zip-slip checks, size limits) | Good |
| Starting Minecraft | Java started directly with an argument list, never through a shell; a custom Java must be an existing `java`/`javaw` program; versions must exist in Mojang's list | Good |
| Updates | Downloaded only from Mordsome's GitHub releases, SHA-512 from `latest.yml`, **plus Mordsome's signature** (below); never restarts while Minecraft runs | Good after fix 1 |
| Project and installers | No personal paths, user names or game output in any commit, the build output, the app archive, the native module or the installer (all unpacked and searched); one author identity on every commit | Good after the history fix |

## Fixed in this phase

1. **Updates trusted GitHub alone (high impact).** Anyone who took over the GitHub account
   could have pushed a fake update to every player. Updates now need Mordsome's Ed25519
   signature, made on Mordsome's own PC (`npm run release:sign`). The signature covers the
   installer's SHA-512 *and* its file name with the version, so an old signed installer can't
   be passed off as a new one. Unsigned or wrongly signed updates are never offered or
   installed. Kairo releases can be signed the same way (`SHA256SUMS.txt.sig`), and the
   launcher checks that signature whenever it's present.
2. **Your user name on screen (privacy).** Minecraft logs and some errors contain the home
   folder path, which on Windows is usually the account's real name. The log viewer and every
   error message now show it as `~`.
3. **"Open crash report" could open a program.** It opened whatever path the game printed, if
   it was inside the install. Now it only opens `crash-reports/crash-….txt`.
4. **Release workflow token.** The build steps could reach a write-capable GitHub token, and
   so could any of the hundreds of npm packages they run. Now the build jobs are read-only and
   keep no token. Only a last job that runs no npm code can write, and it only creates the
   draft. The GitHub Actions used are pinned to exact commits.
5. **Modpacks could download from any GitHub user.** Modpack files can now come only from
   Modrinth's CDN, as the README and Privacy tab say.
6. **Electron fuses.** They switch off running the app as plain Node.js, `NODE_OPTIONS`, and
   `--inspect` debugging, and make the app load only its own archive, checked against a hash
   in the `.exe`.
7. **Electron 45.2.2 → 45.2.3** (latest patch).
8. **Install records.** A Forge/OptiFine installer path or mod file name read from an
   install's record must now stay inside that install. All existing installs were checked
   against the new rule.
9. **Link check.** The allowed-link check matched `…/KairoAnything` for `…/Kairo`. It now
   matches only whole path parts.
10. **Packaging check.** electron-builder now refuses to package a build with the dev-only
    offline account or without the release key, whichever command started it.
11. **Untested guards.** The updater's network limits and "redirects can't leave the allowed
    hosts" are now covered by tests.

Earlier in this phase: Minecraft logs that contained the Windows user name had been committed
by mistake. They were removed from the whole history, and the build now runs a privacy check
that refuses home-folder paths, game output and key files. Commit times were also moved to
UTC, so they don't hint at a timezone.

## Accepted, with reasons

- **The Minecraft access token is on Java's command line.** Minecraft requires it there, as
  with every launcher. Other programs running as the same user could see it, but they could
  also read the secure store.
- **The secure store is readable by programs running as you.** That's how Credential
  Manager, Keychain and libsecret work. The launcher can't do better than the OS here.
- **A custom Java can be any program named `java`/`javaw`.** It's the player's own choice.
- **OptiFine has no published checksum.** The launcher checks the file is OptiFine, and the
  player downloads it from optifine.net themselves.
- **Mods, modpacks and Forge installers run code.** That's what they are, so only install
  ones you trust. The launcher makes sure what runs is what the source published.
- **The Windows installer isn't code-signed** (a certificate costs money), so SmartScreen
  warns on first run. Updates are still protected by the release signature.
- **Build-tool advisory.** `npm audit` reports a moderate issue in a pattern library used by
  electron-builder at build time, on our own config only. Nothing the launcher ships is
  affected (`npm audit --omit=dev`: 0 vulnerabilities).
- **Minecraft's own telemetry.** The game reports to Mojang/Microsoft by itself; that's
  outside the launcher.

## Worth doing next

- Turn on two-factor sign-in (app or passkey) for GitHub and the Microsoft account, add a
  tag rule for `v*`, and enable private vulnerability reporting (see `docs/RELEASING.md`).
- Back up the release key offline.
- Sign Kairo client releases too, then switch on `requireKairoSignature`.
- Do a test release (for example 0.1.1) to see a signed update arrive end to end.
- Code-sign the Windows installer if it ever becomes affordable (removes the SmartScreen
  warning).

## How it was tested

- Unit tests for each fix: home-folder hiding, crash-report paths, modpack hosts, link
  boundaries, record paths, and signatures, checked against the real signing tool.
- Screen tests on an empty data folder: the bridge refuses bad calls, the network guard
  refuses other hosts, plain HTTP and redirects off the list, and the updater's own network is
  limited to Mordsome on GitHub.
- The installed app (not the dev build): fuses read from the `.exe`, starts without the
  offline account, reaches the secure store, ships its licences, checks for updates.
- The signing tool end to end: a signed installer is accepted, a tampered one refused.
- Searches of every commit, the build output, the app archive and the unpacked installer
  for personal paths and names.
