/**
 * `applyOps` — a batch of operations, applied ATOMICALLY (D3.3, D4).
 *
 * One entry point for every writer: the ops route applies a batch here before
 * it writes the row back under a compare-and-swap, and the studio editor
 * applies the SAME function locally for its optimistic state. That is the whole
 * reason this is a pure function over a parsed document rather than a method on
 * a store — two implementations of "what a rename does" is the disagreement the
 * operation vocabulary exists to end, and a contract test can only compare the
 * two sides if they are literally the same code.
 *
 * ## All or nothing
 *
 * A batch either applies completely or changes nothing. Concretely:
 *
 *  1. EVERY op is validated against the union before the FIRST one is applied,
 *     so a caller cannot half-apply a batch by getting the last argument wrong.
 *  2. The ops then run in order, each on the document the one before it
 *     returned. A handler that refuses throws an {@link OpError}; `applyOps`
 *     stamps the op's INDEX on the way out and lets it through.
 *  3. The document the caller handed in is never touched. Not because anything
 *     is rolled back — there is nothing to roll back, because every handler is
 *     copy-on-write, so the half-built document simply goes out of scope with
 *     the throw.
 *
 * A non-`OpError` escaping a handler is a BUG in this package, not a caller
 * mistake, so it propagates unchanged: dressing it as `op_invalid` would turn a
 * 500 the team must see into a 400 the caller would keep retrying.
 */
import { z } from "zod"

import { isOpError, opError, withOpIndex } from "./errors"
import type { Production } from "./production"
import { StudioProductionOpSchema, type StudioProductionOp } from "./schema"
import { beatsHandlers } from "./sections/beats"
import { castHandlers } from "./sections/cast"
import { clipsHandlers } from "./sections/clips"
import { cutsHandlers } from "./sections/cuts"
import { foldersHandlers } from "./sections/folders"
import { framesHandlers } from "./sections/frames"
import { looksHandlers } from "./sections/looks"
import { productionHandlers } from "./sections/production"
import { shotsHandlers } from "./sections/shots"
import { stillsHandlers } from "./sections/stills"
import { trashHandlers } from "./sections/trash"
import { voiceHandlers } from "./sections/voice"
import type { OpContext, OpHandler, OpReceipt } from "./types"

// ── the handler table ───────────────────────────────────────────────────────

/**
 * Every operation's handler, keyed by its name.
 *
 * Derived from the union rather than written as a free record: a section that
 * adds a schema without a handler, or a handler whose argument type has drifted
 * from its schema, is a compile error here instead of an `undefined is not a
 * function` in production.
 */
type HandlerTable = {
  readonly [K in StudioProductionOp["op"]]: OpHandler<
    Extract<StudioProductionOp, { op: K }>
  >
}

/**
 * The three §6 operations this build parses but cannot apply (P1.2).
 *
 * Refusing loudly is the point. A marker op that quietly did nothing would let
 * a client believe a framing batch was recorded and then lose it, and a
 * `land_job` that returned the document unchanged would look exactly like a job
 * that had already landed.
 */
// TODO(P1.2): replace with the real handlers once `Shot.pendingStills` and
// `landJobResult` exist; `ctx.jobs` is already declared for `land_job`.
function notImplemented(op: string): never {
  throw opError(
    "op_not_implemented",
    `\`${op}\` is in the vocabulary but not in this build yet.`,
  )
}

const HANDLERS: HandlerTable = {
  ...productionHandlers,
  ...foldersHandlers,
  ...shotsHandlers,
  ...beatsHandlers,
  ...looksHandlers,
  ...stillsHandlers,
  ...clipsHandlers,
  ...framesHandlers,
  ...voiceHandlers,
  ...castHandlers,
  ...trashHandlers,
  ...cutsHandlers,
  land_job: (_production, op) => notImplemented(op.op),
  add_pending_still: (_production, op) => notImplemented(op.op),
  remove_pending_still: (_production, op) => notImplemented(op.op),
}

// ── validation ──────────────────────────────────────────────────────────────

/**
 * The first thing wrong with an op, in a sentence a caller can act on.
 *
 * Zod's own report is a tree; what a caller needs is the op it sent and the
 * field that was refused. An unknown discriminator is spelled out by name
 * because it is the most common mistake by far — a typo, or an op from a newer
 * build — and "invalid discriminator value" alone does not say which one.
 */
function invalidMessage(raw: unknown, error: z.ZodError): string {
  const name =
    raw && typeof raw === "object" && "op" in raw
      ? String((raw as { op: unknown }).op)
      : "(no `op` field)"
  const known = new Set(
    StudioProductionOpSchema.options.map(
      (member) => member.shape.op.value as string,
    ),
  )
  if (!known.has(name)) return `\`${name}\` is not an operation.`

  const first = error.issues[0]
  const path = first?.path.join(".")
  return path
    ? `\`${name}\`: ${path} — ${first?.message ?? "invalid"}`
    : `\`${name}\`: ${first?.message ?? "invalid"}`
}

/**
 * Parse a batch, refusing at the FIRST malformed op and naming its index.
 *
 * Exported because the route validates a body before it reads the workflow —
 * there is no point taking a row lock for a batch that cannot parse.
 */
export function parseOps(
  ops: ReadonlyArray<unknown>,
): ReadonlyArray<StudioProductionOp> {
  return ops.map((raw, index) => {
    const parsed = StudioProductionOpSchema.safeParse(raw)
    if (!parsed.success) {
      throw opError("op_invalid", invalidMessage(raw, parsed.error), index)
    }
    return parsed.data
  })
}

// ── the batch ───────────────────────────────────────────────────────────────

/** What a batch produced: the new document, its receipts, and its warnings. */
export interface ApplyOpsResult {
  /** The document after every op. The input is untouched. */
  readonly production: Production
  /** One receipt per op, in order — `describeOps` reads their summaries. */
  readonly receipts: ReadonlyArray<OpReceipt>
  /** Every op's warnings, flattened. A warning never rejects a batch. */
  readonly warnings: ReadonlyArray<string>
}

/**
 * Apply a batch of operations to a production.
 *
 * @param production the parsed document; never mutated
 * @param ops the batch — unvalidated on purpose, so a route can hand its body
 *   straight in and get one typed refusal with the offending op's index
 * @param ctx the clock, the id source, and the caller's entity library
 * @throws {OpError} with `opIndex` set, for a malformed or refused operation
 */
export function applyOps(
  production: Production,
  ops: ReadonlyArray<unknown>,
  ctx: OpContext,
): ApplyOpsResult {
  const batch = parseOps(ops)

  let current = production
  const receipts: OpReceipt[] = []
  const warnings: string[] = []

  for (const [index, op] of batch.entries()) {
    // The table is keyed by the discriminator, but TypeScript cannot correlate
    // `op.op` with `HANDLERS[op.op]`'s parameter across a union of ~58 members;
    // the table's own type is what proves each entry takes its own op.
    const handler = HANDLERS[op.op] as OpHandler<StudioProductionOp>
    try {
      const result = handler(current, op, ctx)
      current = result.production
      receipts.push(result.receipt)
      if (result.warnings) warnings.push(...result.warnings)
    } catch (error) {
      // A refusal names the op that caused it. Anything else is ours, and goes
      // up as it is.
      if (isOpError(error)) throw withOpIndex(error, index)
      throw error
    }
  }

  return { production: current, receipts, warnings }
}
