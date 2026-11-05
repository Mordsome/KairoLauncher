import { Modal } from '../components/Modal'
import { useStore } from '../state/store'

/** Shown once, before Kairo Void is installed for the first time. */
export function VoidWarning() {
  const open = useStore((s) => s.voidWarning)
  const accept = useStore((s) => s.acceptVoidWarning)
  const close = useStore((s) => s.closeVoidWarning)
  if (!open) return null
  return (
    <Modal
      title="Photosensitivity warning"
      onClose={close}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={close} data-autofocus>
            Not now
          </button>
          <button type="button" className="btn-accent" onClick={accept}>
            I understand, install
          </button>
        </>
      }
    >
      <p className="modal-text">
        Kairo Void's visuals can include flashing lights, fast-changing colours and patterns. For a small number of people, these
        can trigger seizures, even if they have never had one before.
      </p>
      <p className="modal-text">
        If you or anyone in your family has epilepsy or has had a seizure, talk to a doctor before playing. Stop right away if you
        feel dizzy, sick or disoriented, or notice blurred vision or twitching.
      </p>
    </Modal>
  )
}
