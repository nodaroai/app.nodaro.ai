import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { deleteFromR2 } from "./storage.js"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"
import { jobOutputReferrerPaths } from "./job-output-urls.js"
import { relayPossible } from "./relay-possible.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/**
 * THE RELAY DELETE RULE — the instance that CREATED an object deletes it; the
 * other deletes only its row. Spec 2026-09-04-sai-local-development §9.3 (D18),
 * invariants 9 and 10a. Shared by all three delete paths (this module,
 * lib/media-delete.ts, lib/workflow-delete.ts).
 *
 * Why a rule is needed at all: both delete paths prove "no other referrer"
 * against their OWN database. Under the shared-bucket passthrough (§9.2) two
 * instances reference one object out of two databases, and neither can see the
 * other's rows — so a near-end user deleting their generation would destroy an
 * object the hosted job row still points at, for a job this instance never ran.
 *
 * TWO conditions, and the second one is not in the spec's one-line predicate.
 * `relay_job_id IS NOT NULL` alone says the JOB was relayed; it does NOT say
 * the BYTES came from the far end. A relaying instance with its own bucket —
 * every laptop, where `R2_SHARED_WITH_RELAY_TARGET` is false by design —
 * downloaded the far end's output and re-uploaded it under ITS OWN key. It
 * owns those bytes, `trackStorage` charged the quota for them, and skipping
 * the delete there would leak an object and ratchet `storage_used_bytes` up on
 * every single generation. So ownership is settled by the KEY FAMILY, the same
 * `<jobId>-` stem rule `deleteOwnedOutputObjects` already uses: a key in this
 * job's own family is ours whatever the row says, and only a FOREIGN key on a
 * relayed row is the far end's. That also makes the rule independent of the
 * flag's current value, which matters because a flag flipped after the fact
 * would otherwise misclassify every historical row in one direction or the
 * other.
 *
 * WHERE THE MARKER LIVES, and why it is not just the job row. `assets.job_id`
 * is `REFERENCES jobs(id) ON DELETE SET NULL` (001_initial_schema.sql), so the
 * ordinary "delete this job from my history" action NULLs the link on the
 * SURVIVING library row — and the job-row marker becomes unreachable exactly
 * when the library's own permanent delete needs it. So the marker is ALSO
 * stamped onto the asset at creation (`assets.relay_job_id`, migration 384,
 * written by `createAssetFromJob`) where nothing cascades it away, and the
 * predicate below consults it first. The job-row path stays as the fallback
 * for callers holding a job and no asset (media-process's source delete,
 * media-delete's job-output proof, workflow-delete's job scope).
 *
 * THE THIRD LINE: THE KEY STEM, and why two row markers were not enough. Both
 * markers live on a ROW, and three reachable sequences outlive every row:
 *   (A) another user SAVES a relayed output from the public gallery
 *       (`POST /v1/library/save-generated` inserts `r2_key` and nothing else —
 *       `relay_job_id` and `job_id` are written by `createAssetFromJob` alone),
 *       then permanently deletes their copy after the original row is gone;
 *   (B) the library row is permanently deleted (marker honoured, object kept)
 *       and the LOCATION / object / creature that also references the url is
 *       deleted afterwards — the marker left with the row it lived on;
 *   (C) `POST /v1/media/delete` proves ownership from a near-end alias (the
 *       save-to-storage node, which under the passthrough stores a REFERENCE),
 *       so the row that answers is not the relayed one.
 * In all three the object itself still says who made it: the far end's key stem
 * IS the far end's job id, and `jobs.relay_job_id` stores exactly that id under
 * migration 383's partial index. So the last question this predicate asks is
 * about the OBJECT — `jobs.relay_job_id = <stem of the key>` — which no near-end
 * row delete can erase. `objectKeyJobIdCandidates` (job-policy-outputs.ts) is
 * `isOwnedObjectKey` read backwards, so the fence and the family rule share one
 * definition of a stem.
 *
 * It cannot misfire on a near-end key: candidates are job-id-shaped stems of
 * OUR bucket's keys, and `relay_job_id` only ever holds a FAR end's job id.
 * Answering yes would need two databases to mint the same UUID.
 *
 * The order matters and is: the arming gate (no relay target ⇒ no query at
 * all), then our own key family (flag- and marker-independent), then the
 * durable asset marker, then the referring job row, then the key stem. A key
 * that answers "no" to all of them is deletable — that is the ordinary mainline
 * orphan (job deleted, then library item deleted), and answering "keep" for it
 * would leak an R2 object on every mainline deployment.
 *
 * ERROR POLICY: a lookup failure answers FALSE, not true. This read is a
 * positive-marker check, not a referrer proof, and answering true on a
 * transient error would skip deletes that succeed today on every mainline
 * deployment — the byte-identity this whole change rests on. It is also not
 * the last line of defence: the referrer checks below fail safe toward KEEPING
 * data on exactly the same outage, so a database that cannot answer this
 * question cannot answer theirs either and the object survives anyway.
 *
 * Byte-inert without a relay: `relay_job_id` is NULL on every row any
 * non-relaying instance can produce, in every edition.
 */
