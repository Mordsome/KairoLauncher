// Icons from the design files. All decorative: the button around each one
// carries the accessible name.

const base = { 'aria-hidden': true, focusable: false } as const

export function HomeIcon() {
  return (
    <svg {...base} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function LibraryIcon() {
  return (
    <svg {...base} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="6" rx="2" />
      <rect x="4" y="14" width="16" height="6" rx="2" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...base} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </svg>
  )
}

export function PlayIcon({ size = 24 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24">
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  )
}

export function GridIcon() {
  return (
    <svg {...base} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  )
}

export function BackIcon() {
  return (
    <svg {...base} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function TickIcon() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function MicrosoftIcon() {
  return (
    <svg {...base} width="20" height="20" viewBox="0 0 20 20">
      <rect x="1" y="1" width="8" height="8" fill="currentColor" />
      <rect x="11" y="1" width="8" height="8" fill="currentColor" opacity=".75" />
      <rect x="1" y="11" width="8" height="8" fill="currentColor" opacity=".75" />
      <rect x="11" y="11" width="8" height="8" fill="currentColor" opacity=".5" />
    </svg>
  )
}

export function MinimiseIcon() {
  return (
    <svg {...base} width="10" height="10" viewBox="0 0 10 10">
      <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...base} width="10" height="10" viewBox="0 0 10 10">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12">
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
