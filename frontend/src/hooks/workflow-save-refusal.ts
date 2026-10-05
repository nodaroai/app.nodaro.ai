/**
 * Why did a compare-and-swap save match zero rows — and what the editor does
 * once it knows.
 *
 * The editor saves straight to the row, guarded by `WHERE version = <the
 * version this tab loaded>`. A miss used to mean exactly one thing to the
 * editor — "somebody else wrote first" — and it said so: "Workflow was updated
 * on another device". But the row policies filter an UPDATE the same silent
 * way. A row the caller may READ and may not WRITE also matches zero rows, with
 * no error, and the token it was compared against is still the right one.
 *
 * That is not a hypothetical. The SELECT policy lets a platform admin read
 * every workflow; the UPDATE policy excludes admins on purpose ("an admin edits
 * through the app, on the service role … never from a browser", migration 338).
 * So an admin who opens somebody else's workflow gets a canvas that looks
 * writable and a save that can never land. Reported as a device conflict it
 * sent two fixes after a realtime race that was not the cause, and — because
 * the re-read `updated_at` equalled the cursor, so nothing looked "ahead" —
 * autosave never paused: one idle tab re-sent a 120 KB graph every five
 * seconds for a day.
 *
 * The miss is followed by a re-read of the row, and that read is enough to tell
 * the cases apart without the browser knowing a single access rule:
 *
 *   - the token this tab sent is STILL the row's token → nobody else wrote, so
 *     the write was turned away: `refused`
 *   - the token moved → a real concurrent write: `conflict`
 *   - no row came back → deleted, or the read itself failed: `unknown`, which
 *     keeps the conflict handling it always had
 *
 * The re-read has to see at least what the failed UPDATE saw. It does: both go
 * to the primary. Pointed at a lagging replica, a real conflict would read back
 * as the old token and be called a refusal.
 */
export type ZeroRowSaveCause = "refused" | "conflict" | "unknown"

/** The CAS token a save was sent with — whichever of the two it had. */
export interface SentSaveToken {
  readonly version: number | null
  readonly updatedAt: string | null
}

export function classifyZeroRowSave(
  sent: SentSaveToken,
  current: { readonly version?: unknown; readonly updated_at?: unknown } | null | undefined,
): ZeroRowSaveCause {
  if (!current) return "unknown"
  // Compare on the token that was actually in the WHERE clause. `updated_at`
  // is deliberately ignored once a version was sent: a thumbnail or share
  // toggle moves it without changing content, and the integer is what the
  // UPDATE was filtered on.
  if (sent.version != null) return current.version === sent.version ? "refused" : "conflict"
  if (sent.updatedAt != null) return current.updated_at === sent.updatedAt ? "refused" : "conflict"
  // Nothing was compared (`WHERE id = …` alone) and the row is still there to
  // be read: the only thing left that can match zero rows is the write policy.
  return "refused"
}

/**
 * The slice of the workflow store a refusal is read from.
 *
 * `saveRefusedFor` holds the ID of the workflow whose save was refused, never a
 * bare flag — so a verdict can only ever apply to the workflow it was reached
 * for. A save's answer can land after the editor has moved on (a large graph
 * takes seconds to upload), and a flag set late would silence the saves of
 * whatever is open by then: work lost with nothing on screen to say so. Keyed
 * by id, a late verdict is inert by construction rather than by everyone
 * remembering to check.
 */
export interface SaveRefusalState {
  readonly workflowId: string | null
  readonly saveRefusedFor?: string | null
}

/** Was a write to the workflow open RIGHT NOW refused? */
export function isSaveRefused(state: SaveRefusalState): boolean {
  return state.saveRefusedFor != null && state.saveRefusedFor === state.workflowId
}

/**
 * Is there unsaved work that a save could still keep?
 *
 * What the in-app "unsaved changes" dialog asks before it opens. A canvas
 * whose saves are refused stays dirty for good, and that dialog's Save button
 * is an offer the editor cannot honour — the person has already been told, on
 * screen, that nothing here is kept and how to take a copy. A read-only canvas
 * is the same offer: dragging its nodes still dirties it, and its save
 * answers success without writing anything (`useWorkflowPersistence`), so the
 * dialog would report a save that kept nothing. That holds whether or not its
 * saves are also refused: a Studio workflow has none refused, and nor has a
 * `view` load whose access check failed or has not answered yet. The
 * browser's own tab-close prompt is a different thing and still asks
 * `isDirty`: it offers nothing, so it promises nothing, and it is the last
 * guard on results a copy could still keep.
 */
export function hasSavableChanges(
  state: SaveRefusalState & { readonly isDirty: boolean; readonly isReadOnly: boolean },
): boolean {
  return state.isDirty && !state.isReadOnly && !isSaveRefused(state)
}
