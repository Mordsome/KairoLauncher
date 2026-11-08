# Security

## Reporting a problem

Please report security problems privately, not in a public issue: on this repository's
**Security** tab, choose **Report a vulnerability**. Include what you found, how to reproduce
it, and which version of Kairo Launcher you used. You'll get an answer there.

Only the newest release gets fixes; the launcher updates itself to it.

## What the launcher does to keep you safe

- **Your Microsoft account:** you sign in on Microsoft's own page in your browser; the
  launcher never sees your password. Sign-in tokens are kept only in your system's secure
  storage (Windows Credential Manager, macOS Keychain, or the Secret Service keyring on Linux),
  never in a file, and never written to logs.
- **Downloads:** HTTPS only, and only from the services listed in Settings → Privacy. Every
  file is checked against the checksum its official source publishes, and a mismatch is never
  used.
- **Updates:** every launcher update must carry Mordsome's signature, made on Mordsome's own
  PC; an update without it isn't installed.
- **Privacy:** no analytics, no telemetry, no accounts of our own. Logs and error messages
  shown in the launcher hide your user folder's name.

A full review is in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).
