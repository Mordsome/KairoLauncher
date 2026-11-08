# Releasing Kairo Launcher

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and wait as a **draft**.
Nothing is public until you publish the draft yourself.

## Once

1. Create the public repository `Mordsome/KairoLauncher` on GitHub and push the code to it.
   The launcher looks for its updates there, so the name has to match.
2. In the repository's **Settings → Actions → General**, allow Actions to run, and under
   "Workflow permissions" choose **Read and write permissions**, so the workflow can create
   the draft release.

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
   tests, the privacy check and the release check, then builds both installers and uploads
   them to a draft release called `0.2.0`:
   - `KairoLauncher-Setup-0.2.0.exe`, its `.blockmap` and `latest.yml` (Windows)
   - `KairoLauncher-0.2.0.AppImage` and `latest-linux.yml` (Linux)
5. Download the installer from the draft and try it: install, sign in, play something.
6. Edit the draft: paste the `CHANGELOG.md` section as the description, make sure
   "Set as a pre-release" is **off**, and press **Publish release**.

Running launchers find the update within a few hours (or at their next start), download it,
check it against the SHA-512 in `latest.yml`, and install it on their next restart.

## Don't

- Don't delete or rename the `latest.yml` / `latest-linux.yml` files or the `.blockmap`:
  updates need them.
- Don't mark a release as a pre-release if it should reach everyone: launchers skip those.
- Don't reuse a version number. To fix a bad release, publish a newer one.

## Building locally

`npm run dist:win` builds the Windows installer into `release/` without uploading anything,
and `npm run test:packaged` checks the result. AppImages have to be built on Linux
(`npm run dist:linux`); the workflow does that for you.
