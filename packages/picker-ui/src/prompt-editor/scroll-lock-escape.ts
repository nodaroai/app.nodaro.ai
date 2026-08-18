/**
 * Scroll-half sibling of `BODY_MENU_CLASS` (see `body-menu-class.ts`).
 *
 * The prompt editor's menus mount on `document.body` — suggestion popups via
 * `createRoot` (`floating-suggestion-renderer.tsx`), chip-swap menus via
 * `createPortal` (`*-ref-view.tsx`, `snippet-pill-view.tsx`). When the editor
 * is inside a Radix `Dialog` (the quick-edit modal), the dialog's
 * `react-remove-scroll` installs a non-passive `wheel`/`touchmove` listener on
 * `document` that `preventDefault()`s any scroll whose target is OUTSIDE the
 * dialog's lock subtree (`shards: [contentRef]`). A body-mounted menu is always
 * outside it, so the menu's own `overflow-y-auto` silently can't scroll — the
 * scroll analog of the "see the menu, can't click" bug that `BODY_MENU_CLASS`
 * solved for pointer-events.
 *
 * `react-remove-scroll` listens on `document` in the BUBBLE phase, so stopping
 * the event at the menu (before it bubbles up to `document`) lets the browser
 * still perform its default scroll on the menu while `react-remove-scroll`
 * never sees it. We deliberately do NOT `preventDefault` — native scrolling
 * (incl. trackpad momentum) must proceed.
 *
 * The listener must run on the NATIVE event: React's synthetic `onWheel` is
 * passive and propagates along the React tree, not the native DOM path that
 * `react-remove-scroll` listens on. Hence `addEventListener`, not `onWheel`.
 *
 * Harmless outside a modal (no `react-remove-scroll` active): the wheel simply
 * doesn't bubble past the menu, which nothing else needs.
 *
 * @param el the scrollable menu container (the element with `overflow-y-auto`)
 * @returns a cleanup that removes the listeners
 */
export function escapeScrollLock(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation()
  el.addEventListener("wheel", stop, { passive: true })
  el.addEventListener("touchmove", stop, { passive: true })
  return () => {
    el.removeEventListener("wheel", stop)
    el.removeEventListener("touchmove", stop)
  }
}
