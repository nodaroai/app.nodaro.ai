"use client"

import { useEffect, useRef, type RefObject } from "react"
import { escapeScrollLock } from "./scroll-lock-escape"

/**
 * Shared open-menu lifecycle for the prompt editor's body-portaled chip-swap
 * menus (the character / image / location / snippet pill views). While the menu
 * is open it:
 *
 *  1. Dismisses on outside `pointerdown` (capture phase, so it fires before any
 *     inner `stopPropagation` — e.g. ProseMirror's own mousedown handlers —
 *     hides the click from us) or on Escape.
 *  2. Escapes the Radix Dialog modal's `react-remove-scroll` lock so the menu's
 *     own `overflow-y-auto` can scroll (see `scroll-lock-escape.ts`; the
 *     scroll-half sibling of `BODY_MENU_CLASS`).
 *
 * Centralizing both keeps the four pill views from drifting and means a new
 * body-portaled menu gets dismiss + scrollability from a single call — matching
 * the single-source-of-truth intent `body-menu-class.ts` documents.
 *
 * @param menuRef     the menu's scroll container (the `overflow-y-auto` element)
 * @param menuAnchor  the open-state anchor rect, or `null` when the menu is closed
 * @param onDismiss   called on outside-click / Escape (typically clears the anchor)
 */
export function useBodyMenuDismiss(
  menuRef: RefObject<HTMLElement | null>,
  menuAnchor: DOMRect | null,
  onDismiss: () => void,
): void {
  // Hold the latest onDismiss in a ref so the listeners (re)subscribe only when
  // the menu opens/closes, not on every render — mirrors the previous per-view
  // effect, which closed over stable state setters defined inside it.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!menuAnchor) return
    function onDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      onDismissRef.current()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismissRef.current()
    }
    window.addEventListener("pointerdown", onDown, { capture: true })
    document.addEventListener("keydown", onKey)
    const detachScroll = menuRef.current ? escapeScrollLock(menuRef.current) : undefined
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true })
      document.removeEventListener("keydown", onKey)
      detachScroll?.()
    }
  }, [menuAnchor, menuRef])
}
