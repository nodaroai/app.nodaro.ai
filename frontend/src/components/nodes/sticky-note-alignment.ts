import type { StickyNoteData } from "@/types/nodes"

/** How a note's text sits, as CSS `text-align` takes it. */
export type StickyTextAlign = "start" | "left" | "center" | "right"

/**
 * The alignment a note renders with.
 *
 * New notes default to `"start"`, the logical side: a Hebrew note sits right
 * and an English one left, each by its own text direction (title and body
 * carry their own `dir`). Notes saved before that carry `alignment: "left"`
 * from the old default, which cannot be told apart from a deliberate pick of
 * Left — so a stored `"left"` counts as a pick only when `alignmentChosen`
 * says the user clicked it (recorded on every click from now on); otherwise it
 * renders as `"start"`. `"center"` and `"right"` were never a default, so they
 * are always honoured. No data migration: a missing flag means "default".
 */
export function effectiveStickyAlignment(
  data: Pick<Partial<StickyNoteData>, "alignment" | "alignmentChosen">,
): StickyTextAlign {
  const stored = data.alignment
  if (stored === "center" || stored === "right") return stored
  if (stored === "left" && data.alignmentChosen === true) return "left"
  return "start"
}

/**
 * Which toolbar button lights up: the physical side the text actually sits
 * on, so `"start"` shows as Right on a right-to-left note and Left otherwise.
 * `textDir` is the note's text direction (`undefined` = no letter yet, which
 * on the canvas — pinned `direction: ltr` — lays out left to right).
 */
export function stickyAlignmentButton(
  align: StickyTextAlign,
  textDir: "rtl" | "ltr" | undefined,
): "left" | "center" | "right" {
  if (align !== "start") return align
  return textDir === "rtl" ? "right" : "left"
}
