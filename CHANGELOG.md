# Changelog

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

- Every install has its own folder: mods, worlds, settings and screenshots never mix.
- Rename, duplicate, change the Minecraft version, or delete (to the Recycle Bin / Trash).
- See the game's log, live while it runs.
- When Minecraft crashes, the launcher says why in plain words where it can, and opens the
  crash report or the log.

### Accounts

- Sign in with Microsoft in your browser; the launcher never sees your password.
- Several accounts, switched in Settings → Account.
- Sign-in is kept in the system's secure storage (Windows Credential Manager, macOS Keychain,
  or the Secret Service keyring on Linux).

### The launcher

- Remembers your settings and what you last played.
- Updates itself from GitHub. Every update must carry Mordsome's signature, so a fake update
  can't be installed even if someone got into the GitHub account.
- Logs and error messages hide your user folder's name.
- A photosensitivity warning before Kairo Void is installed for the first time.
- No analytics, no telemetry, no accounts of our own.

### Known limits

- The Windows installer isn't code-signed yet, so SmartScreen may warn on first run
  (**More info → Run anyway**).
- Kairo Lite (1.8.9) isn't out yet.
