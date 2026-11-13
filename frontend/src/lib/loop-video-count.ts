import { loopVideoRunFields } from "@nodaro/render-rules"

/** The copies a Loop's run makes when it names none (`loopVideo`'s default). */
export const LOOP_VIDEO_DEFAULT_REPEAT_COUNT = 2

/**
 * The copy count a Loop node runs in repeat mode, as every run and quote reads
 * its settings (`loopVideoRunFields`: `repeatCount`, else the older `loops` an
 * older or API-written graph may still carry), else the run's default. What
 * the node's config panel and its card show, so they show what runs.
 */
export function loopVideoRepeatCount(data: Readonly<Record<string, unknown>>): number {
  const count = loopVideoRunFields(data).repeatCount
  return typeof count === "number" && Number.isFinite(count) ? count : LOOP_VIDEO_DEFAULT_REPEAT_COUNT
}

/**
 * The settings an edit of a Loop's copy count writes: the current field, and
 * the older `loops` cleared, so one edit never leaves the two disagreeing
 * (every reader already prefers `repeatCount`).
 */
export function loopVideoRepeatCountEdit(count: number): { readonly repeatCount: number; readonly loops: undefined } {
  return { repeatCount: count, loops: undefined }
}
