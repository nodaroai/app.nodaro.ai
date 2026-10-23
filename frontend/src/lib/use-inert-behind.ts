import { useEffect, type RefObject } from "react"

/** A <body> child marked with this stays usable behind an open editor (the toasts). */
export const KEEP_INTERACTIVE_ATTR = "data-keep-interactive"

/**
 * While a full-screen editor portaled to <body> is open, the page behind it is
 * `inert`: Tab, a screen reader's reading and clicks stay inside the editor
 * (WCAG 2.4.3 Focus Order, 1.3.2), and focus moves into it; on leaving, the
 * marks come off and focus returns to where it was (the button that opened
 * it). Layers a library opens later (its pickers, popups) are untouched, since
 * only what is behind it on open is marked, and so is a body child marked
 * `data-keep-interactive` (the toasts, which must still be announced).
 *
 * One editor is open at a time today; two nested ones restore correctly only
 * when the inner one closes first (it skips what the outer one marked).
 */
export function useInertBehind(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = root.current
    if (!node) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const behind = [...document.body.children].filter(
      (el) => el !== node && !el.contains(node) && !el.hasAttribute("inert") && !el.hasAttribute(KEEP_INTERACTIVE_ATTR),
    )
    for (const el of behind) el.setAttribute("inert", "")
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true })
    return () => {
      for (const el of behind) el.removeAttribute("inert")
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [root])
}
