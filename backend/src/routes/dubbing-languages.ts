import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractForcePrivate, extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { rawSessionIdOf } from "../lib/generation-session-scope.js"
import { rawOriginOf } from "../lib/client-origin-scope.js"
import { MIN_IDEMPOTENCY_KEY_LENGTH, findRecentMatchingJob } from "../lib/dedup-fingerprint.js"
import { rawBodyRecord } from "../lib/run-model.js"
import { PROJECT_DUBBING_MODEL_ID, dubbingModelIdentifier } from "../lib/dubbing-model.js"
import { dubbingBaseCreditsFor } from "../lib/dubbing-span.js"
import { SOURCE_DUB_JOB_KEY } from "../lib/dubbing-job-store.js"
import { withDubFamily } from "../lib/dubbing-read-service.js"
import { planAddLanguage, type AddLanguagePlan } from "../lib/dubbing-add-language.js"
import { DUBBING_PROBLEMS, dubbingProblemBody } from "../lib/dubbing-problems.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import {
  dubbingRequestBaseCredits,
  probeDubbingDurationPreHandler,
  refuseDubbingUnderVoiceLock,
  submitDubbing,
} from "./dubbing.js"

/**
 * POST /v1/dubbing/:jobId/languages: add a language to a dub that is already
 * made (lib/dubbing-add-language.ts says what that comes to).
 *
 * `:jobId` reads the dub as the reads do (routes/dubbing-read.ts): the job the
 * dub was created by, or the job of a language added to it later, the owner's
 * only, and every refusal of theirs. The new language is a job of its own,
 * answered as `{ jobId }` and followed like any job; the dub it joins is the
 * one its family names, never the path's job.
 *
 * Charged per started minute. A project dub's language is priced before
 * anything else is asked, for the dub's own length, the price its structure
 * shows. A regular dub's language is a dub of its own, measured and priced as
 * the create call measures and prices a dub. An OAuth app needs `assets:write`.
 */

const jobIdParams = z.object({ jobId: z.string().uuid() })

/** A language code as the dubbing service takes one: `es`, `heb`, `pt-BR`, `zh-Hans`. Nothing that could part a path. */
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/

const addLanguageBody = z.object({
  targetLanguage: z
    .string()
    .trim()
    .max(10)
    .regex(LANGUAGE_CODE, "A language code: two or three letters, and optionally a region or script (`es`, `pt-BR`, `zh-Hans`)")
    .describe("The language to add (`es`, `pt-BR`)."),
  confirmationId: z
    .string()
    .uuid()
    .optional()
    .describe("The content rights confirmation, for a dub made from a link someone else holds (as the create call takes it)."),
})

const ADD_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } }

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/dubbing/{jobId}/languages",
  description:
    "Add a language to a dub that is already made. Answers the job that delivers the language: follow it like any job. " +
    "`jobId` is the job the dub was created by, or the job of a language added to it later. The owner only: anyone else's job is `404 not_found`. " +
    "Charged per started minute of the dub: `GET /v1/dubbing/{jobId}` tells whether a language can be added (`capabilities.addLanguage`) " +
    "and what it is charged (`addLanguage`). OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: { params: jobIdParams, body: { content: { "application/json": { schema: addLanguageBody } } } },
  responses: {
    200: { description: "The job that delivers the language", content: { "application/json": { schema: z.object({ jobId: z.string().uuid() }) } } },
    400: { description: "A missing or malformed `targetLanguage`, or settings the dub's source cannot be dubbed into that language with" },
    401: { description: "Unauthorized" },
    402: { description: "Not enough credits" },
    403: { description: "An OAuth token without assets:write, or a rights confirmation the dub's link needs" },
    404: { description: "Job not found (or not yours)" },
    409: { description: "`dubbing_not_ready`: the dub is still being made. `dubbing_language_exists`: the dub already has that language" },
    410: { description: "`dubbing_unavailable`: the dub is no longer held where it was made" },
    413: { description: "`media_duration_exceeds_limit`: the dub is longer than 30 minutes" },
    422: {
      description:
        "`not_a_dubbing_job`: the job is not a dub. `dubbing_failed`: the dub was not made. " +
        "`unreadable_dubbing_source`: the dub's source or length can no longer be read",
    },
    502: { description: "`dubbing_read_failed`: the dubbing service did not answer; try again" },
  },
})

/** What the request asks to be added, decided in the first pre-handler. Kept off the body. */
interface AddLanguageAsk {
  readonly plan: AddLanguagePlan
  /** What the caller's body says about where the job is shown: its flow, its node, its client. */
  readonly transport: Readonly<Record<string, unknown>>
}

const asks = new WeakMap<FastifyRequest, AddLanguageAsk>()

/**
 * The caller's body keys that place a job (the flow, the node, the client, the
 * generation session, the app it came from), read as the job funnel reads them.
 * Kept as the caller sent them: the funnel validates each where it reads it.
 */
function transportOf(body: unknown): Record<string, unknown> {
  const workflowId = extractWorkflowId(body)
  const nodeId = extractNodeId(body)
  const mcpClient = extractMcpClient(body)
  const sessionId = rawSessionIdOf(body)
  const origin = rawOriginOf(body)
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(extractForcePrivate(body) ? { forcePrivate: true } : {}),
    ...(mcpClient ? { mcp_client: mcpClient } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(origin !== undefined ? { origin } : {}),
  }
}

