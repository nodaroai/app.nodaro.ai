/**
 * One continuation at a time (decided 2026-10-13): a continue claims the run
 * it continues before it writes anything, by compare-and-set on that run's
 * wrapper `input_data`, so two requests arriving at once can never both start
 * one — key or no key.
 *
 *  - `_continuedBy` on a first run's wrapper, the root of its lineage (the
 *    run and each continue-from-failed of it, `_chainOf`): one continuation
 *    of the lineage at a time.
 *  - `_finalClaim` on a preview run's wrapper: its Render final under way,
 *    and any continue-from-failed of that final. A final that COMPLETED frees
 *    it (decided 2026-10-13): the preview may be rendered final again.
 *
 * The claim names the new wrapper's id and when it was taken
 * (`<id>@<epoch ms>`). A claim is free again once its wrapper failed or was
 * cancelled, or when no wrapper with that id appeared within
 * `CLAIM_STALE_MS` (a request that died between claim and insert). Every
 * failure before the run starts releases it (CAS back); a release that fails
 * leaves a claim the next request reads as free by those same rules.
 */
import { supabase } from "../supabase.js"
import { IN_FLIGHT_JOB_STATUSES } from "../job-status.js"

export type ContinueClaimKey = "_continuedBy" | "_finalClaim"

/** How long a claim with no wrapper behind it still blocks. */
export const CLAIM_STALE_MS = 120_000

export interface ContinueClaim {
  readonly rowId: string
  readonly key: ContinueClaimKey
  readonly value: string
  /** The row's `input_data` without this claim: what a release writes back. */
  readonly released: Readonly<Record<string, unknown>>
}

export type ClaimOutcome =
  | { readonly ok: true; readonly claim: ContinueClaim }
  | { readonly ok: false; readonly blockedBy: string }

/** The holder's statuses that still block, per claim: a completed final no longer does. */
const BLOCKING: Readonly<Record<ContinueClaimKey, readonly string[]>> = {
  _continuedBy: [...IN_FLIGHT_JOB_STATUSES, "completed"],
  _finalClaim: [...IN_FLIGHT_JOB_STATUSES],
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function parseClaim(value: unknown): { id: string; at: number } | null {
  if (typeof value !== "string") return null
  const at = value.lastIndexOf("@")
  if (at <= 0) return null
  const ms = Number(value.slice(at + 1))
  return { id: value.slice(0, at), at: Number.isFinite(ms) ? ms : 0 }
}

/** The wrapper a live claim names, or null when the claim is free. Throws on a read error. */
async function liveClaimHolder(value: unknown, userId: string, now: number, key: ContinueClaimKey): Promise<string | null> {
  const claim = parseClaim(value)
  if (!claim) return null
  const { data, error } = await supabase.from("jobs").select("id, status").eq("id", claim.id).eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`use-case continue: claim holder ${claim.id} unreadable: ${error.message}`)
  const row = data as { status?: unknown } | null
  if (!row) return now - claim.at < CLAIM_STALE_MS ? claim.id : null
  return BLOCKING[key].includes(String(row.status)) ? claim.id : null
}

/**
 * Claim `rowId` (the caller's own wrapper) for the continuation whose new
 * wrapper will be `newWrapperId`. Throws on a read or write error.
 */
export async function claimContinuation(input: {
  readonly rowId: string
  readonly userId: string
  readonly key: ContinueClaimKey
  readonly newWrapperId: string
  readonly now?: () => number
}): Promise<ClaimOutcome> {
  const now = (input.now ?? Date.now)()
  const { data, error } = await supabase.from("jobs").select("input_data").eq("id", input.rowId).eq("user_id", input.userId).maybeSingle()
  if (error) throw new Error(`use-case continue: run ${input.rowId} unreadable: ${error.message}`)
  const current = isRecord((data as { input_data?: unknown } | null)?.input_data) ? (data as { input_data: Record<string, unknown> }).input_data : {}
  const held = current[input.key]
  const holder = await liveClaimHolder(held, input.userId, now, input.key)
  if (holder) return { ok: false, blockedBy: holder }

  const { [input.key]: _previous, ...released } = current
  const value = `${input.newWrapperId}@${now}`
  const column = `input_data->>${input.key}`
  const base = supabase.from("jobs").update({ input_data: { ...released, [input.key]: value } }).eq("id", input.rowId).eq("user_id", input.userId)
  const guarded = typeof held === "string" ? base.eq(column, held) : base.is(column, null)
  const { data: rows, error: writeError } = await guarded.select("id")
  if (writeError) throw new Error(`use-case continue: run ${input.rowId} not claimed: ${writeError.message}`)
  // Zero rows: another request changed the claim between the read and the write.
  if (!Array.isArray(rows) || rows.length === 0) {
    const { data: after } = await supabase.from("jobs").select("input_data").eq("id", input.rowId).eq("user_id", input.userId).maybeSingle()
    const winner = (after as { input_data?: Record<string, unknown> } | null)?.input_data?.[input.key]
    return { ok: false, blockedBy: parseClaim(winner)?.id ?? parseClaim(held)?.id ?? input.rowId }
  }
  return { ok: true, claim: { rowId: input.rowId, key: input.key, value, released } }
}

/** Give the claim back (only while it is still ours). Never throws. */
export async function releaseContinuation(claim: ContinueClaim): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ input_data: claim.released })
      .eq("id", claim.rowId)
      .eq(`input_data->>${claim.key}`, claim.value)
    if (error) console.warn(`[use-case-continue] claim on ${claim.rowId} not released: ${error.message}`)
  } catch (err) {
    console.warn(`[use-case-continue] claim on ${claim.rowId} not released: ${(err as Error).message}`)
  }
}
