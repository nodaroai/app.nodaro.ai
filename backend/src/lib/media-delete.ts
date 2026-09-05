import { supabase } from "./supabase.js"
import { deleteFromR2, r2KeyFromOurUrl } from "./storage.js"
import { permanentlyDeleteAsset, isRelayOwnedObject } from "./asset-delete.js"
import { isOwnedObjectKey } from "./job-policy-outputs.js"
import { JOB_OUTPUT_URL_PATHS } from "./job-output-urls.js"
import { relayPossible } from "./relay-possible.js"

/**
 * Best-effort, strictly-owned bulk media deletion for `POST /v1/media/delete`
 * — the endpoint client apps (voice.nodaro.ai) call so that deleting an
 * export/conversion in the app REALLY deletes the bytes, not just the row in
 * the app's own state.
 *
 * Lives in lib/, not the route, because routes may not import the service-role
 * client (backend/scripts/check-admin-client-import.mjs): every query here is
 * scoped by an EXPLICIT `userId` parameter (precedent: lib/asset-records.ts).
 *
 * Per url, in order (first match wins; anything else skips — deletion is
 * idempotent housekeeping, so the batch always resolves, never throws):
 *
 *   foreign   — not an object in OUR R2 bucket (`r2KeyFromOurUrl` → null).
 *
 *   (a) assets-row proof — the caller owns an `assets` row with this `r2_key`.
 *       Runs the platform's canonical permanent delete (lib/asset-delete.ts):
 *       cross-user referrer safety, R2 object delete, row delete, storage
 *       decrement. `blockOnOwnJobReferrers: false` — unlike the library page,
 *       the caller names the URL itself here, so their own job's output_data
 *       entry dangling afterwards is their deliberate choice (they deleted the
 *       export); without this, deleting a generation's auto-created asset row
 *       would always keep the object alive "for" the very job being cleaned up.
 *
 *   (b) job-output proof — no assets row, but a job OWNED BY THE CALLER has
 *       this url in its `output_data`. Covers outputs that never get assets
 *       rows: `createAssetFromJob` (workers/shared.ts) only reads
 *       imageUrl/videoUrl/audioUrl, so e.g. voice-changer-pro stems
 *       (`voiceStems[].url`, `vocalsUrl`, `backgroundUrl`, `unmappedUrl`) are
 *       row-less. Deletes the R2 object ONLY:
 *         - no row to delete, and NO storage decrement — the decrement's unit
 *           of account is the assets row (`size_bytes`), and decrementing here
 *           could double-refund bytes whose row was already deleted (and
 *           refunded) via path (a) while the object survived on a referrer.
 *         - `output_data` is left as-is; the dangling url is documented,
 *           accepted, and harmless (a later referrer check that counts the
 *           dangling job merely skips deleting an object that is already gone
 *           — S3 deletes of missing keys are no-ops anyway).
 *       Still blocked (`in-use`) when ANY assets row references the key — that
 *       row may be another user's gallery save, and it is also the backstop
 *       that stops a caller whose job output merely ECHOES someone else's url
 *       from destroying an object other tenants still own.
 *
 *   not-owned — neither proof.
 *
 * RELAY RULE, applying to both proofs (spec 2026-09-04-sai-local-development
 * §9.3, D18): when the proving job was relayed to a connected Nodaro cloud and
 * the object is not in that job's own key family, the bytes were created by the
 * FAR end, whose job row still points at them and which cannot see ours. The
 * object survives; the url is still reported `deleted`, exactly as the existing
 * "kept for another referrer" branch reports — from the caller's perspective
 * their reference is gone either way, and a new skip reason would widen this
 * endpoint's contract for a distinction its callers cannot act on.
 */

export type MediaDeleteSkipReason = "foreign" | "not-owned" | "in-use" | "error"

export interface MediaDeleteResult {
  deleted: string[]
  skipped: Array<{ url: string; reason: MediaDeleteSkipReason }>
}

/**
 * The ownership-proof path list now lives in lib/job-output-urls.ts, shared
 * with lib/asset-delete.ts and routes/media-process.ts so the three cannot
 * drift again. This path walks the FULL list, always: proving "this url is
 * mine" from `output_data` is correct however the object got there, and the
 * shared-bucket flag is about round trips on the referrer probes, not here.
 */

/**
 * True when a job owned by `userId` references `url` in its `output_data`,
 * under any known URL-bearing path. Array-shaped outputs (voice-changer-pro
 * `voiceStems: [{ speakerId, url }]`) are matched with a jsonb containment
 * filter — `.contains()` sends the pattern as a JSON document, so the url's
 * reserved characters are safe (same reason as the per-key `.eq()`s).
 *
 * Returns "error" when a lookup fails — the caller cannot distinguish
 * "no proof" from "could not check", and must not delete on a failed check.
 */
