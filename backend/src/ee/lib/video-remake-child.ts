import type { FastifyRequest } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { trustedPluginParentJobId } from "../../lib/job-submission-context.js"

/**
 * Video Remake is open to every account, one that never paid included: its
 * price is its own gate. Its video is made by a child job on a video model
 * (and a draft's Full Quality by a video upscale, or a new take), which the
 * free-credit video limits would refuse on their own — after the run's
 * reference pictures were made and charged. So the limits are not asked of
 * that one step.
 *
 * Whether THIS request is that step is decided from what the server itself
 * holds, never from anything a caller sends:
 *
 *  1. the request came through the plugin toolkit's worker request, from a
 *     job's own handler (`trustedPluginParentJobId`: internal auth and the
 *     toolkit's in-process scope — no header, body field or parent id a
 *     caller names can set it);
 *  2. the job it names as its parent exists, belongs to the user this request
 *     runs as, and is a Video Remake run or its Full Quality.
 *
 * Anything else — a direct call to a video route, a workflow's node, another
 * plugin's child, a parent that cannot be read — is judged by the limits as
 * before. Only the limits are lifted: the admin's switch on a model, a tier
 * restriction, the balance and the day's spend are asked as for any run.
 */
const VIDEO_REMAKE_JOB_TYPES: ReadonlySet<string> = new Set(["cast-swap", "cast-swap-full-quality"])

/** Whether the job this request names as its parent, through the plugin toolkit, is the caller's own Video Remake run. */
async function hasVideoRemakeParent(req: FastifyRequest): Promise<boolean> {
  const parentJobId = trustedPluginParentJobId(req)
  if (parentJobId === undefined || !req.userId) return false
  try {
    // trash-read: the running job whose own handler sent this request; a run deleted while it works still finishes its step.
    const { data, error } = await supabase
      .from("jobs")
      .select("user_id, job_type, input_data")
      .eq("id", parentJobId)
      .eq("user_id", req.userId)
      .maybeSingle()
    if (error || !data) return false
    const row = data as { user_id?: unknown; job_type?: unknown; input_data?: unknown }
    if (row.user_id !== req.userId) return false
    const input = row.input_data
    const stored = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).type : undefined
    const type = typeof row.job_type === "string" && row.job_type !== "" ? row.job_type : stored
    return typeof type === "string" && VIDEO_REMAKE_JOB_TYPES.has(type)
  } catch {
    return false
  }
}

/**
 * The routes whose job makes the video a Video Remake run DELIVERS: the take
 * on the engine's model, and a draft's Full Quality (its 1080p finalize, or a
 * new take). What such a job stores is the result the person gets, so it
 * follows the account's watermark rule like any other result.
 */
const RESULT_ROUTES: ReadonlySet<string> = new Set(["/v1/generate-video", "/v1/video-upscale"])

/**
 * What a request is to a Video Remake run, or null when it is no step of one
 * (the two checks above). Either kind has the free-credit video limits lifted;
 * they differ in the watermark:
 *
 *  - `"result"`: the job that makes the video the run delivers;
 *  - `"helper"`: any other job the run makes for itself (a depth map, a mask,
 *    a prepared reference picture). Its output is never shown or delivered:
 *    it is what the video model is SENT, so the guard stores it without the
 *    free tier's watermark, which the model would otherwise read as part of
 *    the picture.
 *
 * The route is the one the server matched (its registered path), never a
 * header or a body field: a caller cannot name its request a helper. A route
 * not listed as a result is a helper only under a verified Video Remake
 * parent; everywhere else the watermark rule is asked as before.
 */
export type VideoRemakeStep = "result" | "helper"

/**
 * A Topaz upscale (`/v1/video-upscale` with provider "topaz") under a Video
 * Remake parent is the Precise upscale step (2026-11-22): it upscales the take
 * the run already made, which is then scaled back and delivered. That take is
 * the result and already follows the account's watermark rule, so the step is
 * a helper: a second watermark would be stamped on the first. A draft's Full
 * Quality 1080p render on the same route names its own provider and stays a
 * result.
 */
function isPreciseUpscaleStep(route: string, body: unknown): boolean {
  if (route !== "/v1/video-upscale") return false
  if (!body || typeof body !== "object" || Array.isArray(body)) return false
  return (body as Record<string, unknown>).provider === "topaz"
}

export async function videoRemakeStepOf(req: FastifyRequest): Promise<VideoRemakeStep | null> {
  if (!(await hasVideoRemakeParent(req))) return null
  const route = req.routeOptions?.url ?? (req.url.split("?")[0] ?? "")
  if (isPreciseUpscaleStep(route, req.body)) return "helper"
  return RESULT_ROUTES.has(route) ? "result" : "helper"
}
