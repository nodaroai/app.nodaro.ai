/**
 * Who a Tab press belongs to in the editor (WCAG 2.1.1 Keyboard, 2.1.2 No
 * Keyboard Trap). Tab is the editor's Add Node shortcut, but it is also how a
 * keyboard user moves between controls, so it opens Add Node only when the
 * person's last pointer press was on the canvas (a node, the pane, or anything
 * inside a node) or in the Add Node popup, and focus is still there or on the
 * page itself: the mouse user who clicks the canvas, then presses Tab.
 *
 * "The page itself" is any element that CONTAINS the canvas: body, html and
 * the focusable `<main tabindex="-1">` the skip link targets. A click on the
 * empty pane (which is not focusable) moves focus to that `<main>`, so a
 * container must count as the page, not as a control outside the canvas. A
 * toolbar or sidebar button never contains the canvas.
 *
 * A keyboard user who Tabs ONTO the canvas never pressed it, so Tab keeps
 * moving them forward, through the nodes and their controls and out again (a
 * forward Tab inside the canvas used to open Add Node and trap them there).
 * Everywhere else (the toolbar, the sidebar, a panel, a dialog) Tab moves
 * focus as on any page, and Shift+Tab never matches the shortcut. A keyboard
 * user adds a node from the toolbar's Add Node button.
 */

const CANVAS_SELECTOR = ".react-flow"
/** `data-canvas-tab-scope` marks a surface that belongs to canvas work though it renders outside it (the Add Node popup). */
const CANVAS_SCOPE_SELECTOR = `${CANVAS_SELECTOR}, [data-canvas-tab-scope]`

const inCanvasScope = (el: Element): boolean => el.closest(CANVAS_SCOPE_SELECTOR) !== null
const isPageItself = (el: Element): boolean =>
  el === el.ownerDocument.body || el === el.ownerDocument.documentElement || el.querySelector(CANVAS_SELECTOR) !== null

export function tabOpensAddNode(target: EventTarget | null, lastPointerOnCanvas: boolean): boolean {
  if (!lastPointerOnCanvas) return false
  const el = target instanceof Element ? target : null
  return !el || isPageItself(el) || inCanvasScope(el)
}

/**
 * Remembers whether the last pointer press was on the canvas (or the Add Node
 * popup). A press elsewhere, or focus moving to a control outside the canvas,
 * forgets it; focus landing on the page itself (a container of the canvas)
 * does not. Returns the reader and a cleanup.
 */
export function trackCanvasPointer(doc: Document): { readonly onCanvas: () => boolean; readonly dispose: () => void } {
  let onCanvas = false
  const onPointerDown = (event: Event) => {
    const el = event.target instanceof Element ? event.target : null
    onCanvas = !!el && inCanvasScope(el)
  }
  const onFocusIn = (event: Event) => {
    const el = event.target instanceof Element ? event.target : null
    if (el && !isPageItself(el) && !inCanvasScope(el)) onCanvas = false
  }
  doc.addEventListener("pointerdown", onPointerDown, true)
  doc.addEventListener("focusin", onFocusIn, true)
  return {
    onCanvas: () => onCanvas,
    dispose: () => {
      doc.removeEventListener("pointerdown", onPointerDown, true)
      doc.removeEventListener("focusin", onFocusIn, true)
    },
  }
}
