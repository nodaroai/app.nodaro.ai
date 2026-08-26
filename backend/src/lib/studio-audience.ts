/**
 * The FOURTH audience lever, and the one that is not a column.
 *
 * `settings.studio.shared === true` makes a workflow readable by
 * `GET /v1/public/workflows/:id` — no auth, whole graph, forever, to anyone
 * holding the id. It is exactly the same kind of decision as `visibility`,
 * `share_token` and `is_presentation_enabled`, and unlike those three it lives
 * inside a free-form JSON column, so neither the PATCH schema nor the row
 * policy's column pinning can see it.
 *
 * That mattered the moment editing stopped meaning ownership: a collaborator
 * with an editor grant writes `settings` on every ordinary save, and without
 * this they could publish the creator's work to the open internet in one
 * request, with no signal in the creator's share dialog (the dialog shows
 * `share_token`, which is untouched).
 *
 * So a settings write that TOUCHES the studio block is treated as what it is —
 * a change to who can reach the workflow — and asked of the same authority.
 * Detected by presence rather than by comparing values on the delta path,
 * where the stored settings are not in hand and a read would cost the hottest
 * write in the product its single round trip. A creator or workspace admin
 * passes either way, so the stricter test costs nobody anything.
 *
 * Extracted from `routes/workflows.ts` so the MCP `update_workflow_json`
 * write path — a third settings door, and one with no RLS underneath it —
 * gates the same audience bits behind the same authority the two REST PATCH
 * paths do. One rule, one place, three callers.
 */
export function touchesStudioPublishFlag(settings: unknown): boolean {
  if (typeof settings !== "object" || settings === null) return false
  // Two audience levers live in this JSON: `studio.shared` opens the
  // no-auth public read, and `presentationSettings.shareReadOnly` decides
  // whether a share-link holder may RUN (flipping it off widens who can spend
  // the owner's credits through the link). A write that mentions either is
  // touching who can reach the work.
  return "studio" in settings || "presentationSettings" in settings
}

/**
 * The two audience bits this JSON carries, read defensively and NORMALIZED to
 * their effective boolean state.
 *
 * Both are consumed as `=== true` downstream — the public read requires
 * `studio.shared === true`, the presentation run gate is `shareReadOnly &&
 * …`. So `false`, `undefined` and a missing key are one state, and only a
 * transition into or out of `true` is a real audience change. Comparing raw
 * values instead would flag erasing an already-`false` flag as a change and
 * refuse an ordinary save.
 */
export function readAudienceBits(settings: unknown): { shared: boolean; shareReadOnly: boolean } {
  const s = settings as
    | { studio?: { shared?: unknown }; presentationSettings?: { shareReadOnly?: unknown } }
    | null
    | undefined
  return {
    shared: s?.studio?.shared === true,
    shareReadOnly: s?.presentationSettings?.shareReadOnly === true,
  }
}

/**
 * Whether a full-body settings write would CHANGE either audience lever.
 *
 * No early-out on "the write does not mention them": the full-body path
 * REPLACES the whole settings object, so a write that omits the keys erases
 * them — and erasing `presentationSettings.shareReadOnly` flips a view-only
 * share link into a runnable one. Omission is a change, and a change in either
 * direction is asked of the audience authority. The real editor client
 * round-trips the whole object, so an ordinary save sends the same values and
 * diffs to false.
 */
export function changesStudioPublishFlag(next: unknown, stored: unknown): boolean {
  const a = readAudienceBits(next)
  const b = readAudienceBits(stored)
  return a.shared !== b.shared || a.shareReadOnly !== b.shareReadOnly
}
