import type { KeyboardEvent } from "react"

/**
 * Props that make a non-button element (a card, a drop zone) work like a
 * button for keyboard and screen-reader users (WCAG 2.1.1, 4.1.2): it is in
 * the Tab order, announced as a button, and Enter or Space activate it.
 * Only for an element with NO controls inside it; a card with buttons of its
 * own takes a <CoverButton> instead, so no control sits inside another.
 */
export function pressable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        onActivate()
      }
    },
  }
}
