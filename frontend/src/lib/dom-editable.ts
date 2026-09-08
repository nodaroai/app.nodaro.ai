/**
 * Is a key event aimed at something that edits text? Used by stages that give
 * Delete / Backspace a meaning of their own (delete the selected layer) so
 * they never eat a keystroke typed into a field.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}
