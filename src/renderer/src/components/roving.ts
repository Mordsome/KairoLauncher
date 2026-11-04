import type { KeyboardEvent } from 'react'

/**
 * Arrow-key movement inside a radio group or tab list, so the group is one
 * Tab stop and the arrows move between its items (WAI-ARIA pattern).
 * With `select`, moving also activates the item, as native radios do.
 */
export function rovingKeyDown(event: KeyboardEvent<HTMLElement>, options: { select?: boolean; columns?: number } = {}) {
  const container = event.currentTarget
  const items = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"],[role="tab"]')).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.closest('[data-roving]') === container
  )
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index < 0) return

  const cols = options.columns ?? 1
  let next = index
  switch (event.key) {
    case 'ArrowDown':
      next = index + cols
      break
    case 'ArrowUp':
      next = index - cols
      break
    case 'ArrowRight':
      next = index + 1
      break
    case 'ArrowLeft':
      next = index - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = items.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  next = Math.max(0, Math.min(items.length - 1, next))
  const target = items[next]
  if (!target) return
  target.focus()
  if (options.select) target.click()
}

/** Tab index for an item in a roving group: only the active one is a Tab stop. */
export function rovingTabIndex(active: boolean): 0 | -1 {
  return active ? 0 : -1
}
