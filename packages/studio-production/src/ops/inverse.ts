/**
 * `inverseOps` — the UNDO of a batch. Deferred; this is the shape it will take.
 *
 * The copilot's "revert that" is the one caller that needs it (D10): the rail
 * shows what it just did and offers to take it back, which means turning an
 * applied batch into the batch that undoes it. Not `Ctrl-Z` — the editor's undo
 * stack is session state and stays in the store — and not a document snapshot
 * either, because a snapshot restore would silently discard whatever another
 * writer did in between, and two writers holding one production open is the
 * normal case here (D4).
 *
 * ## Why it is not written yet
 *
 * An inverse is only correct if it is computed against the document the
 * operation ran ON. `rename_shot` inverts to a rename back to the OLD name,
 * which the operation itself does not carry; `remove_still_result` inverts to a
 * `restore_trashed` naming the bin entry the delete MINTED. So the signature
 * below takes the before-document, and the honest implementation is for each
 * handler to return its own inverse beside its receipt — a design decision that
 * belongs with the copilot's revert flow rather than ahead of it.
 *
 * Three operations have no inverse at all and the API has to say so rather than
 * guess: `purge_trashed` and `clear_trash` destroy media references, and
 * `mint_cast_from_chips` is not a single edit. `null` is that answer — a caller
 * that cannot undo must offer no undo, never a partial one.
 */
import type { Production } from "./production"
import type { StudioProductionOp } from "./schema"

/**
 * The batch that undoes `ops`, or `null` when the batch cannot be undone.
 *
 * Ordering, when this lands: the inverse of a batch is the inverses of its ops
 * in REVERSE order, each computed against the document its own op ran on.
 */
// TODO(copilot revert, D10): implement alongside the copilot rail. Handlers
// return their own inverse beside the receipt; this composes them in reverse.
export function inverseOps(
  _production: Production,
  _ops: ReadonlyArray<StudioProductionOp>,
): ReadonlyArray<StudioProductionOp> | null {
  return null
}
