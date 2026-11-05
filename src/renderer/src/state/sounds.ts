import { useEffect } from 'react'
import { useStore } from './store'

let audio: AudioContext | null = null

/** A short, quiet click made on the spot (no sound files). */
function click(): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(1150, now)
    tone.frequency.exponentialRampToValueAtTime(620, now + 0.05)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
    tone.connect(gain).connect(audio.destination)
    tone.start(now)
    tone.stop(now + 0.08)
  } catch {
    // No audio device: stay silent.
  }
}

/** Clicks on buttons and switches while "Interface sounds" is on. */
export function useInterfaceSounds(): void {
  const on = useStore((s) => s.settings.sounds)
  useEffect(() => {
    if (!on) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null
      const control = target?.closest('button, [role="switch"], input[type="checkbox"]')
      if (control && !(control as HTMLButtonElement).disabled) click()
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [on])
}
