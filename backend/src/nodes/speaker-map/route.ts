import { z } from "zod"
import { SPEAKER_MAP_DEFAULT_MARGIN_DB, SPEAKER_MAP_MAX_SOURCES, SPEAKER_MAP_MIN_CAMERAS, transcriptSpeakerLabels } from "@nodaro/shared/edl"
import { SPEAKER_MAP_MAX_MARGIN_DB, isAudioSyncResult, parseJsonInput } from "@nodaro/render-rules"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { extractMcpClient } from "../../lib/extract-mcp-client.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import type { UnitRoute } from "../kit.js"

// Keyless, ffmpeg + in-process level comparison: which camera each speaker is
// on, from 2–6 recordings' own microphones, a diarized transcript and
// (optionally) Audio Sync's offsets. Result (`output_data.json`):
// `{ version, speakerMap, confidence, notes, edl? }`, the edit also on
// `output_data.edl`. Flat-priced: the `speaker-map` row.
function speakerMapBody() {
  return z
    .object({
      sources: z
        .array(
          z.object({
            // The caller's own id for this recording — the map's camera ids. On
            // the canvas it is the upstream node id.
            id: z.string().min(1).max(200),
            url: safeUrlSchema,
            kind: z.enum(["video", "audio"]).optional(),
          }),
        )
        .min(SPEAKER_MAP_MIN_CAMERAS)
        .max(SPEAKER_MAP_MAX_SOURCES),
      // Transcribe's result (or its JSON), with speaker labels.
      transcript: z.unknown().optional(),
      // Audio Sync's result (or its JSON); absent = the recordings are already in sync.
      offsets: z.unknown().optional(),
      // The master audio and the wide shot: no one's camera.
      masterSourceId: z.string().min(1).max(200).optional(),
      wideSourceId: z.string().min(1).max(200).optional(),
      // How far the loudest camera must lead the next, dB (default 3).
      marginDb: z.number().min(0).max(SPEAKER_MAP_MAX_MARGIN_DB).optional(),
      userId: z.string().uuid().optional(),
    })
    .superRefine((body, ctx) => {
      const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
      const kinds = new Map<string, string | undefined>()
      body.sources.forEach((s, i) => {
        if (kinds.has(s.id)) issue(["sources", i, "id"], `source id "${s.id}" appears more than once — every source needs its own id`)
        kinds.set(s.id, s.kind)
      })
      for (const k of ["masterSourceId", "wideSourceId"] as const) {
        const id = body[k]
        if (id !== undefined && !kinds.has(id)) issue([k], `"${id}" is not one of the sources' ids`)
      }
      const wide = body.wideSourceId
      if (wide !== undefined && kinds.get(wide) === "audio") issue(["wideSourceId"], `"${wide}" is a sound-only recording — the wide shot must be a camera`)
      if (wide !== undefined && wide === body.masterSourceId) issue(["wideSourceId"], `"${wide}" is also the master audio — pick a different recording for each`)
      if (body.transcript === undefined || body.transcript === null || body.transcript === "") issue(["transcript"], "transcript is required")
      if (body.offsets !== undefined && !isAudioSyncResult(body.offsets)) issue(["offsets"], "not an Audio Sync result (it has no offsets list)")
    })
}

/** What `jobs.input_data` keeps of a body: everything but the transcript (up to
 *  24 MB, and get_job / list_jobs / admin return input_data verbatim), which
 *  shrinks to its word count, as edit-plan's and camera-switch's rows do. The
 *  queue job carries the body whole; the budget reads only `sources`. */
function slimInputData<B extends { transcript?: unknown }>(body: B): Omit<B, "transcript"> & { transcriptWordCount: number } {
  const { transcript, ...slim } = body
  const words = (parseJsonInput(transcript) as { words?: unknown } | null | undefined)?.words
  return { ...slim, transcriptWordCount: Array.isArray(words) ? words.length : 0 }
}

// POST /v1/speaker-map: queue a video-queue job (worker.ts).
export const route: UnitRoute = async function speakerMapRoutes(app) {
  const body = speakerMapBody()
  type Body = z.infer<typeof body>
  // The body the preHandler checked, so a multi-MB transcript is parsed once.
  const checked = new WeakMap<object, Body>()
  const refusal = (raw: unknown): { status: number; error: Record<string, unknown> } | { data: Body } => {
    const parsed = body.safeParse(raw)
    if (!parsed.success) return { status: 400, error: { code: "validation_error", ...formatZodError(parsed.error) } }
    // Refused before the guard, like camera-switch: a transcript with no
    // speaker labels cannot be mapped, so nothing is reserved for it.
    if (transcriptSpeakerLabels(parsed.data.transcript).length === 0) {
      return { status: 422, error: { code: "no_speakers", message: "The transcript has no speaker labels — turn on speaker detection in Transcribe so Speaker Map can tell who is talking." } }
    }
    return { data: parsed.data }
  }

  app.post("/v1/speaker-map", {
    // A word-level transcript for a multi-hour episode is several MB, past the
    // app's 1 MB default (as for edit-plan and camera-switch). The DAG path
    // carries it in the job payload, so this only guards the direct REST POST.
    bodyLimit: 24 * 1024 * 1024,
    preHandler: [
      // Validate FIRST, so a malformed request hears the 400 (or 422) that
      // names its problem rather than a 402.
      async (req, reply) => {
        const checkedBody = refusal(req.body)
        if ("error" in checkedBody) return reply.status(checkedBody.status).send({ error: checkedBody.error })
        checked.set(req, checkedBody.data)
      },
      creditGuard(() => "speaker-map"),
    ],
  }, async (req, reply) => {
    const data = checked.get(req)
    checked.delete(req)
    if (!data) {
      // Never reached (the preHandler always runs first); answer as it would.
      const checkedBody = refusal(req.body)
      if ("error" in checkedBody) return reply.status(checkedBody.status).send({ error: checkedBody.error })
      return reply.status(500).send({ error: { code: "internal_error", message: "The request was not validated" } })
    }
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const { userId: _bodyUserId, ...restData } = data
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      // `sources` rides input_data verbatim: the job-budget registry reads a
      // row's budget off `input_data.sources` (the unit's budget.ts).
      input_data: buildJobInputData(slimInputData(restData), "speaker-map"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")

    const reservation = await reserveCreditsForJob(req, reply, job.id, "speaker-map")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("speaker-map", { jobId: job.id, ...restData, marginDb: restData.marginDb ?? SPEAKER_MAP_DEFAULT_MARGIN_DB, usageLogId })
    return { jobId: job.id }
  })
}