type OwnershipProof = { status: "proven" | "no-proof" | "error" }

/**
 * FIRST MATCH WINS, and that is correct HERE and nowhere else. This function
 * answers one question — "is this url the caller's?" — and any single matching
 * row settles it, so it stops at the first hit and mainline pays the same
 * queries it always did.
 *
 * What it must NOT be used for is deciding WHO MADE THE BYTES. Under the
 * shared-bucket passthrough a second near-end job aliases the same object
 * (`save-to-storage` stores a reference, writing `output_data.url`), and
 * `output_data->>url` sorts before the row-less paths a relayed VCP/recast
 * output lands under — so the alias routinely wins this race. The relay probe
 * below therefore asks about the OBJECT and about EVERY relayed referrer,
 * never about whichever row happened to answer first.
 */
async function jobOutputOwnershipProof(userId: string, url: string): Promise<OwnershipProof> {
  let sawError = false

  for (const path of JOB_OUTPUT_URL_PATHS) {
    const { count, error } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq(path, url)
    if (error) {
      sawError = true
      continue
    }
    if ((count ?? 0) > 0) return { status: "proven" }
  }

  const { count: stemCount, error: stemError } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .contains("output_data", { voiceStems: [{ url }] })
  if (stemError) {
    sawError = true
  } else if ((stemCount ?? 0) > 0) {
    return { status: "proven" }
  }

  return { status: sawError ? "error" : "no-proof" }
}

/**
 * Were these bytes created by our relay target? Asked AFTER a proof succeeded
 * and only when `relayPossible()`, so a deployment with no relay target issues
 * none of it.
 *
 * TWO questions, cheapest and most durable first:
 *
 *   (1) THE OBJECT. `isRelayOwnedObject(null, r2Key)` runs the shared
 *       predicate's key-stem probe — `jobs.relay_job_id = <stem>` — which asks
 *       who MADE the bytes rather than which of our rows happens to name them.
 *       One indexed query, and it is the only line that still answers when the
 *       relayed job has been deleted from history and no assets row survives.
 *
 *   (2) EVERY RELAYED REFERRER, not the one that won the proof. The old shape
 *       replayed the proof's winning matcher, and the proof stops at the first
 *       hit: under the passthrough `output_data->>url` (save-to-storage, which
 *       stores a REFERENCE) sorts ahead of `vocalsUrl` / `backgroundUrl` /
 *       `unmappedUrl` and the recast layer paths, so a NON-relayed alias
 *       routinely won and answered "not relayed" for a far-end object. Walking
 *       the full list against relayed rows only removes that race, and it costs
 *       nothing on mainline because the gate above never lets it run. Stops at
 *       the first relayed referrer whose own key family excludes the key.
 *
 * A lookup error answers false — see isRelayOwnedObject's error policy; the
 * referrer check immediately after fails safe toward keeping the object on the
 * same outage.
 */
async function relayOwnedForProvenUrl(userId: string, url: string, r2Key: string): Promise<boolean> {
  if (await isRelayOwnedObject(null, r2Key)) return true

  // A NEW builder per filter: supabase-js filter builders are mutable and
  // return `this`, so reusing one would AND all twelve predicates together and
  // the walk would silently match nothing.
  const relayedRows = () =>
    supabase
      .from("jobs")
      .select("id, relay_job_id")
      .eq("user_id", userId)
      .not("relay_job_id", "is", null)
      .limit(5)

  const filters = [
    ...JOB_OUTPUT_URL_PATHS.map((path) => () => relayedRows().eq(path, url)),
    () => relayedRows().contains("output_data", { voiceStems: [{ url }] }),
  ]

  for (const build of filters) {
    const { data, error } = await build()
    if (error) {
      console.warn(`[media-delete] relay provenance lookup failed for ${r2Key}: ${error.message}`)
      return false
    }
    const hit = ((data ?? []) as Array<{ id: string; relay_job_id: string | null }>).some(
      (row) => !!row.relay_job_id && !isOwnedObjectKey(row.id, r2Key),
    )
    if (hit) return true
  }
  return false
}

