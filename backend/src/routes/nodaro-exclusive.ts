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
import { resolveEditPlanSources, describeAudioSyncOffsetIssue, transcriptSpeakerLabels, cameraSwitchEdlProblem } from "@nodaro/shared"
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
import { checkRehostSizes, rehostSizeMessage } from "../lib/rehost-size-check.js"
import { coerceSpeakerFramesEdits, speakerFramesScope } from "@nodaro/render-rules"
import { speakerFramesTranscriptSpeakers } from "../providers/video/speaker-frames-budget.js"
import { speakerFramesRelayRefusal, speakerFramesRelaySupport } from "../lib/private-plugins/speaker-frames-relay-support.js"
import { NODARO_CONNECTION_REQUIRED_CODE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "../lib/nodaro-connection-messages.js"

/** Structured refusal shared by every route here — the frontend renders it
 *  with a "Connect nodaro.ai" CTA. 503: the capability exists, the install
 *  is just not connected to the thing that serves it. */
async function requireConnection(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const connected = await isNodaroConnected().catch(() => false)
  if (connected) return true
  reply.status(503).send({ error: { code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REQUIRED_MESSAGE } })
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
// edit-plan (podcast editing): a transcript-driven planner. Light passthrough —
// the cloud plugin's own Zod is the schema authority; here we only fail an
// obviously-empty request (no transcript, no sources) before a confusing cloud
// 400. `transcript` is opaque (its upstream shape can drift ahead of the
// plugin's pin); each `sources` row needs an SSRF-safe `url`. Everything else
// passes through. `planTier` (NOT `tier` — the relay strips a field named
// `tier`) and the clips-only levers are validated cloud-side.
const editPlanSourceRow = z.object({ url: safeUrlSchema }).passthrough()

/**
 * B4 (decided 2026-09-25): the relayed edit-plan takes each source's offset on
 * `sources[].offsetMs` only. Before anything is created or relayed, refuse —
 * the same codes the cloud route answers — a raw `offsets` field (the cloud
 * schema would strip it and plan the cameras unsynced) and an offset on the
 * plan's own clock (the master, or the transcript's own source). One rule:
 * `resolveEditPlanSources` with no offsets runs exactly those clock checks.
 */
function refuseEditPlanOffsets(body: Record<string, unknown>): { code: string; message: string } | null {
  if (body.offsets !== undefined) {
    return {
      code: "offsets_not_applied",
      message: "edit-plan takes each source's offset on sources[].offsetMs — apply the audio-sync result to the sources first (the SDK's editPlan({ offsets }) and MCP plan_edit do it for you).",
    }
  }
  const rows = (Array.isArray(body.sources) ? body.sources : []) as Array<Record<string, unknown>>
  const sources = rows.map((r, i) => ({
    id: typeof r.id === "string" && r.id ? r.id : `#${i + 1}`,
    ...(typeof r.role === "string" ? { role: r.role } : {}),
    ...(typeof r.offsetMs === "number" ? { offsetMs: r.offsetMs } : {}),
  }))
  const transcriptSourceId = (body.transcript as { sourceId?: unknown } | null | undefined)?.sourceId
  const checked = resolveEditPlanSources(sources, {
    ...(typeof transcriptSourceId === "string" ? { transcriptSourceId } : {}),
  })
  if (checked.ok) return null
  return { code: "master_offset", message: checked.issues.map((i) => describeAudioSyncOffsetIssue(i)).join("; ") }
}
const editPlanBody = z.object({
  transcript: z.unknown(),
  sources: z.array(editPlanSourceRow).min(1).max(6),
}).passthrough().refine((v) => v.transcript !== undefined && v.transcript !== null, {
  message: "transcript is required",
})
// camera-switch (podcast B5): the edit + the diarized transcript; the cloud
// plugin's Zod is the schema authority. Refused here like the cloud route, before
// anything is created or relayed: no edit, and no speaker labels at all.
const cameraSwitchBody = z.object({
  edl: z.unknown(),
  transcript: z.unknown(),
}).passthrough()
/** The plugin route's refusals, before anything is queued: one master-clock
 *  edit (400 invalid_edl) and speaker labels (422 no_speakers). On success the
 *  body comes back with `edl` / `transcript` PARSED — the relay re-hosts the
 *  cameras' URLs from the object, which a JSON string would hide. */
function refuseCameraSwitch(body: Record<string, unknown>):
  | { refused: { status: number; code: string; message: string } }
  | { body: Record<string, unknown> } {
  const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown } catch { return v } })() : v)
  const edl = parse(body.edl)
  const problem = cameraSwitchEdlProblem(edl)
  if (problem) return { refused: { status: 400, code: "invalid_edl", message: problem } }
  if (transcriptSpeakerLabels(body.transcript).length === 0) {
    return { refused: { status: 422, code: "no_speakers", message: "The transcript has no speaker labels — turn on speaker detection in Transcribe so camera-switch can tell who is talking." } }
  }
  return { body: { ...body, edl, transcript: parse(body.transcript) } }
}
// speaker-view (Track C, C2.1/C3.1): HOW the speakers are on screen. The cloud
// plugin's Zod is the schema authority (settings, regions, the edit itself);
// here only the edit has to be there, PARSED — the relay re-hosts its sources
// from the object — and no private source may be over the re-host cap (SV12,
// decided 2026-10-06), refused before anything is created and named.
const speakerViewBody = z.object({
  edl: z.unknown(),
  transcript: z.unknown().optional(),
}).passthrough().refine((v) => v.edl !== undefined && v.edl !== null, { message: "edl is required" })
async function refuseSpeakerView(body: Record<string, unknown>):
  Promise<{ refused: { status: number; code: string; message: string } } | { body: Record<string, unknown> }> {
  const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown } catch { return v } })() : v)
  const edl = parse(body.edl)
  const hits = await checkRehostSizes(edl)
  if (hits.length > 0) return { refused: { status: 422, code: "source_too_large", message: rehostSizeMessage("Speaker View", hits) } }
  return { body: { ...body, edl, ...(body.transcript !== undefined ? { transcript: parse(body.transcript) } : {}) } }
}
// speaker-frames (P3.6): where each speaker's face is, per camera. The cloud
// plugin's Zod is the schema authority; here, before anything is created or
// relayed: the scope the plugin would refuse (exactly one of an edit — one, a
// clip pack or a clip set — and a bare video; the untick list; the 180-minute
// cap), then whether nodaro.ai takes a RELAYED job at all (decided 2026-10-09:
// "not available on a connected install yet" until its plugin accepts the
// self-host's proxies and the relayed marker; a credential nodaro.ai rejects
// answers the connection code). No source is sized: none is sent as itself.
const speakerFramesBody = z.object({
  edl: z.unknown().optional(),
  videoUrl: safeUrlSchema.optional(),
  transcript: z.unknown().optional(),
  excludeSourceIds: z.array(z.string().min(1).max(200)).max(64).optional(),
}).passthrough()
async function refuseSpeakerFrames(body: Record<string, unknown>):
  Promise<{ refused: { status: number; code: string; message: string } } | { body: Record<string, unknown> }> {
  const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown } catch { return v } })() : v)
  let edl: Record<string, unknown> | Record<string, unknown>[] | undefined
  if (body.edl !== undefined && body.edl !== null) {
    const coerced = coerceSpeakerFramesEdits(body.edl)
    if (!coerced.ok) return { refused: { status: 400, code: coerced.code, message: coerced.message } }
    const edits = coerced.edits as unknown as Record<string, unknown>[]
    edl = edits.length === 1 ? edits[0] : edits
  }
  const scope = speakerFramesScope({
    ...(edl ? { edits: (Array.isArray(edl) ? edl : [edl]) as never } : {}),
    ...(typeof body.videoUrl === "string" ? { videoUrl: body.videoUrl } : {}),
    ...(Array.isArray(body.excludeSourceIds) ? { excludeSourceIds: body.excludeSourceIds as string[] } : {}),
  })
  if (!scope.ok) return { refused: { status: 400, code: scope.code, message: scope.message } }
  const refusal = speakerFramesRelayRefusal(await speakerFramesRelaySupport())
  if (refusal) return { refused: { status: refusal.status, code: refusal.code, message: refusal.message } }
  // No size check here: no original is relayed (round 2, decided 2026-10-09).
  // Sampled cameras go as the detection proxies the worker builds (it sizes
  // those before sending any); every other source as a placeholder nodaro.ai
  // never reads.
  const { edl: _raw, ...rest } = body
  return { body: { ...rest, ...(edl ? { edl } : {}), ...(body.transcript !== undefined ? { transcript: parse(body.transcript) } : {}) } }
}
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

