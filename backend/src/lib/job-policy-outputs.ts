/**
 * What a completion is about to publish, in two different shapes — and the
 * split between them is load-bearing (spec §5.4).
 *
 *  • `extractJobOutputs` gives the POLICY every `http(s)` URL in `output_data`,
 *    ours or not. If the context were built from the owned subset instead, a
 *    deployment with `R2_PUBLIC_URL` unset or a fallback domain configured
 *    would hand the policy `outputs: []` for a real media job — and a policy
 *    that allows an empty list (the natural implementation) would silently fail
 *    OPEN. `mediaKind` travels alongside so a policy can fail closed on "media
 *    kind, zero outputs".
 *
 *  • `ownedHeldObjects` / `deleteOwnedOutputObjects` act only on the subset
 *    this job OWNS. `output_data` routinely ECHOES INPUT URLs — `generate-mask`
 *    writes the caller's source `imageUrl`, `reference-sheet` writes
 *    pre-existing `panelUrls`, `nodaro-exclusive-relay` spreads `...rest` from
 *    the cloud output, the director's `videoUrl` IS the child render job's
 *    object. Deleting "every URL in output_data" would destroy the user's own
 *    inputs and other jobs' assets. Ownership is decided by the KEY FAMILY, and
 *    a key that does not match is refused and logged.
 *
 * `deleteFromR2`/`batchDeleteFromR2` are reached through a DYNAMIC import so
 * this module (and everything that imports it, up to `workers/shared.ts`) does
 * not pull the S3 client into a graph that only ever reads.
 */
import { r2KeyFromOurUrl } from "./storage.js"
import type { JobOutputRef } from "./job-policy.js"

/** A withheld object, as stored in `jobs.held_objects` (D7). Keys, never URLs:
 *  the review preview reads one server-side by index and reject deletes by key.
 *  `r2KeyFromOurUrl` is lossy (null with no `R2_PUBLIC_URL`, null on a fallback
 *  domain), so re-deriving the key at review time 404s on exactly the
 *  deployments that configured one. */
export interface HeldObject {
  readonly key: string
  readonly kind: "image" | "video" | "audio" | "other"
  readonly index: number
  readonly sizeBytes?: number
}

/** The most outputs we will ever WITHHOLD for one job — 16 variants is already
 *  double anything the platform produces, and the review route indexes into
 *  this array from client input (its `:index` bound is this number minus one).
 *
 *  It bounds `jobs.held_objects`, which is a review-UI list, and NOTHING ELSE.
 *  Deletion is deliberately not capped by it: a plugin checkpoint can hold far
 *  more owned refs than a human would ever page through, and a `break` in the
 *  delete path would leave that tail live at guessable public keys forever. */
export const MAX_HELD_OBJECTS = 17

const URL_RE = /^https?:\/\//i

function roleFor(keyPath: string, arrayIndex: number | null): JobOutputRef["role"] {
  const k = keyPath.toLowerCase()
  if (k.includes("thumb")) return "thumbnail"
  if (k.includes("mask")) return "mask"
  if (arrayIndex !== null && arrayIndex > 0) return "variant"
  return "primary"
}

function kindFor(url: string, keyPath: string): HeldObject["kind"] {
  const s = `${keyPath} ${url}`.toLowerCase()
  if (/\bvideo|\.mp4|\.webm|\.mov\b/.test(s)) return "video"
  if (/\baudio|\.mp3|\.wav|\.m4a|\.ogg\b/.test(s)) return "audio"
  if (/\bimage|thumb|\.png|\.jpe?g|\.webp\b/.test(s)) return "image"
  return "other"
}

/**
 * EVERY http(s) URL in `output_data`, recursively, deduped, in a stable order.
 * `key` is `r2KeyFromOurUrl(url)` — null for anything that is not ours.
 */
export function extractJobOutputs(outputData: Record<string, unknown> | null | undefined): JobOutputRef[] {
  const seen = new Set<string>()
  const out: JobOutputRef[] = []

  const walk = (value: unknown, path: string, arrayIndex: number | null): void => {
    if (typeof value === "string") {
      if (!URL_RE.test(value) || seen.has(value)) return
      seen.add(value)
      out.push({ role: roleFor(path, arrayIndex), url: value, key: r2KeyFromOurUrl(value) })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path, i))
      return
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, null)
      }
    }
  }

  walk(outputData ?? {}, "", null)
  return out
}

/** Which media family this completion belongs to. Derived from the output keys
 *  rather than from `job-finalize.ts`'s three type sets on purpose: that module
 *  imports `workers/shared.js` (sharp, youtube-dl-exec, @remotion), and the
 *  result gate must not. */
