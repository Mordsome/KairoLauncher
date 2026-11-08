import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
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
  onClose(): void
}

/**
 * A small menu (the ⋯ button, or right-click). Arrow keys move, Enter picks,
 * Escape, Tab or a click outside closes it, and it always stays inside the window.
 */
export function Menu({ label, items, at, onClose }: Props) {
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
    el.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()

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
    const list = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
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
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
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
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
