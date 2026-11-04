/** The Kairo ring. Colours follow the theme. */
export function Logo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Kairo">
      <circle className="logo-ring" cx="20" cy="20" r="14" strokeWidth="4.5" strokeDasharray="72 16" strokeDashoffset="-52" />
      <path className="logo-arc" d="M14.5 7.6 A14 14 0 0 1 25.5 7.6" strokeWidth="4" />
      <circle className="logo-dot" cx="20" cy="20" r="5.6" />
    </svg>
  )
}
