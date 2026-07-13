import { supabase } from "./supabase.js"
import { deleteFromR2, r2KeyFromOurUrl } from "./storage.js"
import { permanentlyDeleteAsset } from "./asset-delete.js"

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
 */

export type MediaDeleteSkipReason = "foreign" | "not-owned" | "in-use" | "error"

export interface MediaDeleteResult {
  deleted: string[]
  skipped: Array<{ url: string; reason: MediaDeleteSkipReason }>
}

/**
 * `output_data` keys that hold a single output URL, across every job type that
 * writes them: imageUrl/videoUrl/audioUrl are the standard worker outputs
 * (workers/shared.ts — the same three keys the gallery/job-history extractors
 * and the library referrer check read); vocalsUrl/backgroundUrl/unmappedUrl are
 * the voice-changer-pro analyze/recast stem outputs (cloud-plugins
 * voice-changer-pro/handler.ts) — row-less, so path (b) is their only owner
 * proof. One `.eq()` per key, NEVER a hand-built `.or()` string: PostgREST does
 * not quote values inside an `.or()` filter and URLs contain reserved chars
 * (`:` `.` `,`) that corrupt it; `.eq()` arguments are encoded safely.
 */
const JOB_OUTPUT_URL_KEYS = [
  "imageUrl",
  "videoUrl",
  "audioUrl",
  "vocalsUrl",
  "backgroundUrl",
  "unmappedUrl",
] as const

/**
 * True when a job owned by `userId` references `url` in its `output_data`,
 * under any known url-bearing key. Array-shaped outputs (voice-changer-pro
 * `voiceStems: [{ speakerId, url }]`) are matched with a jsonb containment
 * filter — `.contains()` sends the pattern as a JSON document, so the url's
 * reserved characters are safe (same reason as the per-key `.eq()`s).
 *
 * Returns "error" when a lookup fails — the caller cannot distinguish
 * "no proof" from "could not check", and must not delete on a failed check.
 */
async function jobOutputOwnershipProof(
  userId: string,
  url: string,
): Promise<"proven" | "no-proof" | "error"> {
  let sawError = false

  for (const key of JOB_OUTPUT_URL_KEYS) {
    const { count, error } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq(`output_data->>${key}`, url)
    if (error) {
      sawError = true
      continue
    }
    if ((count ?? 0) > 0) return "proven"
  }

  const { count: stemCount, error: stemError } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .contains("output_data", { voiceStems: [{ url }] })
  if (stemError) {
    sawError = true
  } else if ((stemCount ?? 0) > 0) {
    return "proven"
  }

  return sawError ? "error" : "no-proof"
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
    .select("id, r2_key, size_bytes")
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
  if (proof === "error") return { status: "skipped", reason: "error" }
  if (proof === "no-proof") return { status: "skipped", reason: "not-owned" }

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
