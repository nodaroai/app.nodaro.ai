import { useEffect, type RefObject } from "react"

/**
 * Calls `onOutside` when a `mousedown` lands outside `ref`'s element.
 *
 * The editor's custom fixed panels, menus, and dropdowns (add-node popup,
 * context menus, search/marketplace modals, the auto-connect dialog) are
 * deliberately NOT Radix Dialog/Popover, so they don't get outside-dismiss for
 * free. This is the single home for the document-`mousedown` pattern they all
 * previously hand-rolled.
 *
 * Pass `enabled=false` to detach while the surface is closed (replaces the
 * `if (!open) return` guard the inline effects used). `mousedown` (not `click`)
 * is intentional and matches the prior behavior: a surface that mounts in
 * response to a click won't self-close, because that click's `mousedown`
 * already fired before this listener attaches.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [ref, onOutside, enabled])
}
