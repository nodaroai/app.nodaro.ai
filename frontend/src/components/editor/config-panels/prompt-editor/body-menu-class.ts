/**
 * Shared className for body-portaled INTERACTIVE menus in the prompt editor
 * (chip swap menus + suggestion lists). `pointer-events-auto` is LOAD-BEARING:
 * these menus `createPortal`/append to `document.body`, and when the editor is
 * inside a Radix `Dialog` (the quick-edit modal) the dialog sets
 * `body { pointer-events: none }`. Without `pointer-events-auto` the menu renders
 * but swallows no clicks ("see the menu, can't select"). Single source of truth so
 * a new body-menu can't silently regress. NOTE: hover-PREVIEW overlays must keep
 * `pointer-events-none` and must NOT use this.
 */
export const BODY_MENU_CLASS =
  "pointer-events-auto z-[10000] rounded-lg border border-border bg-popover shadow-lg py-1"
