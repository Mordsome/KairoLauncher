import { useEffect, useState } from 'react'
import type { InstallLook, Rounding } from '../../../shared/api'
import { pictureUrl } from '../background/Background'
import { Modal } from '../components/Modal'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { isHex, ROUNDINGS, sameLook, shownAccent, SWATCHES } from '../state/look'
import { installLook, useStore, type Install } from '../state/store'
import { Segmented } from './BackgroundSettings'

/**
 * An install's look: its accent colour, how round the corners are, and its
 * own background picture. The whole launcher shows it while the dialog is
 * open, both backgrounds included.
 */
export function AppearanceDialog({ install, onClose }: { install: Install; onClose(): void }) {
  const setPreview = useStore((s) => s.setLookPreview)
  const save = useStore((s) => s.setInstallLook)
  const matchTheme = useStore((s) => s.settings.matchTheme)
  const fallback = installLook({ edition: install.edition, look: null })
  const [look, setLook] = useState<InstallLook>(() => installLook(install))
  const [problem, setProblem] = useState(false)

  // Show it while choosing; the saved look comes back when the dialog closes.
  useEffect(() => {
    setPreview({ installId: install.id, look })
  }, [look, install.id, setPreview])
  useEffect(() => () => setPreview(null), [setPreview])

  const custom = !SWATCHES.some((s) => s.accent === look.accent.toLowerCase())
  const isDefault = sameLook(look, fallback)

  const finish = async () => {
    // The default look is stored as "none", so it follows the edition.
    const ok = await save(install.id, isDefault ? null : look)
    if (ok) onClose()
    else setProblem(true)
  }

  return (
    <Modal
      title={`Look for ${install.name}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={() => setLook(fallback)} disabled={isDefault}>
            Reset
          </button>
          <span className="modal-actions-gap" />
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-accent" onClick={() => void finish()}>
            Save
          </button>
        </>
      }
    >
      <p className="modal-note">The launcher takes this look whenever {install.name} is selected. The Pixel field and Aurora follow its colour.</p>

      <span className="field-label" id="look-accent">
        Accent colour
      </span>
      <div role="radiogroup" aria-labelledby="look-accent" className="swatches" data-roving onKeyDown={(e) => rovingKeyDown(e, { select: true })}>
        {SWATCHES.map((s) => {
          const on = s.accent === look.accent.toLowerCase()
          return (
            <button
              key={s.accent}
              type="button"
              role="radio"
              className="swatch"
              aria-checked={on}
              aria-label={s.name}
              title={s.name}
              tabIndex={rovingTabIndex(on || (custom && s === SWATCHES[0]))}
              style={{ background: s.accent }}
              onClick={() => setLook({ ...look, accent: s.accent })}
            />
          )
        })}
      </div>
      <label className="swatch-custom">
        <input
          type="color"
          value={shownAccent(look.accent)}
          aria-label="Your own colour"
          onChange={(e) => isHex(e.target.value) && setLook({ ...look, accent: e.target.value.toLowerCase() })}
        />
        <span>{custom ? 'Your own colour' : 'Pick your own colour'}</span>
      </label>

      <Segmented<Rounding>
        label="Corners"
        value={look.rounding}
        options={ROUNDINGS.map((r) => [r.id, r.name])}
        onChange={(rounding) => setLook({ ...look, rounding })}
      />

      <InstallPicture install={install} />

      {!matchTheme && (
        <p className="modal-note">
          "Match the selected install" is off in Settings, so the launcher stays in the Kairo look outside this dialog.
        </p>
      )}
      {problem && (
        <p className="detail-error" role="alert">
          <b>Couldn't save the look.</b> Try again.
        </p>
      )}
    </Modal>
  )
}

/** The install's own background picture. Choosing or removing one is saved at once. */
function InstallPicture({ install }: { install: Install }) {
  const file = useStore((s) => s.bgFiles?.installs[install.id] ?? null)
  const setBgFiles = useStore((s) => s.setBgFiles)
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const slot = `install:${install.id}` as const

  const choose = async () => {
    const r = await window.kairo.background.pick(slot)
    if (r.ok) {
      setBgFiles(r.files)
      setProblem(null)
    } else if (!r.cancelled) setProblem(r.error)
  }
  const remove = async () => {
    setBgFiles(await window.kairo.background.remove(slot))
    setProblem(null)
  }

  return (
    <div className="look-picture">
      <span className="field-label">Background picture · saved as soon as you choose it</span>
      <div className="look-picture-row">
        {file ? (
          <img className="look-thumb" src={pictureUrl(slot, file.version)} alt={`Picture for ${install.name}`} />
        ) : (
          <span className="look-thumb look-thumb-empty" aria-hidden="true" />
        )}
        <span className="look-picture-text">
          <span className="setting-desc">
            {file
              ? `Shows behind the launcher while ${install.name} is selected. Dim, blur and fit come from Settings.`
              : 'None: the background from Settings shows. Pick a PNG, JPG, WebP or GIF.'}
          </span>
          <span className="look-picture-buttons">
            <button type="button" className="btn-ghost btn-small" onClick={() => void choose()}>
              {file ? 'Change picture…' : 'Choose picture…'}
            </button>
            {file && (
              <button type="button" className="btn-ghost btn-small" onClick={() => void remove()}>
                Remove
              </button>
            )}
          </span>
        </span>
      </div>
      {problem && (
        <p className="detail-error" role="alert">
          <b>{problem.title}.</b> {problem.message}
        </p>
      )}
    </div>
  )
}
