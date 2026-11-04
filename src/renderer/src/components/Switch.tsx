interface Props {
  checked: boolean
  label: string
  onChange(next: boolean): void
}

export function Switch({ checked, label, onChange }: Props) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  )
}

interface RowProps extends Props {
  description: string
}

/** A settings row: name and plain explanation on the left, switch on the right. */
export function SwitchRow({ checked, label, description, onChange }: RowProps) {
  return (
    <div className="setting-row">
      <span className="setting-text">
        <span className="setting-name">{label}</span>
        <span className="setting-desc">{description}</span>
      </span>
      <Switch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}