export function mediaKindOf(outputData: Record<string, unknown> | null | undefined): HeldObject["kind"] {
  const keys = Object.keys(outputData ?? {}).join(" ").toLowerCase()
  if (keys.includes("video")) return "video"
  if (keys.includes("audio")) return "audio"
  if (keys.includes("image")) return "image"
  return "other"
}

/**
 * Ownership by KEY FAMILY. Every deliverable this platform writes is
 * `<prefix>/<jobId>.<ext>` — `images/`, `videos/`, `audios/` (mediaObjectKey),
 * plus `thumbnails/`, `reference-sheets/` and `lottie/` — and everything a job
 * writes ALONGSIDE its deliverable suffixes that same stem: `variantJobId` is
 * `<jobId>-v<i>`, and a plugin's intermediates are `<jobId>-seg1`,
 * `<jobId>-seg3-lastframe`, `<jobId>-seg2-anchor-start`, `<jobId>-video-audio`
 * and so on. So the family is the STEM PREFIX `<jobId>-`, and it is
 * prefix-agnostic on purpose: a new deliverable prefix — or a new suffix an
 * engine invents next week — inherits the rule instead of silently leaking.
 *
 * The `-` is load-bearing twice over. It keeps `job-10` out of `job-1`'s
 * family (a bare `startsWith(jobId)` would swallow it), and because every
 * engine builds its stems from the RUNNING job's own id, a continuation's
 * `<parentJobId>-segN` stays the PARENT's object: a child's block must not
 * delete the deliverable of a job that completed. Job ids are UUIDs, so a
 * `<jobId>-` prefix cannot collide with another job's id.
 */
export function isOwnedObjectKey(jobId: string, key: string): boolean {
  if (!jobId) return false
  const stem = keyStem(key)
  return stem === jobId || stem.startsWith(`${jobId}-`)
}

/** An object key's STEM: basename, extension removed. The half of the family
 *  rule that both `isOwnedObjectKey` ("does this key belong to job X?") and
 *  `objectKeyJobIdCandidates` ("which job could have written this key?") are
 *  built from — one implementation, so the fence and the family rule cannot
 *  drift apart. */