export async function isRelayOwnedObject(
  jobId: string | null | undefined,
  r2Key: string | null | undefined,
  /** The ASSET row's own durable marker (`assets.relay_job_id`). Answered
   *  first among the positive markers because it is the only one that survives
   *  `assets.job_id`'s ON DELETE SET NULL — see the paragraph above. */
  assetRelayJobId?: string | null,
): Promise<boolean> {
  if (!r2Key) return false
  // The arming gate: an instance with no relay target cannot be holding another
  // instance's object, so it asks nothing and behaves exactly as it always did.
  if (!relayPossible()) return false
  // Our own key family ⇒ we wrote these bytes, relayed job or not. Flag- and
  // marker-independent, and it still wins over every marker below.
  if (jobId && isOwnedObjectKey(jobId, r2Key)) return false
  // The durable marker. Server-written at asset creation, never user-settable,
  // and unaffected by the job row's fate.
  if (assetRelayJobId) return true
  // The referring job's own row — the fallback for callers holding a job and no
  // asset (media-process's source delete, workflow-delete's job scope).
  if (jobId && (await isRelayedJob(jobId))) return true
  // The object itself. Asked last because it is the only one that costs a query
  // no marker could have saved, and answered for a caller with NO job id at all
  // (the gallery-save row) — which is exactly the case the markers cannot see.
  return (await relayStemOwnedKeys([r2Key])).has(r2Key)
}

/**
 * THE STEM PROBE. `jobs.relay_job_id in (<the job ids these keys could carry>)`
 * — one indexed query (migration 383's partial index), chunked so a reaper
 * batch cannot build an unbounded PostgREST filter.
 *
 * Keyed on the OBJECT rather than on any row that references it, which is what
 * makes it survive the asset row AND the referring job row (see the long note
 * on `isRelayOwnedObject`). EMPTY on every deployment that never relays: the
 * partial index holds no rows there, and the arming gate above means the query
 * is not even issued.
 *
 * ERROR POLICY: a failure answers the empty set, the same as every other step —
 * see `isRelayOwnedObject`'s note. Per CHUNK, so one failing page cannot
 * discard the answers the others already gave.
 */
const STEM_PROBE_CHUNK = 100

