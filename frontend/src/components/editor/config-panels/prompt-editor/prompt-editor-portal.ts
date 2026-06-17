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
 * (pointer-events) — the dismiss-half of the same "body menu inside a modal"
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