/**
 * A request repeated with the same Idempotency-Key answers the job the first
 * one filed, as every guarded run does (`creditGuard`'s fast path). Asked
 * before the dub is read: by then the first request's language is the dub's,
 * and the repeat would be refused as a language the dub already has.
 */
async function replayRepeatedRequest(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const header = req.headers["idempotency-key"]
  const key = typeof header === "string" ? header.trim() : ""
  if (!req.userId || key.length < MIN_IDEMPOTENCY_KEY_LENGTH) return
  const existing = await findRecentMatchingJob(req.userId, key)
  if (!existing) return
  reply.header("X-Dedup-Hit", "1")
  return reply.code(200).send({ jobId: existing.id, deduped: true })
}

/**
 * Finds the caller's dub and decides what adding the language comes to. A
 * regular dub's language is a dub of its own: from here on the request's body
 * is the create call's, so the pre-handlers after this one measure and price
 * it exactly as they do a new dub.
 */
async function planAddLanguagePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (!req.userId) {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  }
  // An id that cannot be a job is no job of theirs.
  const params = jobIdParams.safeParse(req.params)
  if (!params.success) return reply.status(404).send(dubbingProblemBody(DUBBING_PROBLEMS.notFound))
  const body = addLanguageBody.safeParse(req.body ?? {})
  if (!body.success) {
    return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
  }
  const outcome = await withDubFamily(req.userId, params.data.jobId, async (family) => planAddLanguage(family, body.data))
  if (!outcome.ok) {
    if (outcome.cause !== undefined) {
      req.log.warn({ err: outcome.cause, jobId: params.data.jobId }, "dubbing: the dubbing service did not answer a read")
    }
    return reply.status(outcome.problem.status).send(dubbingProblemBody(outcome.problem))
  }
  const transport = transportOf(req.body)
  asks.set(req, { plan: outcome.value, transport })
  if (outcome.value.engine === "regular") req.body = { ...outcome.value.createBody, ...transport }
}

/** A regular dub's language is measured as a new dub is; a project dub's length is already known. */
async function measureRegularPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (asks.get(req)?.plan.engine === "regular") await probeDubbingDurationPreHandler(req, reply)
}

function modelOf(req: FastifyRequest): string {
  return asks.get(req)?.plan.engine === "project" ? PROJECT_DUBBING_MODEL_ID : dubbingModelIdentifier(rawBodyRecord(req).targetLanguage)
}

async function baseCreditsOf(parsedBody: unknown, req: FastifyRequest): Promise<number> {
  const plan = asks.get(req)?.plan
  return plan?.engine === "project" ? dubbingBaseCreditsFor(PROJECT_DUBBING_MODEL_ID, plan.seconds) : dubbingRequestBaseCredits(parsedBody)
}

type ProjectPlan = Extract<AddLanguagePlan, { readonly engine: "project" }>

/** Files a language a project dub takes: the job, its reservation on the project's row, and its queue entry. */
async function submitProjectLanguage(req: FastifyRequest, reply: FastifyReply, plan: ProjectPlan, transport: Readonly<Record<string, unknown>>) {
  const userId = req.userId
  if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  // What the server knows of the language, and only that: the dub it joins,
  // the project it is added to, the row it is charged on and for how long.
  const stamped = {
    [SOURCE_DUB_JOB_KEY]: plan.familyId,
    projectTaskId: plan.projectTaskId,
    ...(plan.adoptLanguageId ? { adoptLanguageId: plan.adoptLanguageId } : {}),
    dubbingModelId: PROJECT_DUBBING_MODEL_ID,
    probedDurationSec: plan.seconds,
  }
  const mcpClient = extractMcpClient(transport)
  const { data: job, error } = await insertJob(req, {
    workflow_id: extractWorkflowId(transport),
    node_id: extractNodeId(transport),
    force_private: extractForcePrivate(transport) || undefined,
    user_id: userId,
    status: "pending",
    input_data: { ...buildJobInputData({ ...plan.upload, targetLanguage: plan.targetLanguage }, "dubbing"), ...stamped },
    ...(mcpClient ? { mcp_client: mcpClient } : {}),
  })
  if (error) return sendInternalError(reply, req, error, "Failed to create job")

  const reservation = await reserveCreditsForJob(req, reply, job.id, PROJECT_DUBBING_MODEL_ID)
  if (reply.sent) return
  await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("dubbing", {
    jobId: job.id,
    ...plan.upload,
    targetLanguage: plan.targetLanguage,
    ...stamped,
    usageLogId: reservation?.usageLogId,
  }))
  if (reply.sent) return
  return { jobId: job.id }
}

export async function dubbingLanguageRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/dubbing/:jobId/languages", {
    config: ADD_LIMIT,
    preHandler: [
      requireAppScope("assets:write"),
      refuseDubbingUnderVoiceLock,
      replayRepeatedRequest,
      planAddLanguagePreHandler,
      measureRegularPreHandler,
      creditGuard(modelOf, { runModel: modelOf, computeCredits: baseCreditsOf }),
    ],
  }, async (req, reply) => {
    const ask = asks.get(req)
    if (!ask) return reply.status(404).send(dubbingProblemBody(DUBBING_PROBLEMS.notFound))
    if (ask.plan.engine === "regular") return submitDubbing(req, reply, { [SOURCE_DUB_JOB_KEY]: ask.plan.familyId })
    return submitProjectLanguage(req, reply, ask.plan, ask.transport)
  })
}
