import { useEffect, useRef, useState } from 'react'
import { MicrosoftIcon } from '../components/Icons'
import { useStore } from '../state/store'
import { DISCLAIMER } from './SettingsScreen'

type Step = 'idle' | 'wait' | 'done'

// Phase 1: the browser step is simulated. Phase 3 wires the real Microsoft flow.
const MOCK_NAME = 'Mordsome'

export function SignInScreen({ active }: { active: boolean }) {
  const signIn = useStore((s) => s.signIn)
  const [step, setStep] = useState<Step>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const msButton = useRef<HTMLButtonElement>(null)
  const lastStep = useRef<Step>('idle')

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // Each step swaps the card's content, so move focus along with it:
  // to the new heading, or back to the sign-in button after Cancel.
  useEffect(() => {
    const was = lastStep.current
    lastStep.current = step
    if (!active || was === step) return
    if (step === 'idle') msButton.current?.focus()
    else heading.current?.focus()
  }, [step, active])

  // Back to the first step whenever the screen is shown again (after signing out).
  useEffect(() => {
    if (active) setStep('idle')
  }, [active])

  const start = () => {
    setStep('wait')
    timer.current = setTimeout(() => setStep('done'), 2600)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    setStep('idle')
  }

  return (
    <div className="page signin" data-active={active} inert={!active}>
      <div className="signin-bg" aria-hidden="true" />
      <div className="signin-card">
        <svg className="signin-ring" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <g className={step === 'wait' ? 'ring spin' : 'ring breathe'}>
            <circle className="logo-ring" cx="60" cy="60" r="44" strokeWidth="11" strokeDasharray="226 50" strokeDashoffset="-160" />
            <path className="logo-arc" d="M43 18.5 A44 44 0 0 1 77 18.5" strokeWidth="10" />
          </g>
          <circle className={step === 'done' ? 'ring-dot ring-dot-ok' : 'ring-dot'} cx="60" cy="60" r="17" />
        </svg>

        {step === 'idle' && (
          <>
            <h1 className="signin-title">Welcome to Kairo</h1>
            <p className="signin-text">Sign in with the Microsoft account that owns Minecraft Java Edition.</p>
            <button ref={msButton} type="button" className="btn-accent signin-primary signin-ms" onClick={start}>
              <MicrosoftIcon />
              Sign in with Microsoft
            </button>
            <p className="signin-small">You type your password on Microsoft's own page, in your browser. The launcher never sees it.</p>
          </>
        )}

        {step === 'wait' && (
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

        {step === 'done' && (
          <>
            <h1 ref={heading} tabIndex={-1} className="signin-title signin-title-done">
              Hi, {MOCK_NAME}
            </h1>
            <p className="signin-text">You're signed in. Kairo, Fabric and Sodium download the first time you press Play.</p>
            <button type="button" className="btn-accent signin-primary" onClick={() => signIn({ name: MOCK_NAME })}>
              Continue
            </button>
          </>
        )}
      </div>

      <p className="signin-footer">{DISCLAIMER}</p>
    </div>
  )
}
