/**
 * What an Edit Plan's stored plan (`generatedJson`) is: a Tighten EDL (an
 * object with segments), a clip set (a list of EDLs), something else (chapters),
 * or nothing yet. The review inspector opens on the first only; a clip set's
 * review is the Clip Pack inspector's (A4).
 */
export type ReviewPlanKind = "edl" | "clips" | "other" | "none"

export function planKindOf(plan: unknown): ReviewPlanKind {
  if (plan === undefined || plan === null) return "none"
  if (Array.isArray(plan)) return "clips"
  if (typeof plan === "object" && Array.isArray((plan as { segments?: unknown }).segments)) return "edl"
  return "other"
}
