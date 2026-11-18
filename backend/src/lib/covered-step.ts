/**
 * A COVERED step (decided 2026-11-18): a step of a run whose price was paid
 * up front by a podcast pack (one price per length of the recording, every
 * tool included). It reserves nothing and settles at nothing, on every path:
 *
 * - The pack is named once, on the tool run's wrapper job
 *   (`input_data._coveredBy`, written by the use-case route after it checked
 *   the pack), and read from there when its run is picked up
 *   ({@link wrapperCoverOf}) — never from a queue payload, so a run picked up
 *   again after a deploy is still covered.
 * - Each step's reservation writes a 0-credit usage log marked
 *   `metadata.covered` = {@link CoveredMark} (`CreditsService.reserveCredits`
 *   with `covered`): the pack that paid, and what the step's own price would
 *   have been (the platform's cost of the pack, for the admin).
 * - Every settle that can charge more than the hold reads the mark and
 *   settles at 0 (`settleCommitMetered`, `commitJobCredits`' measured
 *   branches); every other settle cannot exceed the 0 hold.
 */
import { supabase } from "./supabase.js"
import { HELD_PACK_STATUSES, PODCAST_PACK_JOB_TYPE, VOID_PACK_STATUSES } from "./use-case/pack-job-type.js"

/** The usage-log metadata key of the mark. */
export const COVERED_METADATA_KEY = "covered"

/** The wrapper job's `input_data` key naming the pack that pays for its run. */
export const WRAPPER_COVERED_BY_KEY = "_coveredBy"

/** What a covered step's usage log records. */
export interface CoveredMark {
  /** The pack job that paid for the step. */
  readonly by: string
  /** What the step would have been charged on its own. */
  readonly credits: number
}

/** The cover a usage log's metadata records, or null for an ordinary hold. */
export function coveredMarkOf(metadata: unknown): CoveredMark | null {
  if (!metadata || typeof metadata !== "object") return null
  const mark = (metadata as Record<string, unknown>)[COVERED_METADATA_KEY]
  if (!mark || typeof mark !== "object") return null
  const { by, credits } = mark as Record<string, unknown>
  if (typeof by !== "string" || by.length === 0) return null
  return { by, credits: typeof credits === "number" && Number.isFinite(credits) ? credits : 0 }
}

/** The pack a wrapper job's input names, or null. */
export function coveredByOf(inputData: unknown): string | null {
  if (!inputData || typeof inputData !== "object") return null
  const by = (inputData as Record<string, unknown>)[WRAPPER_COVERED_BY_KEY]
  return typeof by === "string" && by.length > 0 ? by : null
}

/** A wrapper whose cover could not be read: its run must not start (it would charge steps a pack paid for). */
export class CoverUnreadableError extends Error {
  constructor(wrapperJobId: string, detail: string) {
    super(`The run's pack could not be read (wrapper ${wrapperJobId}): ${detail}`)
    this.name = "CoverUnreadableError"
  }
}

/** A run's cover, as its pickup reads it. */
export type WrapperCover =
  | { readonly kind: "none" }
  | { readonly kind: "covered"; readonly packId: string }
  /** Its wrapper names a pack that did not go ahead (failed and refunded, or cancelled) or that is held for review: the run must not start. */
  | { readonly kind: "void"; readonly packId: string; readonly reason: "did_not_go_ahead" | "held" }

/**
 * The pack that pays for a use-case run, read from its wrapper job and then
 * the pack itself (both owner-scoped): covered while the pack stands; a pack
 * that did not go ahead (failed and refunded, or cancelled) or that is held
 * for review (suspected abuse: everything stops) covers nothing, and its run
 * runs neither free nor charged. Throws {@link CoverUnreadableError} on a
 * failed read: treating it as "not covered" would charge the steps again.
 */
export async function wrapperCoverOf(wrapperJobId: string, userId: string): Promise<WrapperCover> {
  const { data, error } = await supabase
    // trash-read: a run's cover is billing: a wrapper in the Trash still names the pack that paid for its run.
    .from("jobs")
    .select("input_data")
    .eq("id", wrapperJobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new CoverUnreadableError(wrapperJobId, error.message)
  const packId = coveredByOf((data as { input_data?: unknown } | null)?.input_data)
  if (!packId) return { kind: "none" }
  const { data: pack, error: packError } = await supabase
    // trash-read: a pack in the Trash still paid for its tools.
    .from("jobs")
    .select("provider, status")
    .eq("id", packId)
    .eq("user_id", userId)
    .maybeSingle()
  if (packError) throw new CoverUnreadableError(wrapperJobId, packError.message)
  const row = pack as { provider?: unknown; status?: unknown } | null
  if (row?.provider === PODCAST_PACK_JOB_TYPE && typeof row.status === "string" && HELD_PACK_STATUSES.includes(row.status)) {
    return { kind: "void", packId, reason: "held" }
  }
  const stands = row?.provider === PODCAST_PACK_JOB_TYPE && typeof row.status === "string" && !VOID_PACK_STATUSES.includes(row.status)
  return stands ? { kind: "covered", packId } : { kind: "void", packId, reason: "did_not_go_ahead" }
}
