/**
 * The review transcript's keys and focus, apart from its rendering:
 *  - `isTextField`: a key typed in a text field is the field's (find's box);
 *  - `isControl`: Space on a focused button, link, tab or slider is that
 *    control's own (the inspector's Space plays only elsewhere);
 *  - `selectionKeyAction`: with a selection, ⌘C copies its words, Del (or
 *    Backspace) cuts it and R restores it when it touches a struck word —
 *    never while a drag is in progress, and the edits only while edits are
 *    allowed;
 *  - `focusedRunOf`: the expanded run the focused row belongs to
 *    (escape-layers.ts: Escape collapses the run that has focus).
 */
import type { KeyboardEvent } from "react"
import { focusedRun } from "@/lib/edl-review/escape-layers"
import type { ReviewRow, WordSpan } from "@/lib/edl-review/review-rows"

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")

export const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("button, a[href], [role='tab'], [role='radio'], [role='slider'], [role='button'], select") !== null

export type SelectionKeyAction = "copy" | "cut" | "restore"

export interface SelectionKeyState {
  readonly hasSelection: boolean
  readonly dragging: boolean
  readonly canEdit: boolean
  readonly touchesCut: boolean
}

export function selectionKeyAction(e: KeyboardEvent<HTMLElement>, state: SelectionKeyState): SelectionKeyAction | null {
  if (isTextField(e.target) || !state.hasSelection || state.dragging) return null
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  if (mod && key === "c") return "copy"
  if (!state.canEdit || mod || e.altKey) return null
  if (key === "delete" || key === "backspace") return "cut"
  return key === "r" && state.touchesCut ? "restore" : null
}

/** The expanded run the focused row of the transcript belongs to. */
export function focusedRunOf(scroller: HTMLElement | null, rows: readonly ReviewRow[]): { readonly run: string; readonly span: WordSpan } | undefined {
  const active = document.activeElement
  const row = scroller && active instanceof Element && scroller.contains(active) ? active.closest<HTMLElement>("[data-review-row]") : null
  const index = row ? Number(row.dataset.index) : -1
  const span = focusedRun(rows, index)
  const run = rows[index]
  return span && run?.kind === "paragraph" && run.run ? { run: run.run, span } : undefined
}