async function relayStemOwnedKeys(keys: readonly string[]): Promise<Set<string>> {
  const keysByCandidate = new Map<string, string[]>()
  for (const key of keys) {
    for (const candidate of objectKeyJobIdCandidates(key)) {
      const bucket = keysByCandidate.get(candidate)
      if (bucket) bucket.push(key)
      else keysByCandidate.set(candidate, [key])
    }
  }
  const owned = new Set<string>()
  const candidates = [...keysByCandidate.keys()]
  for (let i = 0; i < candidates.length; i += STEM_PROBE_CHUNK) {
    const chunk = candidates.slice(i, i + STEM_PROBE_CHUNK)
    try {
      const { data, error } = await supabase
        // Deliberately NOT scoped by user: the question is "did our relay
        // target create these bytes", and the far end's job may sit under any
        // near-end user (a gallery save crosses tenants by design). The answer
        // can only ever KEEP an object — it never reads or deletes another
        // tenant's row.
        .from("jobs")
        .select("relay_job_id")
        .in("relay_job_id", chunk)
      if (error) {
        console.warn(
          `[relay-delete] stem probe failed for ${chunk.length} candidate(s): ${error.message} ` +
            "— treating them as ours (the same error policy as isRelayOwnedObject)",
        )
        continue
      }
      for (const row of (data ?? []) as Array<{ relay_job_id: string | null }>) {
        const hits = row.relay_job_id ? keysByCandidate.get(row.relay_job_id) : undefined
        if (hits) for (const key of hits) owned.add(key)
      }
    } catch (err) {
      console.warn("[relay-delete] stem probe threw:", err)
    }
  }
  return owned
}

/**
 * The BATCH half of the same rule, for the delete paths that hold R2 keys and
 * no job at all: the locations / objects / creatures permanent deletes (which
 * `batchDeleteFromR2` a whole entity's harvested urls) and workflow-delete's
 * workflow and project scopes, whose RPC cascades the `jobs` rows away before
 * handing the keys back.
 *
 * One query, and it is empty on mainline: `assets.relay_job_id` is NULL on
 * every row a non-relaying instance can produce, and migration 384's partial
 * index contains no rows at all there. Flag-independent for the same reason
 * `isRelayOwnedObject` is — a flag flipped after the fact must not reclassify
 * history.
 *
 * TWO probes, asked in that order, and the second is why an entity delete can
 * no longer reach a far object:
 *   (1) the durable per-object marker `assets.relay_job_id` (migration 384);
 *   (2) for whatever (1) did not settle, the KEY STEM — `jobs.relay_job_id in
 *       (<candidate ids>)`, migration 383's index. An asset row that was itself
 *       permanently deleted first took its marker with it, so `<entity> delete`
 *       after `library delete` used to reach the far end's bytes; the stem lives
 *       on the object, not on a row, and still answers.
 *
 * ERROR POLICY: a lookup failure answers the EMPTY set for THAT probe, matching
 * `isRelayOwnedObject` — these paths carry no other referrer proof today, so
 * answering "keep" on a transient error would silently start leaking objects on
 * mainline. Per probe, so one failing read never discards the other's answer.
 */
export async function relayOwnedKeys(keys: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  if (unique.length === 0) return new Set()
  // The arming gate, as in `isRelayOwnedObject`: no relay target, no query.
  if (!relayPossible()) return new Set()

  const marked = await relayMarkedAssetKeys(unique)
  // The stem probe is asked only about what the marker did NOT settle, and it
  // is the half that answers after the marked row itself was deleted — the
  // "<entity> delete after library delete" residual the note above used to
  // merely document.
  const undecided = unique.filter((k) => !marked.has(k))
  if (undecided.length === 0) return marked
  for (const key of await relayStemOwnedKeys(undecided)) marked.add(key)
  return marked
}

/** Marker (1) of the batch rule: `assets.relay_job_id`, migration 384. */
async function relayMarkedAssetKeys(unique: readonly string[]): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("assets")
      .select("r2_key, relay_job_id")
      .in("r2_key", unique)
      .not("relay_job_id", "is", null)
    if (error) {
      console.warn(
        `[relay-delete] could not read relay provenance for ${unique.length} key(s): ${error.message} ` +
          "— treating them as ours (the same error policy as isRelayOwnedObject)",
      )
      return new Set()
    }
    const rows = (data ?? []) as Array<{ r2_key: string | null; relay_job_id: string | null }>
    return new Set(rows.filter((r) => !!r.r2_key && !!r.relay_job_id).map((r) => r.r2_key as string))
  } catch (err) {
    console.warn("[relay-delete] batch relay provenance read threw:", err)
    return new Set()
  }
}

