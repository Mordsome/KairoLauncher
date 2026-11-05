# Interface sounds to make

Right now the launcher makes a simple click in code. When these files exist, they'll be wired in
and the **Interface sounds** setting will turn all of them on or off.

## File format

- **Folder:** `src/renderer/src/assets/sounds/` (create it)
- **Format:** `.ogg` (or `.wav`), 48 kHz, mono
- **Length:** short. Most under 0.15 s; the longer ones are noted below.
- **Loudness:** quiet. Peak around -6 dB and keep them gentle, because people hear them many times
  an hour. No silence at the start, so they don't feel laggy.
- **Licence:** only sounds you made yourself, or ones marked CC0. Credit anything not yours in
  `THIRD_PARTY_NOTICES.md`.

## The list

| # | File | When it plays | Feel | Length |
| --- | --- | --- | --- | --- |
| 1 | `click.ogg` | Pressing any normal button | Soft, short tap | ~0.05 s |
| 2 | `hover.ogg` | Mouse moves onto a button (very quiet; optional) | Barely there, airy tick | ~0.03 s |
| 3 | `toggle-on.ogg` | A switch turns on | Click that rises slightly | ~0.08 s |
| 4 | `toggle-off.ogg` | A switch turns off | Same click, falling slightly | ~0.08 s |
| 5 | `select.ogg` | Picking a version, an edition in the picker, or a Library row | Light "tick", a bit brighter than click | ~0.06 s |
| 6 | `open.ogg` | Opening the picker or a dialog | Soft whoosh/slide in | ~0.2 s |
| 7 | `close.ogg` | Closing the picker or a dialog (Escape, Cancel) | Same whoosh, reversed/softer | ~0.2 s |
| 8 | `play.ogg` | Pressing Play | The "main" sound: confident, satisfying | ~0.3 s |
| 9 | `launched.ogg` | The game window has opened | Gentle success chime | ~0.5 s |
| 10 | `done.ogg` | A download finished, an install was created, a rename was saved | Small positive blip | ~0.25 s |
| 11 | `error.ogg` | Something failed or the game crashed | Low, soft "bonk". Not alarming | ~0.25 s |
| 12 | `delete.ogg` | Confirming Delete | Soft paper/crumple or low thud | ~0.25 s |
| 13 | `stop.ogg` | Pressing Stop while the game runs | Short downward tone | ~0.15 s |

## Kairo Void versions (optional)

The launcher switches to the Void theme when Kairo Void is selected. If you want, make a second
set with the same names in `sounds/void/`: deeper, more synth-like, a bit of reverb. Any file
missing there falls back to the normal one.

## Must-have vs nice-to-have

- **Must-have:** 1, 3, 4, 8, 11
- **Nice-to-have:** 5, 6, 7, 9, 10, 13
- **Optional:** 2, 12, the Void set

Tip: make them as one family. Use the same instrument or synth patch for all of them, so the
launcher sounds like one thing.
