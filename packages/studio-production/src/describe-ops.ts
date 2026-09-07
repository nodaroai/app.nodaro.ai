/**
 * `describeOps` — a batch of operations, in the words a person reads.
 *
 * The copilot proposes before it writes: it shows the batch it intends to apply
 * and waits (D10), and the ops route echoes the same lines back as receipts. So
 * there are two moments a production edit has to be put into English, and only
 * one place that does it — here, by APPLYING the batch to a throwaway copy and
 * collecting the receipts the handlers themselves wrote.
 *
 * That is the whole design. A separate renderer — a table from op name to a
 * template — would be a second description of what an operation does, and the
 * two would drift the first time a handler changed its behaviour without
 * changing its name. Generating the sentence from the work means an operation
 * cannot describe itself as one thing and do another, and it is also the only
 * way to say "take 2 of Rooftop dawn" rather than "a result of a shot": the
 * wording needs the document, and the handler is what has it.
 *
 * Describing is FREE and changes nothing. The returned document is discarded,
 * every handler is copy-on-write, and the preview context below has no clock and
 * no randomness, so describing a batch twice reads the same both times.
 */
import { applyOps } from "./ops/apply"
import type { Production } from "./ops/production"
import type { OpContext } from "./ops/types"

/**
 * The instant a PREVIEW is dated at.
 *
 * A description is not a write, so nothing it produces is ever persisted — but
 * a handler still asks `ctx` for the time (a bin entry's `deletedAt`, a
 * marker's `startedAt`), and reading a real clock would make the same batch
 * describe itself differently on two calls. A fixed epoch is the honest answer:
 * this document is not going to be saved.
 */
const PREVIEW_NOW = "1970-01-01T00:00:00.000Z"

/**
 * A context for describing: no clock, and ids that only exist for this preview.
 *
 * Fresh per call, so the counter starts at 1 every time and two descriptions of
 * the same batch are identical strings.
 */
function previewContext(): OpContext {
  let minted = 0
  return {
    now: PREVIEW_NOW,
    mintId: () => `preview-${++minted}`,
  }
}

/**
 * One line per operation, in order — what this batch would do to this document.
 *
 * @param production the document to describe the batch AGAINST; never mutated
 * @param ops the batch, unvalidated (the same shape `applyOps` takes)
 * @param ctx the real context, when the caller has one — a preview context is
 *   used otherwise, and the returned lines are the same either way for every
 *   operation that does not mint an id
 * @throws {OpError} with `opIndex` set, exactly as `applyOps` would. A batch
 *   that cannot be applied cannot be honestly described, and offering a
 *   confirmation for an edit that is going to be refused is worse than saying
 *   so now.
 */
export function describeOps(
  production: Production,
  ops: ReadonlyArray<unknown>,
  ctx: OpContext = previewContext(),
): string[] {
  return applyOps(production, ops, ctx).receipts.map(
    (receipt) => receipt.summary,
  )
}
