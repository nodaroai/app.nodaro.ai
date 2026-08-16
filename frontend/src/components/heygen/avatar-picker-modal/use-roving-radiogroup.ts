// Keyboard behaviour for the modal's radiogroups (person cards, look chips,
// facet chips): ONE tab stop per group and the arrow keys move both focus and
// the selection, per the ARIA radio pattern — `role="radio"` alone is only a
// label. Home / End jump to the ends; Enter / Space still work because every
// radio is a <button>.

import { useCallback, useRef, type KeyboardEvent } from "react"

export interface RovingItemProps {
  readonly ref: (el: HTMLElement | null) => void
  readonly tabIndex: 0 | -1
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * @param count       how many radios the group renders right now
 * @param activeIndex the selected radio (−1 for none → the first is the tab stop)
 * @param onActivate  called with the index an arrow key moved to
 */
export function useRovingRadiogroup(
  count: number,
  activeIndex: number,
  onActivate: (index: number) => void,
): (index: number) => RovingItemProps {
  const refs = useRef<Array<HTMLElement | null>>([])
  const stop = activeIndex >= 0 && activeIndex < count ? activeIndex : 0

  return useCallback(
    (index: number): RovingItemProps => ({
      ref: (el) => {
        refs.current[index] = el
      },
      tabIndex: index === stop ? 0 : -1,
      onKeyDown: (e) => {
        let next: number
        switch (e.key) {
          case "ArrowRight":
          case "ArrowDown":
            next = (index + 1) % count
            break
          case "ArrowLeft":
          case "ArrowUp":
            next = (index - 1 + count) % count
            break
          case "Home":
            next = 0
            break
          case "End":
            next = count - 1
            break
          default:
            return
        }
        e.preventDefault()
        refs.current[next]?.focus()
        onActivate(next)
      },
    }),
    [count, stop, onActivate],
  )
}