/** For edit-plan, keep the up-to-24MB transcript/silence OUT of `jobs.input_data`
 *  (which get_job / list_jobs / admin return VERBATIM) — store a size summary
 *  instead. The full payload still rides the queue job data below. Mirrors the
 *  cloud plugin route's slimming; a no-op for every other exclusive type. */
function slimInputData(body: Record<string, unknown>, jobType: string): Record<string, unknown> {
  if (jobType === "speaker-view") {
    // The edit stays (the review reads it, as the cloud route keeps it); the
    // transcript shrinks to its size.
    const { transcript, ...slim } = body
    const words = (transcript as { words?: unknown } | null | undefined)?.words
    return { ...slim, ...(Array.isArray(words) ? { transcriptWordCount: words.length } : {}) }
  }
  if (jobType === "speaker-frames") {
    // The edit stays (the inspector reads it, as the plugin's route keeps it);
    // the transcript shrinks to its size and its speaker count, which the job
    // budget reads off a slimmed row.
    const { transcript, ...slim } = body
    const words = (transcript as { words?: unknown } | null | undefined)?.words
    return {
      ...slim,
      ...(Array.isArray(words) ? { transcriptWordCount: words.length } : {}),
      ...(transcript !== undefined ? { transcriptSpeakerCount: speakerFramesTranscriptSpeakers({ transcript }) } : {}),
    }
  }
  if (jobType === "camera-switch") {
    const { edl, transcript, ...slim } = body
    const segments = (edl as { segments?: unknown } | null | undefined)?.segments
    const words = (transcript as { words?: unknown } | null | undefined)?.words
    return { ...slim, edlSegmentCount: Array.isArray(segments) ? segments.length : 0, transcriptWordCount: Array.isArray(words) ? words.length : 0 }
  }
  if (jobType !== "edit-plan") return body
  const { transcript, silence, ...slim } = body
  const words = (transcript as { words?: unknown } | null | undefined)?.words
  return {
    ...slim,
    transcriptWordCount: Array.isArray(words) ? words.length : 0,
    transcriptBytes: JSON.stringify(transcript ?? null).length,
    silenceIncluded: silence !== undefined,
  }
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
    // A Preview render (quality proxy) is private on every lane (Track A F1).
    force_private: extractForcePrivate(req.body) || (jobType === "speaker-view" && body.quality === "proxy") || undefined,
    user_id: userId,
    status: "pending",
    input_data: buildJobInputData(slimInputData(body, jobType), jobType),
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
      if (jobType === "edit-plan") {
        const refused = refuseEditPlanOffsets(parsed.data as Record<string, unknown>)
        if (refused) return reply.status(422).send({ error: refused })
      }
      if (jobType === "camera-switch") {
        const checked = refuseCameraSwitch(parsed.data as Record<string, unknown>)
        if ("refused" in checked) {
          const { status, code, message } = checked.refused
          return reply.status(status).send({ error: { code, message } })
        }
        return enqueueExclusive({ req, reply, jobType, body: checked.body })
      }
      if (jobType === "speaker-view") {
        const checked = await refuseSpeakerView(parsed.data as Record<string, unknown>)
        if ("refused" in checked) {
          const { status, code, message } = checked.refused
          return reply.status(status).send({ error: { code, message } })
        }
        return enqueueExclusive({ req, reply, jobType, body: checked.body })
      }
      if (jobType === "speaker-frames") {
        const checked = await refuseSpeakerFrames(parsed.data as Record<string, unknown>)
        if ("refused" in checked) {
          const { status, code, message } = checked.refused
          return reply.status(status).send({ error: { code, message } })
        }
        return enqueueExclusive({ req, reply, jobType, body: checked.body })
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
  // A word-level transcript for a multi-hour episode is several MB — well over
  // the app's 1 MB default JSON bodyLimit — so this shim raises its own, matching
  // the cloud plugin's route (the relay carries the transcript in the job payload,
  // not the HTTP body, so this only guards the direct REST POST).
  app.post("/v1/edit-plan", { ...guarded("edit-plan"), bodyLimit: 24 * 1024 * 1024 }, jobHandler("edit-plan", editPlanBody))
  app.post("/v1/camera-switch", { ...guarded("camera-switch"), bodyLimit: 24 * 1024 * 1024 }, jobHandler("camera-switch", cameraSwitchBody))
  // An episode's edit plus its word-level transcript is several MB, as for camera-switch.
  app.post("/v1/speaker-view", { ...guarded("speaker-view"), bodyLimit: 24 * 1024 * 1024 }, jobHandler("speaker-view", speakerViewBody))
  // An episode's EDL pack plus its word-level transcript is several MB, as for speaker-view.
  app.post("/v1/speaker-frames", { ...guarded("speaker-frames"), bodyLimit: 24 * 1024 * 1024 }, jobHandler("speaker-frames", speakerFramesBody))

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