/**
 * `batchDeleteFromR2` input, minus anything our relay target created. Logs the
 * kept keys so an operator can see the rule fire. Returns the input array
 * unchanged (same order, same identity of every element) when nothing is
 * relay-owned, which is every mainline call.
 */
export async function deletableKeys(keys: readonly string[]): Promise<string[]> {
  const kept = await relayOwnedKeys(keys)
  if (kept.size === 0) return [...keys]
  console.log(
    `[relay-delete] keeping ${kept.size} R2 object(s) created by our relay target: ${[...kept].join(", ")}`,
  )
  return keys.filter((k) => !kept.has(k))
}

/**
 * Half of the rule above: was this job relayed at all? Exported separately for
 * the one caller that cannot ask the whole question at once —
 * `lib/workflow-delete.ts` must read this BEFORE its RPC, which cascades the
 * `jobs` row away before handing back the object keys. It pairs that answer
 * with `isOwnedObjectKey` itself.
 */
export async function isRelayedJob(jobId: string | null | undefined): Promise<boolean> {
  if (!jobId) return false

  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("relay_job_id")
      .eq("id", jobId)
      .maybeSingle()

    if (error) {
      console.warn(
        `[relay-delete] could not read relay provenance for job ${jobId}: ${error.message} ` +
          "— treating the object as ours (the referrer checks fail safe on the same outage)",
      )
      return false
    }
    return !!data?.relay_job_id
  } catch (err) {
    console.warn(`[relay-delete] relay provenance read threw for job ${jobId}:`, err)
    return false
  }
}

/**
 * The job behind an asset row, for callers that did not select it.
 * `routes/library.ts` selects `id, user_id, r2_key, size_bytes`, so its
 * `job_id` arrives `undefined` and the rule above would be unenforceable for
 * the library's own permanent delete. `null` means "the caller asked and there
 * is none" and costs no query.
 */
async function resolveAssetProvenance(
  asset: OwnedAssetRow,
): Promise<{ jobId: string | null; relayJobId: string | null }> {
  if (asset.job_id !== undefined && asset.relay_job_id !== undefined) {
    return { jobId: asset.job_id, relayJobId: asset.relay_job_id }
  }
  // Behind the arming gate like every other read the rule added: on an instance
  // with no relay target the answer cannot change the outcome, so a caller that
  // did not select these columns must not pay a round trip for them.
  if (!relayPossible()) {
    return { jobId: asset.job_id ?? null, relayJobId: asset.relay_job_id ?? null }
  }
  try {
    const { data, error } = await supabase
      .from("assets")
      .select("job_id, relay_job_id")
      .eq("id", asset.id)
      .maybeSingle()
    if (error) {
      console.warn(`[relay-delete] could not read provenance for asset ${asset.id}: ${error.message}`)
      return { jobId: asset.job_id ?? null, relayJobId: asset.relay_job_id ?? null }
    }
    return {
      jobId: asset.job_id !== undefined ? asset.job_id : ((data?.job_id as string | null) ?? null),
      relayJobId:
        asset.relay_job_id !== undefined
          ? asset.relay_job_id
          : ((data?.relay_job_id as string | null) ?? null),
    }
  } catch (err) {
    // Best-effort, like every other step of this provenance read: an
    // unanswerable lookup must never turn a user's delete into a 500.
    console.warn(`[relay-delete] provenance lookup threw for asset ${asset.id}:`, err)
    return { jobId: asset.job_id ?? null, relayJobId: asset.relay_job_id ?? null }
  }
}

