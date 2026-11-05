import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
  /** Buttons at the bottom. */
  actions?: ReactNode
  wide?: boolean
}

/**
 * A dialog over the launcher: focus moves in and stays in, Escape closes it,
 * and focus goes back to where it was when it closes. It renders at the top
 * of the page, above every screen.
 */
export function Modal({ title, onClose, children, actions, wide }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not([disabled]), [tabindex="0"]')
    first?.focus()
    return () => before?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const items = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"], textarea')).filter(
      (el) => el.offsetParent !== null
    )
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body
  )
}
