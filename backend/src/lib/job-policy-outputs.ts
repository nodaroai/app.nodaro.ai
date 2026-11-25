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
 * not pull the S3 client into a graph that only ever reads. So is
 * `keepWithheldObjectsPrivate`, and only on a deployment that deletes nothing.
 */
import { r2KeyFromOurUrl } from "./storage.js"
import { storageDeletesSkipped } from "./storage-deletes-setting.js"
import { isKeptOriginalKey } from "./video-original-keys.js"
import type { JobOutputRef } from "./job-policy.js"
import { isOwnedObjectKey, keyStem } from "./job-key-family.js"

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

/** The most outputs we will ever WITHHOLD for one job — 16 variants is double
 *  any variant count the platform produces, and the review route indexes into
 *  this array from client input (its `:index` bound is this number minus one).
 *  A layered image job makes more (a base and up to 99 layers): the review
 *  queue lists only these and counts the rest from `held_output_data`
 *  (`outputTotal`, ee/routes/admin-review.ts), so the page says how many it
 *  does not show. A queue card previews the first 4 of these
 *  (`FIRST_PREVIEWS`, held-job-card.tsx) and fetches the rest only when the
 *  reviewer opens its "+N more" control, so raising this cap adds to what a
 *  reveal fetches, never to what a card fetches when the queue opens.
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

// The key-family rule (`isOwnedObjectKey`, `keyStem`) lives in a leaf module
// so the store-record code can use it without importing this one.
export { isOwnedObjectKey, keyStem } from "./job-key-family.js"

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
 * public-read with a one-year immutable cache and there is no automated purge
 * (single-file purge exists in the Cloudflare dashboard/API), so a URL an edge
 * already served cannot be recalled automatically. NULL `output_data` is the boundary.
 * Deleting is still right — it removes a guessable object for the overwhelmingly
 * common case where nobody guessed it, and stops it accruing storage cost
 * forever. A delete failure logs and changes no verdict.
 *
 * On a deployment that deletes nothing (STORAGE_DELETES=skip) the files stay,
 * and where objects are public by their own ACL they are made private instead
 * (lib/withheld-objects-private.ts). That changes no verdict either.
 */
