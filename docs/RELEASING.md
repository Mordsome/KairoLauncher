# Releasing Kairo Launcher

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and wait as a **draft**.
Nothing is public until you sign the installers on your own PC and publish the draft yourself.

## Your signing key

Every launcher update has to carry your signature, made with a key that exists only on your
PC. Launchers refuse updates without it, so even someone who got into the GitHub account
couldn't push a fake update to players.

- The key was made once with `npm run release:keygen`. The private half is the file
  `.kairo-release/release-key.pem` in your user folder; its public half is in
  `config/release-key.json` and built into every launcher.
- **Back up that `.pem` file offline** (a USB stick kept somewhere safe). If it's lost,
  installed launchers can't be updated any more, only reinstalled by hand.
- **Never** put it in the project, share it, upload it or paste it anywhere. The build's privacy
  check refuses to run if a key file is ever committed.
- Using another PC: copy the file to the same place there (or point the `KAIRO_RELEASE_KEY`
  environment variable at it).

## Once, on GitHub

1. Create the public repository `Mordsome/KairoLauncher` and push the code to it. The launcher
   looks for its updates there, so the name has to match.
2. Leave **Settings → Actions → General → Workflow permissions** on the default, read-only.
   The workflow asks for write access only in its last step, the one that makes the draft.
3. Protect the account: two-factor sign-in with an app or a passkey (not SMS) for GitHub and
   for the Microsoft account that owns the Azure app. Under **Settings → Rules**, add a tag rule
   for `v*` so only you can create or move release tags.
4. Under **Settings → Code security**, turn on private vulnerability reporting and Dependabot
   alerts.

## Every release

1. Pick the new version (for example `0.2.0`) and set it without making a tag yet:

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

2. Add a section for it at the top of `CHANGELOG.md`: what's new, what's fixed, in plain words.
3. Commit, then tag that commit with the same version plus a `v`, and push both:

   ```bash
   git commit -am "Release 0.2.0"
   git tag v0.2.0
   git push origin main v0.2.0
   ```

4. Wait for the **Release** workflow in the Actions tab (about 10 minutes). It runs the unit
   tests, the privacy check and the release check, builds both installers and makes a draft
   release called `0.2.0` with:
   - `KairoLauncher-Setup-0.2.0.exe`, its `.blockmap` and `latest.yml` (Windows)
   - `KairoLauncher-0.2.0.AppImage` and `latest-linux.yml` (Linux)
5. Download the two installers from the draft and try them: install, sign in, play something.
6. Sign exactly the files you downloaded:

   ```bash
   npm run release:sign -- "<downloads>/KairoLauncher-Setup-0.2.0.exe" "<downloads>/KairoLauncher-0.2.0.AppImage"
   ```

   This writes a `.sig` file next to each one.
7. Edit the draft: upload both `.sig` files, paste the `CHANGELOG.md` section as the
   description, make sure "Set as a pre-release" is **off**, and press **Publish release**.

Running launchers find the update within a few hours (or at their next start), download it,
check it against the SHA-512 in `latest.yml` **and** your signature, and only then install it
on their next restart. Without a valid `.sig`, they show "isn't signed by Mordsome" and keep
the version they have.

## Kairo client releases

Kairo releases can be signed the same way. After making a release of `Mordsome/Kairo` (with
both jars and `SHA256SUMS.txt`), download its `SHA256SUMS.txt` and run:

```bash
npm run release:sign-kairo -- v0.21.0 "<downloads>/SHA256SUMS.txt"
```

Upload the resulting `SHA256SUMS.txt.sig` to that release. Launchers check it whenever it's
there. Once every new Kairo release has one, set `"requireKairoSignature": true` in
`config/release-key.json` in the next launcher release, so unsigned Kairo releases are refused
too.

## Don't

- Don't delete or rename `latest.yml` / `latest-linux.yml`, the `.blockmap` or the `.sig` files:
  updates need them.
- Don't mark a release as a pre-release if it should reach everyone: launchers skip those.
- Don't reuse a version number. To fix a bad release, publish a newer one.
- Don't make a new signing key while the old one exists: launchers would refuse everything
  signed with the new one.

## Building locally

`npm run dist:win` builds the Windows installer into `release/` without uploading anything,
and `npm run test:packaged` checks the result. AppImages have to be built on Linux
(`npm run dist:linux`); the workflow does that for you.
