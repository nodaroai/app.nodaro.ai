/**
 * `POST /v1/suno/add-vocals` and `POST /v1/suno/add-instrumental` (registered
 * by `sunoRoutes`): a new layer over a song, sung or played, with the person's
 * direction (decided 2026-11-23).
 *
 * The song is a link to its file (`uploadUrl`) or a Suno track made here
 * (`taskId` + `audioId`, its saved audio is sent). Every direction field is
 * optional: a run with no style takes the original song's style, and is
 * refused only when there is none to take (`lib/suno-add-track-source.ts`).
 * The bounds are the provider's own (the lyrics or direction 5000, the style
 * 1000, the styles to keep out 200; the title SUNO_TITLE_MAX), refused when
 * exceeded, never cut (providers/kie/suno-add-track.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  SUNO_ADD_TRACK_MODELS,
  SUNO_ADD_TRACK_NEGATIVE_MAX,
  SUNO_ADD_TRACK_PROMPT_MAX,
  SUNO_ADD_TRACK_STYLE_MAX,
  SUNO_HARD_CEILING,
  SUNO_TITLE_MAX,
  DEFAULT_SUNO_MODEL,
} from "@nodaro/shared/models"
import { safeUrlSchema } from "../lib/url-validator.js"
import { linkImportRefusal } from "../lib/link-imports.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { resolveSunoAddTrackSource, sunoAddTrackLinkProblem, type SunoAddTrackJobType } from "../lib/suno-add-track-source.js"

const sunoAddTrackModelEnum = z.enum(SUNO_ADD_TRACK_MODELS).optional().default(DEFAULT_SUNO_MODEL)
const weight = z.number().min(0).max(1).optional()

/** What both tools take: the song, the version, and the direction shared by both. */
const sharedFields = {
  uploadUrl: safeUrlSchema.optional(),
  taskId: z.string().min(1).max(200).optional(),
  audioId: z.string().min(1).max(200).optional(),
  model: sunoAddTrackModelEnum,
  style: z.string().max(SUNO_ADD_TRACK_STYLE_MAX).optional(),
  title: z.string().max(SUNO_TITLE_MAX).optional(),
  negativeTags: z.string().max(SUNO_ADD_TRACK_NEGATIVE_MAX).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  styleWeight: weight,
  weirdnessConstraint: weight,
  audioWeight: weight,
  userId: z.string().uuid().optional(),
}

function sourceRefine(body: { uploadUrl?: string; taskId?: string; audioId?: string }, ctx: z.RefinementCtx): void {
  if (!body.taskId !== !body.audioId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [body.taskId ? "audioId" : "taskId"], message: "Pass a Suno track's taskId and audioId together" })
  } else if (!body.uploadUrl && !body.taskId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["uploadUrl"], message: "Pass the song as uploadUrl, or a Suno track made here as taskId and audioId" })
  }
}

export const sunoAddVocalsBody = z.object({
  ...sharedFields,
  // The lyrics to sing, or the direction for the voice.
  // The provider's own limit, refused rather than cut: a cut would drop the
  // end of the lyrics, and after the prompt policy whatever it adds.
  prompt: z.string().max(SUNO_ADD_TRACK_PROMPT_MAX).optional(),
  userPrompt: z.string().max(SUNO_HARD_CEILING).optional(),
}).superRefine(sourceRefine)

export const sunoAddInstrumentalBody = z.object(sharedFields).superRefine(sourceRefine)

type AddTrackBody = z.infer<typeof sunoAddVocalsBody>

/** A link the person passed as the song: refused when unusable, a social page, or switched off. True once refused. */
function refusedLink(reply: FastifyReply, uploadUrl: string): boolean {
  const problem = sunoAddTrackLinkProblem(uploadUrl)
  if (problem) {
    reply.status(400).send({ error: { code: "validation_error", message: problem } })
    return true
  }
  const switchRefusal = linkImportRefusal(uploadUrl)
  if (switchRefusal) {
    reply.status(403).send({ error: switchRefusal })
    return true
  }
  return false
}