export async function deleteOwnedObjects(
  jobId: string,
  objects: readonly HeldObject[],
  /** `refundOwner`: give the bytes storage confirms deleted back to the job's
   *  owner (they were counted against their storage when the job stored them).
   *  Nothing is given back where deletes are skipped: the files stay. */
  opts: {
    readonly refundOwner?: boolean
    /** Whether the job is a SET (its size), when the caller already knows it from the row it read; else the row is read. */
    readonly set?: { readonly setCount: number } | null
  } = {},
): Promise<number> {
  // Deduped: callers legitimately union two sources (the withheld list and the
  // row's residue), and the same key must not be sent twice.
  const owned = [...new Set(objects.map((o) => o.key).filter((k) => isOwnedObjectKey(jobId, k)))]
  if (owned.length === 0) return 0
  // A kept original's bytes are its job's record's (decided 2026-11-23): it is
  // claimed off that record, deleted once the claim ran and given back by the
  // claim — never sized here as well, so an original the failure funnel
  // already claimed and refunded is not refunded twice.
  const originals = storageDeletesSkipped() ? [] : owned.filter(isKeptOriginalKey)
  const keys = owned.filter((k) => !originals.includes(k))
  let originalsDeleted = 0
  if (originals.length > 0) {
    const { reapRecordedObjects } = await import("./job-server-output.js")
    originalsDeleted = (await reapRecordedObjects(originals.map((key) => ({ jobId, key })), "job-output")).deleted
  }
  if (keys.length === 0) return originalsDeleted
  // A SET job's objects go through the set's own clean-up, claimed on the job
  // row, so this and the set's other clean-ups never give one back twice.
  let set: { userId?: string; setCount: number; status?: string } | null | undefined = opts.set === undefined ? undefined : opts.set
  let unreadable = false
  try {
    if (set === undefined) set = await (await import("./image-set-storage.js")).setJobOwner(jobId)
  } catch (err) {
    // Whether this is a set cannot be read. Objects that may be a set's
    // pictures still go through the usual path below (a blocked result must
    // not stay at its public key; a failed delete is recorded for the retry
    // pass) with nothing given back, so a set's own clean-up can never give the
    // same bytes back twice. Any other job's objects are handled as always.
    set = null
    unreadable = (await import("./image-set-storage.js")).mayBeSetPictures(jobId, keys)
    if (unreadable) console.warn(`[job-policy] job ${jobId}: its row could not be read; its pictures are deleted without giving storage back: ${(err as Error).message}`)
  }
  if (set) {
    const removed = await (await import("./image-set-storage.js")).discardSetKeys(jobId, set.userId ?? (await ownerOf(jobId)), keys, { setCount: set.setCount, source: "job-policy", ...(set.status ? { rowStatus: set.status } : {}) })
    if (storageDeletesSkipped()) {
      const { keepWithheldObjectsPrivate } = await import("./withheld-objects-private.js")
      await keepWithheldObjectsPrivate(jobId, keys)
    }
    return removed + originalsDeleted
  }
  try {
    const refund = opts.refundOwner === true && !storageDeletesSkipped() && !unreadable
    // Sized BEFORE the delete: a deleted object has no size to read.
    const sizes = refund ? await ownedObjectSizes(keys) : undefined
    // A key storage fails to delete is recorded for the retry pass.
    const { deleteKeysRecordingFailures } = await import("./storage-delete.js")
    const { deleted, notDeleted } = await deleteKeysRecordingFailures(keys, "job-policy", { jobIdOf: () => jobId })
    if (storageDeletesSkipped()) {
      const { keepWithheldObjectsPrivate } = await import("./withheld-objects-private.js")
      await keepWithheldObjectsPrivate(jobId, keys)
    }
    if (sizes) {
      const kept = new Set(notDeleted ?? [])
      const freed = keys.filter((k) => !kept.has(k)).reduce((sum, k) => sum + (sizes.get(k) ?? 0), 0)
      if (freed > 0) await refundOwnerStorage(jobId, freed)
    }
    return deleted + originalsDeleted
  } catch (err) {
    console.warn(`[job-policy] object cleanup failed for job ${jobId}: ${(err as Error).message}`)
    return originalsDeleted
  }
}

/** Each key's stored size (0 when storage cannot say), or undefined when sizing fails: then nothing is given back, and the delete still runs. */
async function ownedObjectSizes(keys: readonly string[]): Promise<Map<string, number> | undefined> {
  try {
    const { getR2ObjectSize } = await import("./storage.js")
    return new Map(await Promise.all(keys.map(async (k) => [k, (await getR2ObjectSize(k)) ?? 0] as const)))
  } catch (err) {
    console.warn(`[job-policy] sizing owned objects failed — their storage is not given back: ${(err as Error).message}`)
    return undefined
  }
}

/** Give `bytes` back to the job owner's storage. Logs, never throws. */
/** The job's owner, read from its row; undefined when it cannot be read. */
async function ownerOf(jobId: string): Promise<string | undefined> {
  try {
    const { supabase } = await import("./supabase.js")
    const { data } = await supabase.from("jobs").select("user_id").eq("id", jobId).single()
    return (data as { user_id?: string | null } | null)?.user_id ?? undefined
  } catch {
    return undefined
  }
}

async function refundOwnerStorage(jobId: string, bytes: number): Promise<void> {
  try {
    const { supabase } = await import("./supabase.js")
    const { data } = await supabase.from("jobs").select("user_id").eq("id", jobId).single()
    const userId = (data as { user_id?: string | null } | null)?.user_id
    if (!userId) return
    const { updateStorageUsage } = await import("../utils/file-validation.js")
    await updateStorageUsage(userId, -bytes)
  } catch (err) {
    console.warn(`[job-policy] giving back job ${jobId}'s storage failed: ${(err as Error).message}`)
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
