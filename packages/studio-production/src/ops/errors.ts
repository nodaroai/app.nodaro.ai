/**
 * The ONE failure shape an operation raises.
 *
 * Every handler is total on a valid document, so the only way it can fail is a
 * caller mistake: an id that names nothing, an argument the schema let through
 * but the document refuses, an op this build does not implement yet. Each of
 * those is the caller's to fix, which is why they surface as a typed code with
 * the offending op's INDEX rather than as a generic throw — a batch is atomic
 * (D3.3), so the answer a caller needs is "which op, and why", never "somewhere
 * in there".
 *
 * Handlers throw and never catch: swallowing an error would write a partial
 * batch, which is the one thing `applyOps` promises cannot happen.
 */

/**
 * Why an operation was refused.
 *
 * - `op_target_missing` — the id/key the op addresses is not in the document
 *   (an unknown shot, folder, cut, trash entry, cast key, or `ResultKey`).
 * - `op_invalid` — the args parsed but the document refuses them (an index out
 *   of range, a `null` where the stage requires a value, a duplicate id).
 * - `op_not_implemented` — the op exists in the vocabulary but not in this
 *   build (`land_job` until P1.2 lands its marker readers).
 * - `op_conflict` — the op contradicts state another op in the same batch
 *   established (a shot inserted and removed in one batch, an id minted twice).
 */
export type OpErrorCode =
  | "op_target_missing"
  | "op_invalid"
  | "op_not_implemented"
  | "op_conflict"

/**
 * A refused operation.
 *
 * `opIndex` is absent when a handler throws — a handler does not know where it
 * sits in the batch. `applyOps` stamps it on the way out with
 * {@link withOpIndex}; the route reports `{ code, opIndex, message }` verbatim.
 */
export class OpError extends Error {
  readonly code: OpErrorCode
  /** Position of the offending op in the batch; stamped by `applyOps`. */
  readonly opIndex?: number

  constructor(code: OpErrorCode, message: string, opIndex?: number) {
    super(message)
    this.name = "OpError"
    this.code = code
    if (opIndex !== undefined) this.opIndex = opIndex
  }
}

/** Raise-site sugar: `throw opError("op_target_missing", \`No shot ${id}\`)`. */
export function opError(
  code: OpErrorCode,
  message: string,
  opIndex?: number,
): OpError {
  return new OpError(code, message, opIndex)
}

/** Narrow an unknown catch value. */
export function isOpError(value: unknown): value is OpError {
  return value instanceof OpError
}

/**
 * A COPY of `error` carrying its position in the batch.
 *
 * Copy-on-write like everything else here: the thrown error is never mutated,
 * so the same error object surfacing twice (a retry, a log) cannot pick up a
 * stale index from an earlier attempt.
 */
export function withOpIndex(error: OpError, opIndex: number): OpError {
  const stamped = new OpError(error.code, error.message, opIndex)
  stamped.stack = error.stack
  return stamped
}
