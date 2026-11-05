import { useEffect, useRef, useState } from 'react'
import type { AuthErrorInfo } from '../../../shared/api'
import { MicrosoftIcon } from '../components/Icons'
import { useStore } from '../state/store'
import { DISCLAIMER } from './SettingsScreen'

type Step = { kind: 'idle' } | { kind: 'wait' } | { kind: 'done'; name: string } | { kind: 'error'; error: AuthErrorInfo }

export function SignInScreen({ active }: { active: boolean }) {
  const mode = useStore((s) => s.signInMode)
  const devOfflineName = useStore((s) => s.info?.devOfflineName ?? null)
  const setAccounts = useStore((s) => s.setAccounts)
  const useDevOffline = useStore((s) => s.useDevOffline)
  const go = useStore((s) => s.go)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const heading = useRef<HTMLHeadingElement>(null)
  const msButton = useRef<HTMLButtonElement>(null)
  const lastKind = useRef<Step['kind']>('idle')
  const cancelled = useRef(false)

  // Each step swaps the card's content, so move focus along with it.
  useEffect(() => {
    const was = lastKind.current
    lastKind.current = step.kind
    if (!active || was === step.kind) return
    if (step.kind === 'idle') msButton.current?.focus()
    else heading.current?.focus()
  }, [step, active])

  // Start fresh whenever the screen is shown again.
  useEffect(() => {
    if (active) setStep({ kind: 'idle' })
  }, [active])

  const start = async () => {
    cancelled.current = false
    setStep({ kind: 'wait' })
    const result = await window.kairo.auth.signIn()
    if (result.ok) {
      setAccounts(result.state)
      setStep({ kind: 'done', name: result.account.name })
    } else if (cancelled.current || result.error.code === 'cancelled') {
      setStep(cancelled.current ? { kind: 'idle' } : { kind: 'error', error: result.error })
    } else {
      setStep({ kind: 'error', error: result.error })
    }
  }

  const cancel = () => {
    cancelled.current = true
    void window.kairo.auth.cancel()
  }

  const finish = () => go(mode === 'add' ? 'settings' : 'home')
  const ringClass = step.kind === 'wait' ? 'ring spin' : 'ring breathe'
  const dotClass = step.kind === 'done' ? 'ring-dot ring-dot-ok' : step.kind === 'error' ? 'ring-dot ring-dot-error' : 'ring-dot'

  return (
    <div className="page signin" data-active={active} inert={!active}>
      <div className="signin-bg" aria-hidden="true" />
      {mode === 'add' && step.kind !== 'wait' && (
        <button type="button" className="btn-ghost signin-back" onClick={() => go('settings')}>
          Back to Settings
        </button>
      )}
      <div className="signin-card">
        <svg className="signin-ring" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <g className={ringClass}>
            <circle className="logo-ring" cx="60" cy="60" r="44" strokeWidth="11" strokeDasharray="226 50" strokeDashoffset="-160" />
            <path className="logo-arc" d="M43 18.5 A44 44 0 0 1 77 18.5" strokeWidth="10" />
          </g>
          <circle className={dotClass} cx="60" cy="60" r="17" />
        </svg>

        {step.kind === 'idle' && (
          <>
            <h1 className="signin-title">{mode === 'add' ? 'Add an account' : 'Welcome to Kairo'}</h1>
            <p className="signin-text">Sign in with the Microsoft account that owns Minecraft Java Edition.</p>
            <button ref={msButton} type="button" className="btn-accent signin-primary signin-ms" onClick={() => void start()}>
              <MicrosoftIcon />
              Sign in with Microsoft
            </button>
            <p className="signin-small">You type your password on Microsoft's own page, in your browser. The launcher never sees it.</p>
            {devOfflineName && mode === 'first' && (
              <button type="button" className="link-button" onClick={() => useDevOffline(devOfflineName)}>
                Continue with the offline dev account
              </button>
            )}
          </>
        )}

        {step.kind === 'wait' && (
          <>
            <h1 ref={heading} tabIndex={-1} className="signin-title signin-title-wait">
              Finish in your browser
            </h1>
            <p className="signin-text">A Microsoft sign-in page opened in your browser. Come back here when it says you're done.</p>
            <button type="button" className="btn-ghost signin-cancel" onClick={cancel}>
              Cancel
            </button>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <h1 ref={heading} tabIndex={-1} className="signin-title signin-title-done">
              Hi, {step.name}
            </h1>
            <p className="signin-text">
              {mode === 'add'
                ? 'This account is added and now plays. You can switch accounts in Settings.'
                : "You're signed in. Kairo, Fabric and Sodium download the first time you press Play."}
            </p>
            <button type="button" className="btn-accent signin-primary" onClick={finish}>
              Continue
            </button>
          </>
        )}

        {step.kind === 'error' && (
          <>
            <div role="alert" className="signin-alert">
              <h1 ref={heading} tabIndex={-1} className="signin-title signin-title-wait">
                {step.error.title}
              </h1>
              <p className="signin-text">{step.error.message}</p>
            </div>
            <div className="signin-actions">
              <button type="button" className="btn-accent signin-retry" onClick={() => void start()}>
                Try again
              </button>
              {step.error.help && (
                <button type="button" className="btn-ghost" onClick={() => void window.kairo.app.openExternal(step.error.help!.url)}>
                  {step.error.help.label}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <p className="signin-footer">{DISCLAIMER}</p>
    </div>
  )
}
