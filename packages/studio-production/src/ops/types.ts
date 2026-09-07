/**
 * The operation CONTRACT — the four types every section module implements.
 *
 * An operation is the server-side twin of one studio store reducer (spec §6,
 * D3): a pure function from a production and typed args to a new production,
 * a receipt in the user's words, and any warnings worth surfacing. Twelve
 * section modules implement ~50 of them against these types; `applyOps` (the
 * integrator's) runs a batch of them atomically.
 *
 * Three rules the types encode:
 *  - **Addressing is by stable key, never by position** — ids for shots,
 *    folders, cuts, trash entries and cast rows; `ResultKey` (`jobId ?? url`)
 *    for results. An index would be stale the moment the other writer inserted
 *    something, which is the whole reason this vocabulary exists.
 *  - **Nothing ambient** — no clock, no randomness, no network. A handler that
 *    needs the time or a fresh id takes it from {@link OpContext}, so the same
 *    batch applied in the browser and on the server produces byte-equal
 *    `settings.studio` (the contract test).
 *  - **Copy-on-write** — the returned production is new; the input is not
 *    touched, so a throw part-way through a batch leaves the document intact.
 */
import type { z } from "zod"

import type { MentionCandidate } from "../prompt-mentions"
import type { Production } from "./production"

/**
 * A job row, as an operation needs to read one.
 *
 * Structural on purpose: the package must not depend on the backend's row
 * types, and this is the whole surface `land_job` reads. P1.2 owns the full
 * shape (it adds the output readers); until then this is the pin that lets
 * `ctx.jobs` be declared and injected.
 */
export interface JobRowLike {
  readonly id: string
  readonly status: string
  readonly output_data?: unknown
  readonly error_message?: string | null
}

/**
 * Everything a handler may need that is not in the document.
 *
 * `now` is an ISO-8601 STRING, injected — never `Date.now()`, never a `Date`.
 * Timestamps land in the persisted document (`trash[].deletedAt`, a marker's
 * `startedAt`, a cut's `createdAt`), so a wall-clock read inside a handler
 * would make the byte-equality contract untestable.
 *
 * `mintId` is the only source of new ids (`insert_shots` re-mints every id it
 * pastes so a bundle can be pasted twice into one production). Ids a later op
 * will ADDRESS are minted by the caller and carried in the op instead
 * (`add_shot { id }`, `add_folder { id }`, `add_cut { id }`) — D3.2.
 *
 * `candidates` is the caller's entity library, consulted ONCE at enrollment
 * (`enroll_cast`, `mint_cast_from_chips`); the pool itself is never stored.
 *
 * `jobs` reads a job row by id for `land_job` (P1.2). Absent ⇒ `land_job` is
 * refused rather than guessed at.
 */
export interface OpContext {
  /** ISO-8601 instant this batch is applied at. Injected, never read here. */
  readonly now: string
  /** Mints an id for something no later op addresses by name. */
  readonly mintId: () => string
  /** The caller's entity library, for cast enrollment. */
  readonly candidates?: ReadonlyArray<MentionCandidate>
  /** Owner-checked job lookup for `land_job`. */
  readonly jobs?: (jobId: string) => JobRowLike | null
}

/**
 * What one applied operation reports.
 *
 * `summary` is the user-facing sentence — past tense, the target by its display
 * name or its index, the destination in parentheses ("Deleted take 2 of Shot 1
 * (in the bin)"). `describeOps` reuses it verbatim and the copilot's proposal
 * card renders it, so it is written for a person, never for a log.
 *
 * `ids` carries anything the op MINTED that the caller could not have known
 * (the re-minted shot ids of `insert_shots`). Ids the caller supplied are not
 * echoed.
 *
 * `row` is the escape hatch for the two operations that address the workflow
 * ROW rather than `settings.studio` — `set_name` and `set_thumbnail`. Their
 * handlers return the production untouched and put the intended column value
 * here; the route applies it in the same write. See `SECTIONS.md` §1.
 */
export interface OpReceipt {
  /** The op's discriminator, e.g. `"remove_still_result"`. */
  readonly op: string
  /** One line in the user's words. */
  readonly summary: string
  /** Ids this op minted (never ids the caller supplied). */
  readonly ids?: ReadonlyArray<string>
  /** Workflow-row columns this op asks the route to write. */
  readonly row?: {
    readonly name?: string
    readonly thumbnailUrl?: string | null
  }
}

/** What a handler returns: the new document, its receipt, and any warnings. */
export interface OpResult {
  readonly production: Production
  readonly receipt: OpReceipt
  /**
   * Things worth saying that are not failures — a no-op ("Shot 2 was already
   * in that folder"), a wide side effect ("renamed the role in 4 prompts").
   * A warning never rejects the batch; an `OpError` does.
   */
  readonly warnings?: ReadonlyArray<string>
}

/**
 * One operation, applied.
 *
 * Pure: no clock, no randomness, no I/O, no mutation of `production`. Throws
 * {@link import("./errors").OpError} for a missing target or a refused argument
 * and NEVER catches one — a swallowed error is a half-written batch.
 */
export type OpHandler<Op> = (
  production: Production,
  op: Op,
  ctx: OpContext,
) => OpResult

/**
 * A section's handler table, derived from its schema table.
 *
 * Every section module exports `<section>OpSchemas` (one zod object per §6 row)
 * and `<section>Handlers: SectionHandlers<typeof <section>OpSchemas>`. Deriving
 * the second from the first is what makes "a schema with no handler" and "a
 * handler with no schema" both compile errors instead of a runtime surprise.
 */
export type SectionHandlers<S extends Record<string, z.ZodType>> = {
  readonly [K in keyof S]: OpHandler<z.infer<S[K]>>
}

/**
 * The CONFIRMATION class of an operation (spec §6).
 *
 * `S` safe · `D` delete (trash-backed unless the row says it destroys) ·
 * `P` publish · `$` spends credits. The MCP annotations and the copilot's
 * "never without confirmation" rule read it at DISPATCH — it is a property of
 * the vocabulary, not of a prompt. Each section exports the classes of its own
 * ops; the integrator assembles `OP_CLASS` and pins it complete over the union.
 */
export type OpClass = "S" | "D" | "P" | "$"

/** A section's class table — one entry per op the section declares. */
export type SectionClasses<S extends Record<string, z.ZodType>> = {
  readonly [K in keyof S]: OpClass
}
