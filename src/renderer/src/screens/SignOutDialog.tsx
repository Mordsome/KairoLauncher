import { Modal } from '../components/Modal'
import { useStore } from '../state/store'

function secureStoreName(platform: string | undefined): string {
  if (platform === 'darwin') return 'the macOS Keychain'
  if (platform === 'linux') return "your desktop's keyring"
  return 'Windows Credential Manager'
}

/** "Sign out of …?" before an account's sign-in is deleted. Opened from the account menu or Settings. */
export function SignOutDialog() {
  const uuid = useStore((s) => s.signOutAsk)
  const accounts = useStore((s) => s.accounts)
  const ask = useStore((s) => s.askSignOut)
  const signOut = useStore((s) => s.signOut)
  const running = useStore((s) => s.game.phase !== 'idle')
  const platform = useStore((s) => s.info?.platform)
  const account = accounts?.accounts.find((a) => a.uuid === uuid)
  if (!uuid || !account) return null

  const isActive = accounts?.active === uuid
  const last = accounts?.accounts.length === 1
  const close = () => ask(null)

  return (
    <Modal
      title={`Sign out of ${account.name}?`}
      onClose={close}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={close} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={() => signOut(uuid)}>
            Sign out
          </button>
        </>
      }
    >
      <p className="modal-note">
        The launcher deletes this account's sign-in from {secureStoreName(platform)}. To play as {account.name} again, you sign in
        with Microsoft again.
      </p>
      <p className="modal-note">Your installs, worlds, mods and settings stay as they are.</p>
      {isActive && running && (
        <p className="detail-error" role="alert">
          <b>Minecraft is running as {account.name}.</b> Signing out closes the game.
        </p>
      )}
      {last && <p className="modal-note">It's the only account, so the launcher goes back to the sign-in screen.</p>}
    </Modal>
  )
}
