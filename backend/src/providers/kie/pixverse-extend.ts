/**
 * PixVerse V6 Extend on KIE's market lane (`pixverse-v6/extend`): any clip in,
 * the same clip back with the new seconds joined on.
 *
 *   input = { prompt, duration, quality, generate_audio_switch, seed, video_url }
 *   poll  → JSON.parse(resultJson) = { resultUrls: [<the whole clip>] }
 *
 * The schema has two forms, a PixVerse task id (`taskId`) or a clip URL
 * (`video_url`), mutually exclusive. Only the URL form is sent: it takes any
 * clip, where the task-id form takes only a PixVerse task of the same account.
 * The body is an explicit allow-list (`PIXVERSE_EXTEND_FIELDS`):
 *   - `prompt` as written (3-5000 characters; the route refuses a shorter one
 *     before the reservation, so nothing here pads or rewrites it),
 *   - `duration` the seconds added, an INTEGER 1-15 (the generic createTask
 *     path sends a string),
 *   - `quality` 360p / 540p / 720p / 1080p,
 *   - `generate_audio_switch` always sent (the sound switch is priced),
 *   - `seed` required by the schema (0-2147483647): the caller's when the
 *     schema takes it (`pixverseV6MaxSeed`, PixVerse V6 Max's own guard over the
 *     same range), else a random one — so a `-1`, a fraction or a seed past
 *     either end is never sent for KIE to refuse after the reservation.
 *
 * The returned clip is the whole source with the extension joined (an 8.06 s
 * source extended by 5 s came back at 13.25 s); cutting it back to the new
 * part is the worker's job.
 */
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ProgressCallback, ReconcileOpts } from "../provider.interface.js"
import { MAX_POLL_ATTEMPTS_VIDEO, createKieTask, createSanitizedError, pollKieTask } from "./client.js"
import { deriveKieEgressDimensions } from "./egress-dimensions.js"
import { PIXVERSE_V6_EXTEND_MODEL_KEY, PIXVERSE_V6_EXTEND_WIRE_MODEL } from "./models.js"
import { pixverseV6MaxSeed } from "./pixverse-v6-max.js"

export type PixverseExtendQuality = "360p" | "540p" | "720p" | "1080p"

/** The seeds the schema accepts (`minimum` / `maximum`). */
export const PIXVERSE_EXTEND_SEED_RANGE = { min: 0, max: 2147483647 } as const

/** The keys the body may carry — the allow-list the tests hold the request to. */
export const PIXVERSE_EXTEND_FIELDS = ["prompt", "duration", "quality", "generate_audio_switch", "seed", "video_url"] as const

export interface PixverseExtendArgs {
  /** The clip to extend (any reachable video). */
  videoUrl: string
  /** Sent as written. */
  prompt: string
  /** The seconds to add, a whole number 1-15. */
  durationSec: number
  quality: PixverseExtendQuality
  sound: boolean
  /** Absent, or one the schema refuses ⇒ a random seed in {@link PIXVERSE_EXTEND_SEED_RANGE}. */
  seed?: number
}

export interface PixverseExtendResult {
  /** The provider's clip: the whole source with the extension joined. */
  url: string
  kieTaskId: string
  providerMs?: number
}

/** A random whole seed in the schema's range, both ends included. */
function randomSeed(): number {
  const { min, max } = PIXVERSE_EXTEND_SEED_RANGE
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** The request body's `input` (no I/O but the random seed). */
export function pixverseExtendInput(args: PixverseExtendArgs): Record<string, unknown> {
  return {
    prompt: args.prompt,
    duration: args.durationSec,
    quality: args.quality,
    generate_audio_switch: args.sound,
    seed: pixverseV6MaxSeed(args.seed) ?? randomSeed(),
    video_url: args.videoUrl,
  }
}

/**
 * Extend one clip and poll the task to its end. Every failure is the client's
 * sanitized error (refunded by the worker's failure path); a task that
 * succeeds with no URL fails too, never an empty success.
 */
export async function runPixverseExtend(
  args: PixverseExtendArgs,
  reconcileOpts?: ReconcileOpts,
  onProgress?: ProgressCallback,
): Promise<PixverseExtendResult> {
  const input = pixverseExtendInput(args)
  // The wire names quality `quality`, a key the shared reader leaves alone, so
  // the resolution dimension is named here.
  const dimensions = { ...reconcileOpts?.dimensions, ...deriveKieEgressDimensions(input), resolution: args.quality }
  const { taskId } = await createKieTask(PIXVERSE_V6_EXTEND_WIRE_MODEL, input, { modelKey: PIXVERSE_V6_EXTEND_MODEL_KEY, dimensions })
  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai PixVerse extend]")
  const { resultJson, providerMs } = await pollKieTask(taskId, MAX_POLL_ATTEMPTS_VIDEO, onProgress)
  const url = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!url) throw createSanitizedError("PixVerse extend task succeeded but no URL found", "Video extension")
  return { url, kieTaskId: taskId, ...(providerMs !== undefined ? { providerMs } : {}) }
}
