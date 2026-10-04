/**
 * "Is a modal dialog open over the editor?" — one answer for every canvas
 * keyboard path that must stand down while one is (the shortcut gate, Escape,
 * React Flow's own delete key).
 *
 * The selector is `aria-modal`, not `role="dialog"`: non-modal Radix poppers
 * (handle popovers, tooltips, dropdowns) carry `role="dialog"` too, and must not
 * disable the editor while they are open. Radix's own modal Dialog sets the role
 * but NOT `aria-modal`, so a modal built on it sets the attribute itself
 * (`InspectorShell` does).
 */
export const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]'

export function isModalDialogOpen(doc: Document = document): boolean {
  return doc.querySelector(MODAL_DIALOG_SELECTOR) !== null
}

/** React Flow `onBeforeDelete`: never delete canvas elements from under an open
 *  modal. Its delete key reads focus, not modality — a modal that loses focus to
 *  `<body>` (a right-click on its backdrop) would otherwise let Backspace delete
 *  every selected node behind it. */
export async function refuseDeleteUnderModal(): Promise<boolean> {
  return !isModalDialogOpen()
}