/**
 * The platform's canonical permanent asset delete — the exact logic that
 * `DELETE /v1/library/:id?permanent=true` (routes/library.ts) shipped with,
 * extracted so `POST /v1/media/delete` (lib/media-delete.ts) can reuse it
 * instead of growing a drifting second copy.
 *
 * Lives in lib/, not the route, because routes may not import the service-role
 * client (backend/scripts/check-admin-client-import.mjs): this helper takes the
 * owner as an EXPLICIT parameter (precedent: lib/asset-records.ts), and every
 * destructive query is additionally scoped by `.eq("user_id", userId)` so a
 * caller that got the ownership check wrong still cannot delete across tenants.
 *
 * What it does, in order:
 *   1. Referrer safety — the R2 object is removed only when no OTHER assets row
 *      references the same `r2_key` (content-addressed safety: another user may
 *      have saved this output from the public gallery via save-generated).
 *      Lookup errors fail safe toward keeping data.
 *   2. Optionally (`blockOnOwnJobReferrers`) also keeps the object when one of
 *      the caller's OWN jobs' `output_data` points at it — the library page's
 *      semantics, where deleting a library row must not break the gallery /
 *      job-history entry that reads `jobs.output_data`. `POST /v1/media/delete`
 *      passes `false`: there the caller names the URL itself, so orphaning
 *      their own job entry is their deliberate choice (they deleted the export).
 *   3. Deletes the caller's assets row (scoped by user_id) and, only when a row
 *      was actually deleted (`.select("id")` returning-rows guard, so a
 *      concurrent double-delete cannot decrement twice), refunds the row's
 *      `size_bytes` from the user's tracked storage — the same way the quota
 *      was charged at upload/generation time.
 *
 * Step 0, ahead of all of that: the RELAY rule (`isRelayOwnedObject` below).
 * An object created by this instance's relay target is neither deleted nor
 * refunded here — the row goes, the bytes and the quota do not move.
 */
export interface OwnedAssetRow {
  id: string
  r2_key: string | null
  size_bytes: number | null
  /** The job that produced this asset. OPTIONAL, and the three states differ:
   *  a string or `null` is the caller's answer and is taken as given; omitting
   *  it entirely (routes/library.ts's select) makes this module look it up, so
   *  the relay delete rule holds for callers that never heard of it. */
  job_id?: string | null
  /** The DURABLE relay marker (`assets.relay_job_id`, migration 384). Same
   *  three states as `job_id`. This is the column that still answers after a
   *  job-history delete has NULLed `job_id` through its FK — the case where
   *  `job_id` alone silently disarms the whole rule. */
  relay_job_id?: string | null
}

export type PermanentDeleteResult =
  | { ok: true; r2Deleted: boolean }
  | { ok: false; dbError: { message: string } }

