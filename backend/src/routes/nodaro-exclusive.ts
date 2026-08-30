/**
 * Community/business routes for the Nodaro-EXCLUSIVE nodes (4b, PR 3).
 *
 * On the cloud these wire paths are registered by @nodaroai/cloud-plugins;
 * here they are thin accept-and-enqueue shims that the relay worker
 * (workers/handlers/nodaro-exclusive-relay.ts) replays against the cloud
 * through the nodaro.ai credential. Registered in app.ts ONLY when
 * `!hasCredits()` — on cloud the plugin owns the same paths and a double
 * registration is a Fastify boot crash.
 *
 * Validation is a deliberately LIGHT passthrough: the cloud's own Zod is the
 * schema authority (the full schemas are born-private with the plugin), so
 * these check just the load-bearing fields the relay itself needs — enough
 * to fail an obviously-empty request here instead of a confusing cloud 400.
 *
 * Billing happens on the connected cloud account. The local creditGuard is
 * included for shape-parity but is a pass-through on these editions.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isNodaroConnected, nodaroCloudFetch } from "../lib/nodaro-connect.js"
import { callCloudRoute } from "../providers/nodaro/client.js"
import { requestJobStop } from "../workers/shared.js"

/** Structured refusal shared by every route here — the frontend renders it
 *  with a "Connect nodaro.ai" CTA. 503: the capability exists, the install
 *  is just not connected to the thing that serves it. */
async function requireConnection(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const connected = await isNodaroConnected().catch(() => false)
  if (connected) return true
  reply.status(503).send({
    error: {
      code: "nodaro_connection_required",
      message:
        "This node runs on nodaro.ai. Connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API) and run again.",
    },
  })
  return false
}

/** Light body checks: only what the RELAY needs to exist. */
const vcpBody = z.object({
  audioUrl: safeUrlSchema.optional(),
  videoUrl: safeUrlSchema.optional(),
}).passthrough().refine((v) => v.audioUrl || v.videoUrl, {
  message: "audioUrl or videoUrl is required",
})
const gvpBody = z.object({}).passthrough()
const evpBody = z.object({ videoUrl: safeUrlSchema }).passthrough()
const vaBody = z.object({ videoUrl: safeUrlSchema }).passthrough()
const auditBody = z.object({ videoUrl: safeUrlSchema }).passthrough()
const continueBody = z.object({
  fromJobId: z.string().min(1),
  fromSegment: z.number().int().min(1).optional(),
}).passthrough()

interface EnqueueArgs {
  readonly req: FastifyRequest
  readonly reply: FastifyReply
  readonly jobType: string
  readonly body: Record<string, unknown>
  readonly extraPayload?: Record<string, unknown>
}

/** insertJob + enqueue, mirroring routes/ai-avatar.ts. */
async function enqueueExclusive({ req, reply, jobType, body, extraPayload }: EnqueueArgs) {
  const userId = req.userId
  if (!userId) {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  }
  const { data: job, error } = await insertJob(req, {
    workflow_id: extractWorkflowId(req.body),
    node_id: extractNodeId(req.body),
    force_private: extractForcePrivate(req.body) || undefined,
    user_id: userId,
    status: "pending",
    input_data: buildJobInputData(body, jobType),
  })
  if (error) {
    return sendInternalError(reply, req, error, "Failed to create job")
  }
  await videoQueue.add(jobType, {
    jobId: job.id,
    ...body,
    ...(extraPayload ?? {}),
  })
  return reply.send({ jobId: job.id })
}