async function deleteOwnedMediaByUrl(
  userId: string,
  url: string,
): Promise<{ status: "deleted" } | { status: "skipped"; reason: MediaDeleteSkipReason }> {
  // 1. Bucket gate — only objects in OUR R2 bucket; foreign URLs are skipped
  //    (also every URL when R2_PUBLIC_URL is unset — nothing is mappable then).
  const r2Key = r2KeyFromOurUrl(url)
  if (!r2Key) return { status: "skipped", reason: "foreign" }

  // 2. Ownership proof (a): the caller's own assets row for this object.
  //    `.limit(1).maybeSingle()` — r2_key is not formally unique, and a
  //    duplicate row surviving this delete keeps the object alive via the
  //    referrer check inside permanentlyDeleteAsset, which is the safe outcome.
  const { data: ownedAsset, error: ownedError } = await supabase
    .from("assets")
    // `job_id` and `relay_job_id` ride along so the shared delete core can
    // apply the relay rule without a second lookup (lib/asset-delete.ts
    // resolveAssetProvenance). `relay_job_id` is the half that still answers
    // after a job-history delete NULLed `job_id` through its FK.
    .select("id, r2_key, size_bytes, job_id, relay_job_id")
    .eq("r2_key", r2Key)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (ownedError) {
    console.warn(`[media-delete] ownership lookup failed for ${r2Key}: ${ownedError.message}`)
    return { status: "skipped", reason: "error" }
  }

  if (ownedAsset) {
    const result = await permanentlyDeleteAsset({
      userId,
      asset: ownedAsset,
      blockOnOwnJobReferrers: false,
    })
    if (!result.ok) {
      console.warn(`[media-delete] asset row delete failed for ${r2Key}: ${result.dbError.message}`)
      return { status: "skipped", reason: "error" }
    }
    // Deleted from the caller's perspective even when the object was kept for
    // another referrer: their row is gone and their quota refunded; the object
    // survives only because someone else's library still needs it.
    return { status: "deleted" }
  }

  // 3. Ownership proof (b): a caller-owned job's output_data references it.
  const proof = await jobOutputOwnershipProof(userId, url)
  if (proof.status !== "proven") {
    return { status: "skipped", reason: proof.status === "error" ? "error" : "not-owned" }
  }

  // 3a. The relay rule: these bytes are the far end's. Report deleted, delete
  //     nothing. No decrement is involved on this path either way — its unit of
  //     account is the assets row, and there is none here. Behind the arming
  //     gate, so a deployment with no relay target issues nothing here at all.
  if (relayPossible() && (await relayOwnedForProvenUrl(userId, url, r2Key))) {
    console.log(
      `[media-delete] keeping R2 object ${r2Key}: created by our relay target ` +
        "(its key stem, or a relayed referrer, names the far job) — reported deleted, " +
        "bytes left to the far end",
    )
    return { status: "deleted" }
  }

  // Referrer safety before the object delete: ANY assets row (the caller has
  // none — that's how we got here, so every hit is another user's) still needs
  // the object. Lookup errors fail safe toward keeping data.
  const { count: assetRefs, error: refError } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("r2_key", r2Key)
  if (refError || (assetRefs ?? 0) > 0) {
    console.log(
      `[media-delete] keeping R2 object ${r2Key}: ${assetRefs ?? "?"} asset row(s) reference it` +
        (refError ? ` (referrer check errored: ${refError.message})` : ""),
    )
    return { status: "skipped", reason: "in-use" }
  }

  try {
    await deleteFromR2(r2Key)
  } catch (err) {
    console.warn(`[media-delete] R2 delete failed for ${r2Key}:`, err)
    return { status: "skipped", reason: "error" }
  }
  return { status: "deleted" }
}

/**
 * Delete a batch of urls for `userId`, best-effort. Never throws; every input
 * url lands in exactly one of `deleted` / `skipped`. Duplicate urls are
 * processed once (and reported once) — without the dedupe, `[url, url]` would
 * delete the assets row on the first pass and then reach the job-output proof
 * on the second, destroying an object the first pass deliberately kept for a
 * referrer.
 */
export async function deleteOwnedMediaByUrls(
  userId: string,
  urls: string[],
): Promise<MediaDeleteResult> {
  const deleted: string[] = []
  const skipped: Array<{ url: string; reason: MediaDeleteSkipReason }> = []
  const seen = new Set<string>()

  for (const url of urls) {
    if (seen.has(url)) continue
    seen.add(url)

    try {
      const result = await deleteOwnedMediaByUrl(userId, url)
      if (result.status === "deleted") {
        deleted.push(url)
      } else {
        skipped.push({ url, reason: result.reason })
      }
    } catch (err) {
      console.warn(`[media-delete] unexpected failure for ${url}:`, err)
      skipped.push({ url, reason: "error" })
    }
  }

  return { deleted, skipped }
}