export function keyStem(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `isOwnedObjectKey` READ BACKWARDS: which job ids could have written this key?
 *
 * The family rule says a job's objects are `<jobId>` or `<jobId>-<suffix>`, so
 * inverting it means "the whole stem, or the job-id-shaped head of it". Job ids
 * are UUIDs (`jobs.id UUID`, 001_initial_schema.sql) and a UUID carries four
 * internal `-`, so enumerating every `-`-boundary prefix would emit six
 * candidates per key for nothing; the shape test picks the one prefix that can
 * actually BE an id. Two values per key at most, usually one.
 *
 * This is what lets `lib/asset-delete.ts` ask `jobs.relay_job_id = <candidate>`:
 * the far end's key stem IS the far end's job id (migration 384's comment), so
 * a hit means our relay target created these bytes. That probe is keyed on the
 * OBJECT, which is why it still answers after the near end's asset row AND the
 * referring job row are both gone — the two row markers cannot.
 */
export function objectKeyJobIdCandidates(key: string): string[] {
  const stem = keyStem(key)
  if (!stem) return []
  const head = stem.slice(0, 36)
  // `<uuid>-<suffix>`: the head is an id only when the boundary is a real `-`,
  // otherwise any 36 leading characters would be probed as if they were one.
  if (head.length === 36 && stem.length > 36 && stem[36] === "-" && UUID_RE.test(head)) {
    return [stem, head]
  }
  return [stem]
}

/**
 * The same family test, widened by ONE extra stem: the far end's job id on a
 * relayed row (`jobs.relay_job_id`, migration 383).
 *
 * WHY, and why only here. Under the shared-bucket passthrough (lib/storage.ts)
 * a relayed output is never copied — `output_data` carries the FAR end's URL,
 * whose key stem is the far job id. `isOwnedObjectKey(nearJobId, …)` therefore
 * refuses every output of every relayed job, and the result gate wrote
 * `held_objects: []` for a held one: the review queue showed a job with
 * nothing to look at and the preview 404'd on every index, so a human had to
 * approve or reject media they could not see.
 *
 * WITHHOLDING and REVIEW use this; DELETION deliberately does not. `held_objects`
 * is a review list — what a human may look at — and the far end's object is
 * exactly what needs looking at. `deleteOwnedObjects` keeps asking
 * `isOwnedObjectKey` with the NEAR job id alone, so a far-stem entry in that
 * same array is dropped at delete time and invariant 9 ("a row with a non-null
 * relay_job_id never causes this instance to delete an R2 object") holds with
 * no second guard and no relay-rule exception.
 *
 * The stem comes from a SERVER-WRITTEN column — migration 383 adds no UPDATE
 * grant on `relay_job_id` — never from caller input, so the "planted array ⇒
 * authenticated read-anything proxy" property the fence protects survives:
 * widening by one row-derived id admits exactly the objects the far end made
 * for this row.
 */
export function isOwnedOrRelayedObjectKey(
  jobId: string,
  relayJobId: string | null | undefined,
  key: string,
): boolean {
  if (isOwnedObjectKey(jobId, key)) return true
  return !!relayJobId && isOwnedObjectKey(relayJobId, key)
}

/**
 * The subset of `outputs` this job owns, in `jobs.held_objects` shape.
 *
 * `limit` defaults to the WITHHOLDING cap because that is what the column is
 * for. The delete paths pass `Infinity` (see `allOwnedObjects`): truncating a
 * review list is a UI decision, truncating a deletion is a leak.
 */
export function ownedHeldObjects(
  jobId: string,
  outputs: readonly JobOutputRef[],
  limit: number = MAX_HELD_OBJECTS,
  /** The far end's job id when this row was relayed (`jobs.relay_job_id`).
   *  Passed by the two WITHHOLDING call sites only — `allOwnedObjects` below,
   *  which feeds deletion, deliberately never passes it. See
   *  `isOwnedOrRelayedObjectKey`. */
  relayJobId?: string | null,
): HeldObject[] {
  const held: HeldObject[] = []
  for (const o of outputs) {
    if (!o.key) continue
    if (!isOwnedOrRelayedObjectKey(jobId, relayJobId, o.key)) {
      console.warn(`[job-policy] job ${jobId}: output key "${o.key}" is not in this job's key family — not withheld`)
      continue
    }
    if (held.length >= limit) {
      // Loud, because it is the one case where this function answers with less
      // than the truth: whoever reads the result has to know a tail exists.
      console.warn(`[job-policy] job ${jobId}: more than ${limit} owned objects — the rest are not in held_objects`)
      break
    }
    held.push({ key: o.key, kind: kindFor(o.url, o.role), index: held.length, ...(o.sizeBytes ? { sizeBytes: o.sizeBytes } : {}) })
  }
  return held
}

/**
 * EVERY owned object across one or more `output_data` shapes, uncapped and
 * deduped — the DELETION set.
 *
 * Two shapes, because a block has two sources and they need not agree: the
 * completion fields the caller is about to publish, and whatever a mid-run
 * checkpoint already wrote onto the row. A plugin writes segment URLs into
 * `jobs.output_data` while it runs, so the row can carry owned objects the
 * completion payload never mentions.
 */
export function allOwnedObjects(
  jobId: string,
  ...outputDatas: ReadonlyArray<Record<string, unknown> | null | undefined>
): HeldObject[] {
  const seen = new Set<string>()
  const outputs: JobOutputRef[] = []
  for (const data of outputDatas) {
    for (const o of extractJobOutputs(data)) {
      if (!o.key || seen.has(o.key)) continue
      seen.add(o.key)
      outputs.push(o)
    }
  }
  return ownedHeldObjects(jobId, outputs, Number.POSITIVE_INFINITY)
}

/**
 * Best-effort deletion of the objects a blocked/rejected job produced.
 *
 * Deletion is NOT the security boundary and the docs say so: the bucket is
 * public-read with a one-year immutable cache and there is no purge, so a URL
 * an edge already served cannot be recalled. NULL `output_data` is the boundary.
 * Deleting is still right — it removes a guessable object for the overwhelmingly
 * common case where nobody guessed it, and stops it accruing storage cost
 * forever. A delete failure logs and changes no verdict.
 */
export async function deleteOwnedObjects(jobId: string, objects: readonly HeldObject[]): Promise<number> {
  // Deduped: callers legitimately union two sources (the withheld list and the
  // row's residue), and the same key must not be sent twice.
  const keys = [...new Set(objects.map((o) => o.key).filter((k) => isOwnedObjectKey(jobId, k)))]
  if (keys.length === 0) return 0
  try {
    const { batchDeleteFromR2 } = await import("./storage.js")
    const { deleted } = await batchDeleteFromR2(keys)
    return deleted
  } catch (err) {
    console.warn(`[job-policy] object cleanup failed for job ${jobId}: ${(err as Error).message}`)
    return 0
  }
}

/** Convenience for the callers that hold `output_data` rather than
 *  `held_objects` (the result-gate block path). Uncapped, by way of
 *  `allOwnedObjects`. */
export async function deleteOwnedOutputObjects(
  jobId: string,
  ...outputDatas: ReadonlyArray<Record<string, unknown> | null | undefined>
): Promise<number> {
  return deleteOwnedObjects(jobId, allOwnedObjects(jobId, ...outputDatas))
}
