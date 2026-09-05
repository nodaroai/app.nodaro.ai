import { config } from "./config.js"

/**
 * The `output_data` paths that hold a single output URL, across every job type
 * that writes one. ONE list, shared by every delete path that has to answer
 * "does another job of this user still point at these bytes?" — previously
 * three hand-rolled copies (lib/asset-delete.ts, lib/media-delete.ts,
 * routes/media-process.ts) that had already drifted from each other.
 *
 *   imageUrl / videoUrl / audioUrl   the standard worker outputs
 *                                    (workers/shared.ts — also what the
 *                                    gallery and job-history extractors read).
 *   url                              `POST /v1/save-to-storage`
 *                                    (routes/save-to-storage.ts). ROW-LESS:
 *                                    createAssetFromJob reads only the three
 *                                    above, so path (b) is its only proof.
 *   vocalsUrl / backgroundUrl /
 *   unmappedUrl                      voice-changer-pro analyze/recast stems
 *                                    (cloud-plugins) — row-less too.
 *   pro->audio->layers->…->url       Recast's initial derivatives live on the
 *   audio->layers->…->url            GVP checkpoint; a published rescore copies
 *                                    its current derivatives onto the child.
 *
 * One `.eq()` per path, NEVER a hand-built `.or()` string: PostgREST does not
 * quote values inside an `.or()` filter and URLs contain reserved chars
 * (`:` `.` `,`) that corrupt it; `.eq()` arguments are encoded safely.
 */
export const JOB_OUTPUT_URL_PATHS = [
  "output_data->>imageUrl",
  "output_data->>videoUrl",
  "output_data->>audioUrl",
  // save-to-storage. The node whose whole contract is "make me a durable copy"
  // — and under the shared-bucket passthrough it stores a REFERENCE to the
  // upstream object rather than a copy, so deleting the source destroys its
  // output and every node downstream of it.
  "output_data->>url",
  "output_data->>vocalsUrl",
  "output_data->>backgroundUrl",
  "output_data->>unmappedUrl",
  "output_data->pro->audio->layers->music->>url",
  "output_data->pro->audio->layers->video->>url",
  "output_data->audio->layers->music->>url",
  "output_data->audio->layers->video->>url",
] as const

/**
 * The three paths the ASSET-referrer probes have always read. Kept as its own
 * export so "what mainline queries" is a named thing rather than a slice.
 */
export const PRIMARY_JOB_OUTPUT_URL_PATHS = [
  "output_data->>imageUrl",
  "output_data->>videoUrl",
  "output_data->>audioUrl",
] as const

/**
 * Which paths a REFERRER probe should walk, for the two callers that run one
 * per permanent delete (lib/asset-delete.ts, routes/media-process.ts).
 *
 * Gated on the shared-bucket flag, and the gate is about round trips, not
 * correctness. Off the flag, `uploadToR2` copies: two jobs never share an
 * object, so the extra eight probes can only ever come back empty, and issuing
 * them would change the query profile of a delete path on every mainline
 * deployment for no behavioural difference. On the flag, aliasing is real and
 * the full list is the only thing that sees it.
 *
 * The OWNERSHIP proof in lib/media-delete.ts deliberately does NOT take this
 * gate — it walks the full list always, because proving "this url is mine"
 * from `output_data` is correct regardless of how the object got there, and
 * that path already paid for the full walk before this module existed.
 */
export function jobOutputReferrerPaths(): readonly string[] {
  return config.R2_SHARED_WITH_RELAY_TARGET ? JOB_OUTPUT_URL_PATHS : PRIMARY_JOB_OUTPUT_URL_PATHS
}
