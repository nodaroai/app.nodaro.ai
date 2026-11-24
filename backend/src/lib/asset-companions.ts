// The recording half (config + the key-family rule): the worker records
// companions at asset creation; the delete half lives in
// asset-companion-release.ts.
import { config } from "./config.js"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"
import { isCanonicalObjectKey } from "./key-ownership.js"

/**
 * COMPANION FILES: a job's own secondary files that belong to one of its
 * Library items and go with it.
 *
 * A job's Library row names one object (`assets.r2_key`). Some results ride
 * with a second file of the same job that is not a Library item of its own but
 * that the owner can still play and download beside the result — Video
 * Remake's engine version beside an upscaled result (`engineVideoUrl`). Such a
 * file is uploaded under the job's key family and charged to the user's
 * storage quota at upload (the engine uploads it as `<jobId>-engine` with the
 * user id, so `trackStorage` counts it), so a permanent Library delete that removed only
 * `r2_key` would leave both the object and its charge behind.
 *
 * The rule: `createAssetFromJob` records each companion on the result's row
 * (`metadata.companions: [{ key, sizeBytes }]`), and only a key in the job's
 * OWN key family (`isOwnedObjectKey`) — never a url the output merely repeats
 * or a relayed far-end object. A permanent delete of that row
 * (`permanentlyDeleteAsset`, through `releaseCompanions` in
 * asset-companion-release.ts) then releases each companion under the same checks
 * the row's own object takes: the legal hold, whose file
 * (`judgeKeys`, the row's own proof covering its family), no other Library row naming it, and — where the caller
 * keeps objects its own jobs still read — no job output naming its url
 * (`JOB_OUTPUT_URL_PATHS`). A companion goes only when its result's object
 * went, and its recorded bytes are refunded in the same decrement as the
 * row's.
 *
 * A new kind of companion joins by adding its output field below; nothing else
 * names one.
 */
export const COMPANION_OUTPUT_FIELDS: ReadonlyArray<{
  /** The `output_data` field holding the companion's url. */
  readonly field: string
  /** The media type of the Library row it accompanies. */
  readonly of: "image" | "video" | "audio"
}> = [{ field: "engineVideoUrl", of: "video" }]

export interface AssetCompanion {
  readonly key: string
  readonly sizeBytes: number
}

/** The storage key a stored url names (the inverse of the public url). */
function keyOfUrl(url: string): string {
  return config.R2_PUBLIC_URL ? url.replace(config.R2_PUBLIC_URL + "/", "") : url
}

/**
 * The companions to record on a job's `type` row whose object is `primaryKey`:
 * each declared field's url, kept only when its key is canonical and in the
 * job's own key family and is not the row's own object, sized by `sizeOf` (0 when unknown).
 */
export async function companionsForRow(
  jobId: string,
  output: Record<string, unknown>,
  type: "image" | "video" | "audio",
  primaryKey: string,
  sizeOf: (key: string) => Promise<number>,
): Promise<AssetCompanion[]> {
  const companions: AssetCompanion[] = []
  for (const { field, of } of COMPANION_OUTPUT_FIELDS) {
    if (of !== type) continue
    const url = output[field]
    if (typeof url !== "string" || !url) continue
    const key = keyOfUrl(url)
    if (key === primaryKey || !isCanonicalObjectKey(key) || !isOwnedObjectKey(jobId, key)) continue
    if (companions.some((c) => c.key === key)) continue
    companions.push({ key, sizeBytes: await sizeOf(key) })
  }
  return companions
}

/**
 * The companions a row's `metadata` records, read defensively: only entries
 * whose key is in the SAME key family as the row's own object (so a row cannot
 * name another job's file as its companion), each size a non-negative integer
 * (anything else counts 0).
 */
export function companionsOf(metadata: unknown, primaryKey: string | null): AssetCompanion[] {
  if (!primaryKey || typeof metadata !== "object" || metadata === null) return []
  const raw = (metadata as Record<string, unknown>).companions
  if (!Array.isArray(raw)) return []
  const families = objectKeyJobIdCandidates(primaryKey)
  const out: AssetCompanion[] = []
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue
    const { key, sizeBytes } = entry as { key?: unknown; sizeBytes?: unknown }
    if (typeof key !== "string" || !key || key === primaryKey) continue
    if (!families.some((jobId) => isOwnedObjectKey(jobId, key))) continue
    if (out.some((c) => c.key === key)) continue
    const size = typeof sizeBytes === "number" && Number.isInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0
    out.push({ key, sizeBytes: size })
  }
  return out
}

/**
 * A caller's `metadata` with any `companions` taken out: only
 * `createAssetFromJob` records companions, never a request body (a row naming
 * companions it did not make would steer what its delete removes).
 */
export function withoutCompanions(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  const { companions: _dropped, ...rest } = metadata
  return rest
}
