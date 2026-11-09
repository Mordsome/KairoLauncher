import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TickIcon } from './Icons'

export interface MenuItem {
  label: string
  /** A second, smaller line. */
  hint?: string
  /** Drawn before the label (an account's head). */
  icon?: ReactNode
  /** One of a set (a sort order, the account that plays): shown with a tick. */
  checked?: boolean
  onSelect(): void
  disabled?: boolean
  danger?: boolean
  /** Draws a line above this item. */
  separated?: boolean
}

interface Props {
  label: string
  items: MenuItem[]
  /** Where it opens: the cursor (right-click) or under a button. */
  at: { x: number; y: number }
  /** Shown above the items. */
  header?: ReactNode
  onClose(): void
}

/**
 * A small menu (the ⋯ button, or right-click). Arrow keys move, Enter picks,
 * Escape, Tab or a click outside closes it, and it always stays inside the window.
 */
const ITEM = '[role^="menuitem"]'

export function Menu({ label, items, at, onClose, header }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const before = document.activeElement as HTMLElement | null
    const r = el.getBoundingClientRect()
    const x = Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8))
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y
    setPos({ x, y })
    ;(el.querySelector<HTMLElement>(`${ITEM}[aria-checked="true"]:not([disabled])`) ?? el.querySelector<HTMLElement>(`${ITEM}:not([disabled])`))?.focus()

    const outside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) onClose()
    }
    const blur = () => onClose()
    // Next tick, so the click that opened the menu doesn't close it.
    const t = setTimeout(() => document.addEventListener('pointerdown', outside, true))
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
      if (before?.isConnected && el.contains(document.activeElement)) before.focus()
    }
  }, [at, onClose])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(box.current?.querySelectorAll<HTMLButtonElement>(`${ITEM}:not([disabled])`) ?? [])
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number) => {
      e.preventDefault()
      list[(n + list.length) % list.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      // Only the menu closes, not a dialog it was opened from (React passes keys up through portals).
      e.stopPropagation()
      onClose()
    }
  }

  return createPortal(
    <div
      ref={box}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {header}
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={item.checked}
          tabIndex={-1}
          className="menu-item"
          data-danger={item.danger || undefined}
          data-separated={item.separated || undefined}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.icon && <span className="menu-icon">{item.icon}</span>}
          <span className="menu-text">
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </span>
          {item.checked !== undefined && <span className="menu-tick">{item.checked && <TickIcon />}</span>}
        </button>
      ))}
    </div>,
    document.body
  )
}