export async function nodaroExclusiveRoutes(app: FastifyInstance) {
  // Handler factory + literal app.post() per path — the route-path-parity
  // scanner (and plain grep) must see each path as a string literal in an
  // `app.<verb>("...")` call, so don't fold these into a loop.
  const jobHandler = (jobType: string, schema: z.ZodTypeAny) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!(await requireConnection(req, reply))) return
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      return enqueueExclusive({ req, reply, jobType, body: parsed.data as Record<string, unknown> })
    }
  // checkOnly: this file registers only when !hasCredits() (see app.ts) —
  // billing happens on the connected cloud account and the local creditGuard
  // is shape-parity pass-through, so nothing here ever reserves. The flag
  // records that truthfully for the P14 scope-rule scanner; the cloud
  // versions of these routes live in the plugin and reserve in-request
  // there, under the default (payer-aware) guard.
  const guarded = (jobType: string) => ({ preHandler: creditGuard(() => jobType, { checkOnly: true }) })

  app.post("/v1/voice-changer-pro", guarded("voice-changer-pro"), jobHandler("voice-changer-pro", vcpBody))
  app.post("/v1/generate-video-pro", guarded("generate-video-pro"), jobHandler("generate-video-pro", gvpBody))
  app.post("/v1/edit-video-pro", guarded("edit-video-pro"), jobHandler("edit-video-pro", evpBody))
  app.post("/v1/video-analysis", guarded("video-analysis"), jobHandler("video-analysis", vaBody))
  app.post("/v1/video-audit", guarded("video-audit"), jobHandler("video-audit", auditBody))

  // ── video-analysis probe: synchronous passthrough ─────────────────────
  app.post("/v1/video-analysis/probe", async (req, reply) => {
    if (!(await requireConnection(req, reply))) return
    try {
      const result = await callCloudRoute("/v1/video-analysis/probe", (req.body ?? {}) as Record<string, unknown>)
      return reply.send(result)
    } catch (err) {
      return sendInternalError(reply, req, err, "Video-analysis probe failed on the nodaro.ai connection")
    }
  })

  // ── gvp stop: forward to the CLOUD job when it exists; otherwise stamp
  //    the local row — the relay forwards the pending stop right after it
  //    creates the cloud job. ──────────────────────────────────────────────
  app.post<{ Params: { jobId: string } }>("/v1/generate-video-pro/:jobId/stop", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (!(await requireConnection(req, reply))) return
    const { jobId } = req.params
    // Scoped by user_id in the query itself — absent and not-owned are the
    // same 404 by construction.
    const { data } = await supabase
      .from("jobs")
      .select("id, user_id, job_type, status, provider_task_id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle()
    const row = data as { id: string; user_id: string; job_type: string; status: string; provider_task_id: string | null } | null
    if (!row) {
      return reply.status(404).send({ error: { code: "not_found", message: "job not found" } })
    }
    if (row.job_type !== "generate-video-pro") {
      return reply.status(400).send({ error: { code: "validation_error", message: "not a generate-video-pro job" } })
    }
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
      return reply.status(409).send({ error: { code: "already_terminal", message: `job is ${row.status}` } })
    }
    try {
      if (row.provider_task_id) {
        const res = await nodaroCloudFetch(`/v1/generate-video-pro/${row.provider_task_id}/stop`, { method: "POST" })
        if (!res.ok && res.status !== 409) {
          return reply.status(502).send({ error: { code: "cloud_stop_failed", message: `nodaro.ai answered ${res.status}` } })
        }
      } else {
        // Cloud job not created yet — stamp the row; the relay checks the
        // stamp immediately after createCloudJob and forwards it.
        await requestJobStop(jobId)
      }
      return reply.send({ jobId, stopping: true })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to stop the run")
    }
  })

  // ── gvp continue: a NEW local job resuming the CLOUD parent. The local
  //    fromJobId maps to its provider_task_id (the cloud parent id). ────────
  app.post("/v1/generate-video-pro/continue", { preHandler: creditGuard(() => "generate-video-pro", { checkOnly: true }) }, async (req, reply) => {
    if (!(await requireConnection(req, reply))) return
    const parsed = continueBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const { data } = await supabase
      .from("jobs")
      .select("id, user_id, job_type, provider_task_id")
      .eq("id", parsed.data.fromJobId)
      .eq("user_id", userId)
      .maybeSingle()
    const parent = data as { id: string; user_id: string; job_type: string; provider_task_id: string | null } | null
    if (!parent || parent.job_type !== "generate-video-pro") {
      return reply.status(404).send({ error: { code: "not_found", message: "parent job not found" } })
    }
    if (!parent.provider_task_id) {
      return reply.status(409).send({
        error: { code: "not_resumable", message: "the parent run has no cloud job to resume from" },
      })
    }
    const { fromJobId: _local, fromSegment, ...rest } = parsed.data as Record<string, unknown> & { fromSegment?: number }
    return enqueueExclusive({
      req,
      reply,
      jobType: "generate-video-pro",
      body: rest,
      extraPayload: {
        __nodaroContinue: {
          cloudFromJobId: parent.provider_task_id,
          ...(fromSegment !== undefined ? { fromSegment } : {}),
        },
      },
    })
  })
}
