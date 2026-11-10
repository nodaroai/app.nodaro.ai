/**
 * A step a plugin engine's job sends to another route is gated as the node
 * the user ran (decided 2026-11-10): Nodaro Motion's depth, mask, composite
 * and audio-separation steps, and every other request its job sends, follow
 * `cast-swap`, so a deployment that allows Motion does not refuse its run
 * partway through. Only the NODE gate follows the parent: each step's models
 * are still judged as its own route judges them.
 *
 * A step is told apart by what server code attached to the request itself:
 * internal auth AND a parent job in its server-only submission scope (the
 * toolkit's `tk.http.workerRequest`; never a header or the body), for the
 * caller the request acts as (`createsChildJob`). The parent job is read for
 * that same user and must still be running; its node is its job name's
 * (`nodeOfJobType`). Anything else — a direct call, a call without a parent,
 * another user's job, a finished job, a job no node accounts for — is gated
 * by the route's own node, as before.
 *
 * Only where the deployment lists its nodes (`nodes.allow`): elsewhere nothing
 * is read and every route is gated by its own node, exactly as before.
 */
import type { FastifyRequest } from "fastify"
import { createsChildJob, jobSubmissionParentJobId } from "./job-submission-context.js"
import { nodeOfJobType } from "./route-node-gate.js"
import { runtimeSurfaceProfile } from "./surface-profile.js"

/** A parent in one of these states sends no more steps: its node is not lent. */
const FINISHED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

const reportedJobTypes = new Set<string>()

/**
 * The node THIS request is gated as when it is a step of a plugin engine's job
 * (its parent job's node), else undefined: the route is gated by its own node.
 */
export async function childStepNodeType(req: FastifyRequest): Promise<string | undefined> {
  if (runtimeSurfaceProfile().nodes.allow.length === 0) return undefined
  if (!createsChildJob(req) || !req.userId) return undefined
  const parentJobId = jobSubmissionParentJobId(req)
  if (!parentJobId) return undefined
  // Loaded here, not at module scope: this module is reached from the credit
  // guard, which most route suites load with supabase mocked.
  const { supabase } = await import("./supabase.js")
  // The job's name only (its `input_data.type` as a column): a step reads no payload.
  const { data, error } = await supabase
    // trash-read: the parent of the step being gated — its own run goes on whether or not it was deleted, and nothing is answered to a user from it.
    .from("jobs")
    .select("job_type, status, input_type:input_data->>type")
    .eq("id", parentJobId)
    .eq("user_id", req.userId)
    .maybeSingle()
  if (error || !data) return undefined
  const row = data as { job_type?: unknown; input_type?: unknown; status?: unknown }
  if (typeof row.status === "string" && FINISHED.has(row.status)) return undefined
  const jobType = str(row.job_type) ?? str(row.input_type)
  const node = jobType ? nodeOfJobType(jobType) : undefined
  if (!node && jobType && !reportedJobTypes.has(jobType)) {
    reportedJobTypes.add(jobType)
    console.error(
      `[child-step-node] a step of a "${jobType}" job is gated by its own route's node: no node accounts for that job. ` +
        "Name it in PLUGIN_JOB_NODES (lib/route-node-gate.ts).",
    )
  }
  return node
}