export async function permanentlyDeleteAsset(opts: {
  userId: string
  asset: OwnedAssetRow
  blockOnOwnJobReferrers: boolean
}): Promise<PermanentDeleteResult> {
  const { userId, asset, blockOnOwnJobReferrers } = opts
  let r2Deleted = false

  // Relay rule first (see isRelayOwnedObject): when the bytes were created by
  // our relay target we drop our row and nothing else — not the object, and
  // NOT the quota, which the shared-bucket passthrough never charged.
  const provenance = asset.r2_key ? await resolveAssetProvenance(asset) : null
  const relayOwned = provenance
    ? await isRelayOwnedObject(provenance.jobId, asset.r2_key, provenance.relayJobId)
    : false

  if (relayOwned) {
    console.log(
      `[asset-delete] Keeping R2 object ${asset.r2_key}: created by our relay target ` +
        "(the job carries relay_job_id and the key is not in this job's family) — " +
        "row and quota accounting proceed, the bytes are the far end's to delete",
    )
  }

  try {
    if (asset.r2_key && !relayOwned) {
      // Content-addressed safety: another row may reference the SAME R2 object,
      // so deleting it would turn that row into a permanent broken link (R2
      // objects are unrecoverable). Checked across ALL users — this is also the
      // backstop that stops a caller whose own job/asset row merely ECHOES a
      // url from destroying an object other tenants still own.
      const { count: otherAssetRefs, error: assetRefError } = await supabase
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("r2_key", asset.r2_key)
        .neq("id", asset.id)

      // Fail safe: a query error means we can't prove there are no referrers.
      const assetRefsExist = !!assetRefError || (!!otherAssetRefs && otherAssetRefs > 0)

      // Reconstruct the public URL exactly as stored in jobs.output_data
      // (mirror of workers/shared.ts: r2Key = url.replace(R2_PUBLIC_URL + "/", "")).
      const publicUrl = config.R2_PUBLIC_URL
        ? `${config.R2_PUBLIC_URL}/${asset.r2_key}`
        : asset.r2_key

      // Check the media-URL paths the gallery/job-history extractors read,
      // one .eq() per path — NOT a hand-built .or() string. PostgREST does
      // NOT quote values inside an .or() filter, and a public URL contains
      // reserved chars (`:` `.` `,`) that corrupt the filter; passing the
      // value as an .eq() argument lets supabase-js encode it safely (same
      // pattern as suno.ts `.eq("metadata->>kie_task_id", …)`). Skipped
      // entirely when an asset referrer already keeps the object alive.
      //
      // The list is shared (lib/job-output-urls.ts) and flag-gated: three
      // paths off the shared-bucket flag, exactly as this probe has always
      // issued, and the full list on it — because the passthrough lets a
      // SECOND near-end job alias this object with no assets row of its own
      // (`save-to-storage` writes `output_data.url`), and without that path
      // deleting the source silently breaks the save node's output.
      let otherJobRefs = 0
      let jobRefError: { message: string } | null = null
      if (!assetRefsExist && blockOnOwnJobReferrers) {
        for (const path of jobOutputReferrerPaths()) {
          const { count, error } = await supabase
            .from("jobs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq(path, publicUrl)
          if (error) {
            jobRefError = error
            break
          }
          otherJobRefs += count ?? 0
          if (otherJobRefs > 0) break
        }
      }
      // Fail safe: a query error means we can't prove there are no
      // referrers, so treat it as if one exists and skip the R2 delete.
      const jobRefsExist = !!jobRefError || otherJobRefs > 0

      if (!assetRefsExist && !jobRefsExist) {
        await deleteFromR2(asset.r2_key)
        r2Deleted = true
      } else {
        console.log(
          `[asset-delete] Skipping R2 delete for ${asset.r2_key}: ` +
            `${otherAssetRefs ?? 0} other asset(s) and ${otherJobRefs} job(s) reference it` +
            (jobRefError ? ` (jobs check errored: ${jobRefError.message})` : ""),
        )
      }
    }
  } catch (err) {
    console.error("[asset-delete] R2 delete failed (continuing):", err)
  }

  // Delete the row, scoped by owner, RETURNING the deleted ids so the storage
  // decrement below runs only when THIS call actually removed the row — two
  // concurrent deletes of the same asset must not decrement the quota twice.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("assets")
    .delete()
    .eq("id", asset.id)
    .eq("user_id", userId)
    .select("id")

  if (deleteError) {
    return { ok: false, dbError: deleteError }
  }

  try {
    // A relay-owned object is never counted against this instance's quota, in
    // EITHER direction: `uploadToR2`'s passthrough returns before trackStorage
    // (lib/storage.ts), so no increment ever happened and a decrement here
    // would drive storage_used_bytes negative one object at a time — the
    // mirror image of the `size_bytes: 0` ratchet workers/shared.ts guards
    // against. Spec §9.3, invariant 10a.
    const sizeBytes = relayOwned ? 0 : asset.size_bytes ?? 0
    if (sizeBytes > 0 && (deletedRows?.length ?? 0) > 0) {
      await updateStorageUsage(userId, -sizeBytes)
    }
  } catch (err) {
    console.error("[asset-delete] Storage usage update failed:", err)
  }

  return { ok: true, r2Deleted }
}