/** The route options of one tool: its credit guard, under the tool's own id. */
function addTrackOptions(jobType: SunoAddTrackJobType) {
  return { preHandler: creditGuard(() => jobType, { runModel: jobRunModel(jobType) }) }
}

type ResolvedSource = { readonly uploadUrl: string; readonly style: string; readonly title?: string }

/** The run as it will be queued: the file, the style and the title resolved. */
function addTrackRunOf(jobType: SunoAddTrackJobType, body: AddTrackBody, source: ResolvedSource): Record<string, unknown> {
  return {
    ...(body.taskId && body.audioId ? { taskId: body.taskId, audioId: body.audioId } : {}),
    uploadUrl: source.uploadUrl,
    model: body.model,
    ...(jobType === "suno-add-vocals" && body.prompt?.trim() ? { prompt: body.prompt } : {}),
    style: source.style,
    ...(source.title ? { title: source.title } : {}),
    ...(body.negativeTags?.trim() ? { negativeTags: body.negativeTags } : {}),
    ...(body.vocalGender ? { vocalGender: body.vocalGender } : {}),
    ...(body.styleWeight !== undefined ? { styleWeight: body.styleWeight } : {}),
    ...(body.weirdnessConstraint !== undefined ? { weirdnessConstraint: body.weirdnessConstraint } : {}),
    ...(body.audioWeight !== undefined ? { audioWeight: body.audioWeight } : {}),
  }
}

/**
 * The run as the job records it (`input_data`, which the caller reads back).
 * The song's link only when the caller sent it: a Suno track named by its ids
 * may be another account's (shared workflows and published apps run on
 * other accounts' songs), and its saved file's address is not the caller's to
 * read — the job keeps the ids, and the queue alone carries the file.
 */
function recordedRunOf(jobType: SunoAddTrackJobType, body: AddTrackBody, run: Record<string, unknown>): Record<string, unknown> {
  const { uploadUrl: _resolved, ...rest } = run
  return {
    ...rest,
    ...(body.uploadUrl ? { uploadUrl: body.uploadUrl } : {}),
    ...(jobType === "suno-add-vocals" && body.userPrompt !== undefined ? { userPrompt: body.userPrompt } : {}),
  }
}

/** The handler of one tool. */
function addTrackHandler(jobType: SunoAddTrackJobType, schema: typeof sunoAddVocalsBody | typeof sunoAddInstrumentalBody) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const body = parsed.data as AddTrackBody
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (body.uploadUrl && refusedLink(reply, body.uploadUrl)) return reply

    // The file and the style, before the row and the hold.
    const source = await resolveSunoAddTrackSource({
      jobType, userId, uploadUrl: body.uploadUrl, taskId: body.taskId, audioId: body.audioId, style: body.style, title: body.title,
    })
    if (!source.ok) return reply.status(source.status).send({ error: { code: source.code, message: source.message } })

    const run = addTrackRunOf(jobType, body, source)
    const recorded = recordedRunOf(jobType, body, run)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: withResolvedModel(buildJobInputData(recorded, jobType), jobType),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")

    const reservation = await reserveCreditsForJob(req, reply, job.id, jobType)
    if (reply.sent) return
    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add(jobType, {
      jobId: job.id,
      ...run,
      usageLogId: reservation?.usageLogId,
    }))
    if (reply.sent) return
    return { jobId: job.id }
  }
}

export async function sunoAddTrackRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/suno/add-instrumental", addTrackOptions("suno-add-instrumental"), addTrackHandler("suno-add-instrumental", sunoAddInstrumentalBody))
  app.post("/v1/suno/add-vocals", addTrackOptions("suno-add-vocals"), addTrackHandler("suno-add-vocals", sunoAddVocalsBody))
}
