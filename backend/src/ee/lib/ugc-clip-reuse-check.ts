/**
 * Which clips a run of UGC Clip will be handed back, checked on the server before the quote prices
 * them at nothing (`POST /v1/ugc/quote`, `reusedClips`).
 *
 * The editor says which clips it expects back from what the node records of its last batch (the
 * take's job and the Re-render count it was made at, `ugcReusedClips` in @nodaro/render-rules).
 * That record travels with the workflow — a workspace member, or anyone holding a copy, opens the
 * same one — while the clip route hands a clip back only to the user who made it. So every claim is
 * checked here, and a clip counts as free only when ALL of these hold:
 * - its job is one of the CALLER's own jobs (`user_id`), a UGC Clip job (`input_data.type`), completed;
 * - the job was admitted under the content key this run will send: the same ticket, the same
 *   Re-render count (`nonce`) and the same run key (none for an editor run, or a run that is not an
 *   app run's; an app run's chain root for its Retry, lib/continuation-run-root.ts);
 * - the clip route, walking that key's attempts from the first, stops at a finished one: an earlier
 *   attempt that is missing or still pending would be admitted again, and charged.
 * Anything else — another user's job, a deleted or failed one, a moved Re-render count, a read that
 * fails — is priced in full. The quote may be above what the run costs, never below it.
 *
 * The content key is the clip route's own, asked of the plugin that serves the route
 * (`services.ugc.clipContentKey`); this file holds no copy of how it is made. A plugin without that
 * member, a key it cannot make, or one that throws checks no claim: every clip is priced in full,
 * the safe side. Without a plugin there is no clip route, so nothing is ever handed back anyway.
 * Content-free: the ticket is handed to the plugin as it is, never read here.
 */
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import { supabase } from "../../lib/supabase.js"

/** One clip the editor expects back: its place in the tickets (from 1), its take's job, and the Re-render count this run sends. */
export interface UgcReuseClaim {
  readonly clip: number
  readonly jobId: string
  readonly nonce: number
}

/** The most attempts the clip route makes on one content key. */
const MAX_ATTEMPTS = 20

/** A ticket as the run sends it: the editor's saved wire string is read as the value it holds. */
function ticketValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * The clip route's key for each claim, asked of the plugin. Null when the plugin cannot say (no
 * member: an older plugin, or none loaded): then no claim is checked. A claim whose ticket gets no
 * key is left out, and so priced in full.
 */
function claimKeys(
  tickets: readonly unknown[],
  claims: readonly UgcReuseClaim[],
  runKey: string | undefined,
): Array<{ claim: UgcReuseClaim; key: string }> | null {
  const ugc = getPluginServices().ugc
  if (typeof ugc?.clipContentKey !== "function") return null
  return claims.flatMap((claim) => {
    const ticket = ticketValue(tickets[claim.clip - 1])
    if (ticket === undefined) return []
    const key: unknown = ugc.clipContentKey!(ticket, claim.nonce, runKey)
    return typeof key === "string" && key.length > 0 ? [{ claim, key }] : []
  })
}

/** The attempt number a job's idempotency key holds under `key`, or undefined when it is no attempt of that key. */
function attemptOf(idempotencyKey: unknown, key: string): number | undefined {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.startsWith(`${key}:`)) return undefined
  const rest = idempotencyKey.slice(key.length + 1)
  if (!/^\d{1,2}$/.test(rest)) return undefined
  const attempt = Number(rest)
  return attempt < MAX_ATTEMPTS ? attempt : undefined
}

interface JobRow {
  readonly id: string
  readonly status: string
  readonly idempotency_key: string | null
  readonly type: string | null
}

/**
 * The claims that hold (by clip place, from 1), each checked against the caller's own jobs. Never
 * throws: a read that fails holds none, so every clip is priced in full.
 */
export async function verifiedReusedClips(
  userId: string,
  tickets: readonly unknown[],
  claims: readonly UgcReuseClaim[],
  /** The run key the run sends (`runKey` of /v1/ugc/clip); none for an editor run. */
  runKey?: string,
): Promise<Set<number>> {
  const verified = new Set<number>()
  try {
    // Inside the try: a plugin whose key throws prices every clip, never fails the quote.
    const keyed = claims.length > 0 ? claimKeys(tickets, claims, runKey) : []
    if (keyed === null || keyed.length === 0) return verified
    const { data, error } = await supabase
      // trash-read: a job in the Trash has no idempotency key (lib/job-trash.ts frees it), so it is no claim's take.
      .from("jobs")
      .select("id, status, idempotency_key, type:input_data->>type")
      .eq("user_id", userId)
      .in("id", [...new Set(keyed.map((k) => k.claim.jobId))])
    if (error) throw new Error(error.message)
    const jobs = new Map(((data ?? []) as unknown as JobRow[]).map((row) => [row.id, row] as const))
    // Each claim's own job: finished, a clip's, under this run's key.
    const held = keyed.flatMap(({ claim, key }) => {
      const job = jobs.get(claim.jobId)
      if (!job || job.status !== "completed" || job.type !== "ugc-clip") return []
      const attempt = attemptOf(job.idempotency_key, key)
      return attempt === undefined ? [] : [{ claim, key, attempt }]
    })
    // A later attempt: the route walks the key's attempts from the first and admits again at one
    // that is missing or pending, so each earlier one is read too.
    const earlierKeys = held.flatMap(({ key, attempt }) => Array.from({ length: attempt }, (_, i) => `${key}:${i}`))
    const earlier = new Map<string, string>()
    if (earlierKeys.length > 0) {
      const { data: rows, error: earlierError } = await supabase
        // trash-read: a lookup by idempotency key, which a job in the Trash no longer holds.
        .from("jobs")
        .select("idempotency_key, status")
        .eq("user_id", userId)
        .in("idempotency_key", earlierKeys)
      if (earlierError) throw new Error(earlierError.message)
      for (const row of (rows ?? []) as Array<{ idempotency_key: string | null; status: string }>) {
        if (row.idempotency_key) earlier.set(row.idempotency_key, row.status)
      }
    }
    for (const { claim, key, attempt } of held) {
      let handedBack = true
      for (let i = 0; i < attempt; i++) {
        const status = earlier.get(`${key}:${i}`)
        // A finished or running earlier attempt is handed back itself: still nothing to pay.
        if (status === "completed" || status === "processing") break
        // One that failed or was cancelled is passed over; one missing or pending is admitted again.
        if (status !== "failed" && status !== "cancelled") {
          handedBack = false
          break
        }
      }
      if (handedBack) verified.add(claim.clip)
    }
    return verified
  } catch (err) {
    console.warn("[ugc-quote] reused clips not checked; every clip is priced:", err instanceof Error ? err.message : err)
    return new Set()
  }
}
