/**
 * Marks a body-portaled prompt-editor menu — the `@`/`{`/`/` suggestion popups
 * and the character/image/location/snippet chip-swap menus — so a host Radix
 * `Dialog` does NOT treat a click inside it as an "outside" interaction (which
 * would otherwise close the host dialog — e.g. the prompt quick-edit modal).
 *
 * These menus mount on `document.body`, OUTSIDE the dialog's content subtree,
 * so Radix's dismiss layer (a bubble-phase `pointerdown` listener on
 * `document`) can't tell they belong to the editor. Apply the attribute to the
 * menu's outermost portal element, and call `event.preventDefault()` from the
 * dialog's `onInteractOutside` when {@link isPromptEditorPortalInteraction}
 * returns true.
 *
 * Sibling of `scroll-lock-escape.ts` (wheel) and `BODY_MENU_CLASS`
 * (pointer-events) — this file holds the dismiss-half AND the focus-half
 * ({@link escapePromptEditorFocusTrap}) of the same "body menu inside a modal"
 * problem.
 */
export const PROMPT_EDITOR_PORTAL_ATTR = "data-prompt-editor-portal"

/** Spread onto a body-portaled menu's outermost element to mark it (JSX). */
export const PROMPT_EDITOR_PORTAL_PROPS = { [PROMPT_EDITOR_PORTAL_ATTR]: "" } as const

interface InteractOutsideEventLike {
  detail: { originalEvent: { target: EventTarget | null } }
}

/** True when a Radix `onInteractOutside` event originated inside a marked menu. */
export function isPromptEditorPortalInteraction(event: InteractOutsideEventLike): boolean {
  const target = event.detail.originalEvent.target
  return target instanceof Element && target.closest(`[${PROMPT_EDITOR_PORTAL_ATTR}]`) !== null
}

function isInsideMarkedPortal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PROMPT_EDITOR_PORTAL_ATTR}]`) !== null
}

/**
 * Focus-half of the "body menu inside a modal" problem.
 *
 * A modal Radix `Dialog`'s FocusScope installs document-level bubble
 * `focusin`/`focusout` listeners that force focus back into DialogContent
 * whenever it lands outside the content subtree. A marked body-portaled menu
 * is always outside it, so a text input inside the menu (e.g. the image
 * reference chip's "Custom…" label field) can never HOLD focus — the trap
 * snaps focus back on the very transition and keystrokes land in the dialog's
 * prompt editor instead.
 *
 * Stopping the two focus events at `document.body` — after every listener the
 * app relies on (React delegates a body portal's events on the portal
 * container itself, i.e. the same node, unaffected by stopPropagation;
 * ProseMirror listens directly on the editor element), but before Radix's
 * `document` listeners — makes the trap simply never observe the menu:
 *   - `focusin` landing INSIDE a marked menu (trap would yank it back), and
 *   - `focusout` LEAVING the dialog toward a marked menu (`relatedTarget`
 *     inside one — the trap's other yank path).
 * Focus returning from the menu to the dialog passes through untouched, so
 * the trap resumes guarding normally.
 *
 * Install while a prompt-editor-hosting dialog is open (`useEffect(() =>
 * escapePromptEditorFocusTrap(), [])` gated on the dialog actually being
 * open); harmless but pointless without a modal focus trap active.
 *
 * @returns a cleanup that removes the listeners
 */
export function escapePromptEditorFocusTrap(): () => void {
  const onFocusIn = (e: FocusEvent) => {
    if (isInsideMarkedPortal(e.target)) e.stopPropagation()
  }
  const onFocusOut = (e: FocusEvent) => {
    if (isInsideMarkedPortal(e.relatedTarget)) e.stopPropagation()
  }
  document.body.addEventListener("focusin", onFocusIn)
  document.body.addEventListener("focusout", onFocusOut)
  return () => {
    document.body.removeEventListener("focusin", onFocusIn)
    document.body.removeEventListener("focusout", onFocusOut)
  }
}
