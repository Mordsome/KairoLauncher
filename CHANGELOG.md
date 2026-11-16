# Changelog

## 0.2.0: addons

Addons for Kairo and Kairo Void, restarting the game from Kairo 0.4.0, and a one-command install on Linux.
Launchers on 0.1.0 update to this by themselves.

### Kairo 0.4.0

- **Restart the game:** Kairo 0.4.0's Settings → About → "Restart the game" closes Minecraft and the
  launcher starts the same install again, once. A crash never restarts it.

### Linux

- **One-command install** for every distro: `curl -fsSL https://raw.githubusercontent.com/Mordsome/KairoLauncher/main/install.sh | sh`.
  It checks the AppImage against the release's checksum and Mordsome's signature, installs it for your
  user only (no sudo), and adds it to your app menu with a `kairo-launcher` command.

### Addons

- **Addons for Kairo and Kairo Void**, from Mordsome/KairoAddons: an **Addons** button on the left
  rail while a Kairo install is selected. Install, update and uninstall them, and choose where each
  one is used: Kairo and Kairo Void, Kairo only, Kairo Void only, or off.
- Every addon is checked against the release's `SHA256SUMS.txt` (and Mordsome's signature, when the
  release has one) before it's installed, and again before every game start.
- Addons are listed by group (Themes, Effects, Fun, Tools), and two addons that don't go together are
  never on at the same time: turning one on asks which one to keep.
- Addons load from the launcher's own folder, never from your installs' `mods` folders. An addon that
  can't be used with an install (for example one that needs a newer Kairo) is skipped, and Home says why.

### Fixed

- Saving settings and installs tries again when Windows briefly says a file is busy (for example while
  an antivirus checks it), instead of failing.

## 0.1.0: first release

The first public version of Kairo Launcher, for Windows and Linux.

### Play

- **Kairo and Kairo Void** for Minecraft 26.3, installed from the official Kairo releases and
  checked against their checksums. "Keep Kairo updated" moves Kairo, Fabric API and Sodium to
  matching new versions on every Play. The launcher switches to the Void look when Kairo Void
  is selected.
- **Plain Minecraft**, every release from 1.8 to the newest (snapshots with a switch in Settings).
- **Other installs:** Fabric, NeoForge, Forge and OptiFine for the version you pick, with
  Sodium, Iris and Lithium from Modrinth if you want them. Forge and OptiFine are downloaded
  from their own sites, as they ask, and checked before use.
- **Modrinth modpacks** (`.mrpack`), checked file by file.
- The right Java for each version, downloaded from Mojang, or your own.

### Your installs

- **As many installs as you like**, Kairo ones too: make them with **New install** and pick
  between them on Home.
- **Mods from Modrinth** for Fabric, NeoForge and Forge installs: search and sort, pick several
  and install them together with their dependencies, turn on and off, remove. Every pick is
  checked for a file made for exactly that install's loader and Minecraft version.
- **A look for every install:** its own accent colour, corners (Round, Soft or Sharp) and
  background picture, shown whenever it's selected.
- **Share your .minecraft** (Settings → Game): your worlds, packs and settings, while mods stay in
  each install's own folder. Your `.minecraft/mods` is never used or changed.

- Every install has its own folder: mods, worlds, settings and screenshots never mix.
- Rename, duplicate, change the Minecraft version, or delete (to the Recycle Bin / Trash), from
  the **⋯** button or by right-clicking an install.
- See the game's log, live while it runs.
- When Minecraft crashes, the launcher says why in plain words where it can, and opens the
  crash report or the log.

### Accounts

- Sign in with Microsoft in your browser; the launcher never sees your password.
- Several accounts: switch from the account button at the bottom left, or in Settings → Account.
- Each account's picture is the head of the skin it wears, or a picture you choose.
- Signing out asks first.
- Sign-in is kept in the system's secure storage (Windows Credential Manager, macOS Keychain,
  or the Secret Service keyring on Linux).

### The launcher

- New backgrounds: the **Pixel field** (a calm dot grid with a soft trail), **Aurora**, or your own
  picture or GIF. Reduce motion keeps everything still.
- **Patch notes** for the latest Kairo on Home (can be turned off).
- **Home layouts:** Classic, Centred, Side panel or Bottom bar.

- Remembers your settings and what you last played.
- Updates itself from GitHub. Every update must carry Mordsome's signature, so a fake update
  can't be installed even if someone got into the GitHub account.
- Logs and error messages hide your user folder's name.
- A photosensitivity warning before Kairo Void is installed for the first time.
- No analytics, no telemetry, no accounts of our own.
- A careful uninstaller (Settings → Apps): it removes only the launcher's own files, never
  follows links, and never touches your .minecraft. It asks before deleting your installs and
  sign-ins, and keeps them if you say no.

### Known limits

- The Windows installer isn't code-signed yet, so SmartScreen may warn on first run
  (**More info → Run anyway**).
- Kairo Lite (1.8.9) isn't out yet.
