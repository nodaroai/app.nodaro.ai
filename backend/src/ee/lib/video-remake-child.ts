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

export async function isVideoRemakeVideoStep(req: FastifyRequest): Promise<boolean> {
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
