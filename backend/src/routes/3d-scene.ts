/**
 * Scene3D previsualization — POST /v1/3d-scene/generate and /edit.
 *
 * Both answer `{ jobId }` and both settle on the row as
 * `output_data = { scenePlan, changeSummary? }` (`Scene3DJobOutput`), so a
 * client that navigated away and came back reads the result the same way it
 * reads any other job. The authoring itself is a durable BullMQ job
 * (`workers/handlers/scene3d.ts`) — the `llm-structured` shape exactly:
 * insert → reserve → enqueue, `attempts: 1` because the LLM call is the paid
 * step and a BullMQ re-run would bill the provider twice for one reservation.
 *
 * ## What happens BEFORE a row exists
 *
 * Everything that can be refused: the plan parses, the revision is current,
 * and — on the deterministic lane — the operations actually apply. A stale
 * revision is a 409 the caller can act on, not a failed job it has to poll to
 * discover. The revision id the edit will produce is minted HERE and carried
 * on the payload, so the worker's apply is byte-identical to the route's
 * dry run.
 *
 * ## Two edit lanes, one enforcement
 *
 * `operations` → applied by `applyScene3DEditOperations` and nothing else
 * happens: no model is called and the job bills the zero-cost
 * `3d-scene-ops` identifier. `prompt` → a model writes operations and the
 * SAME function decides whether they are allowed. Locks are therefore
 * enforced identically on both lanes, after the model has spoken.
 *
 * ## References
 *
 * Images ride the authoring call as multimodal content. A video reference
 * becomes a `video-analysis` child job created HERE, through the analysis
 * route, as the caller (`app.inject`) — the llm-structured-jobs idiom — so the
 * duration policy, the price and the refusals live in one place and reach the
 * caller synchronously. Order is load-bearing: the parent row and its
 * reservation exist BEFORE the child, so a refused child has one thing to undo.
 */
import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from "fastify"
import { z } from "zod"
import {
  ASPECT_RATIO_DIMENSIONS,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  LLM_REASONING_EFFORTS,
  SCENE3D_DEFAULT_DURATION_SECONDS,
  SCENE3D_DEFAULT_FPS,
  SCENE3D_LIMITS,
  WORKSPACE_HEADER_LOWER,
  buildLlmCreditIdentifier,
  getLlmModel,
  newScene3DRevisionId,
  resolveLlmCreditId,
  scene3DEditOperationsSchema,
  scene3DPlanSchema,
  scene3DReferenceSchema,
  type Scene3DEditOperation,
  type Scene3DPlan,
  type Scene3DReference,
} from "@nodaro/shared"
import { cancelOwnedJob } from "../lib/cancel-job.js"
import { shouldProxyLlmToCloud } from "../lib/cloud-llm-proxy.js"
import { config } from "../lib/config.js"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { discardUnstartedJob, stampAnalysisChild } from "../lib/llm-structured-job-row.js"
import { videoQueue } from "../lib/queue.js"
import { extractForcePrivate, extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import {
  applyScene3DEditWithReferences,
  mergeScene3DReferences,
  scene3DImageModalityError,
  scene3DReferenceListError,
} from "../services/scene3d/index.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { formatZodError } from "../lib/zod-error.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import type { Scene3DJobPayload } from "../workers/handlers/scene3d.js"

export const SCENE3D_GENERATE_JOB_TYPE = "generate-3d-scene"
export const SCENE3D_EDIT_JOB_TYPE = "edit-3d-scene"
/** The LlmFeature both lanes bill under. */
export const SCENE3D_LLM_FEATURE = "3d-scene"
/** The deterministic lane's identifier — priced at 0 (see credits.ts). */
export const SCENE3D_OPS_CREDIT_ID = "3d-scene-ops"

const SCENE3D_PROMPT_MAX = 8000

/**
 * DERIVED from the contract, never re-declared beside it.
 *
 * These references are stamped onto the plan by the SERVER, so anything the
 * contract would refuse there has to be refused HERE. A hand-written body
 * schema that merely looked similar (a bare `z.string()` id, no image-window
 * rule) let a reference with a space in its id through the route and into
 * `scene3DPlanSchema`, which rejected the assembled plan — and since the model
 * cannot fix a field the server supplied, the revision loop burned every
 * attempt on the provider before failing and refunding. Same shape, one
 * source: `safeUrlSchema` replaces the contract's structural http(s) check
 * with the platform's SSRF-aware one.
 *
 * The rules that need the whole LIST (duplicate ids, the video cap, an image
 * carrying a time window, a window we cannot honour) live in
 * `services/scene3d/scene3d-references.ts` and are shared with the
 * orchestrator's `payload-builder`, so both ingress paths refuse the same
 * lists with the same sentences.
 */
const referenceBody = scene3DReferenceSchema.extend({ url: safeUrlSchema })

const llmFields = {
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  workflowId: z.string().optional(),
  nodeId: z.string().optional(),
}

export const scene3DGenerateBody = z
  .object({
    prompt: z.string().trim().min(1).max(SCENE3D_PROMPT_MAX),
    durationSeconds: z
      .number()
      .min(SCENE3D_LIMITS.minDurationSeconds)
      .max(SCENE3D_LIMITS.maxDurationSeconds)
      .optional(),
    fps: z.number().int().min(SCENE3D_LIMITS.minFps).max(SCENE3D_LIMITS.maxFps).optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional(),
    references: z.array(referenceBody).max(SCENE3D_LIMITS.maxReferences).optional(),
    ...llmFields,
  })
  .passthrough()

export const scene3DEditBody = z
  .object({
    scenePlan: z.unknown(),
    expectedRevisionId: z.uuid(),
    prompt: z.string().trim().min(1).max(SCENE3D_PROMPT_MAX).optional(),
    operations: z.unknown().optional(),
    references: z.array(referenceBody).max(SCENE3D_LIMITS.maxReferences).optional(),
    lockedObjectIds: z.array(z.string().min(1).max(SCENE3D_LIMITS.maxIdLength)).max(SCENE3D_LIMITS.maxObjects).optional(),
    selectedObjectIds: z.array(z.string().min(1).max(SCENE3D_LIMITS.maxIdLength)).max(SCENE3D_LIMITS.maxObjects).optional(),
    ...llmFields,
  })
  .passthrough()
  .refine((b) => Boolean(b.prompt) !== (b.operations !== undefined), {
    message: "provide exactly one of prompt or operations",
    path: ["prompt"],
  })

export type Scene3DGenerateBody = z.infer<typeof scene3DGenerateBody>
export type Scene3DEditBody = z.infer<typeof scene3DEditBody>

/** The credit identifier the guard reserves under — computed from the RAW
 *  body (before Zod), so the deterministic lane never reserves an LLM tier. */
export function scene3DEditCreditId(body: unknown): string {
  const raw = body as { operations?: unknown } | undefined
  if (raw?.operations !== undefined) return SCENE3D_OPS_CREDIT_ID
  return resolveLlmCreditId(SCENE3D_LLM_FEATURE, body)
}

/** Frames the render runs at, from the caller's duration/fps/aspect ratio.
 *  Rounded here, once — the model is never asked for timing. */
export function scene3DRenderFrame(body: Pick<Scene3DGenerateBody, "durationSeconds" | "fps" | "aspectRatio">) {
  const fps = body.fps ?? SCENE3D_DEFAULT_FPS
  const seconds = body.durationSeconds ?? SCENE3D_DEFAULT_DURATION_SECONDS
  const dimensions = ASPECT_RATIO_DIMENSIONS[body.aspectRatio ?? "16:9"] ?? ASPECT_RATIO_DIMENSIONS["16:9"]
  const durationInFrames = Math.min(
    SCENE3D_LIMITS.maxDurationInFrames,
    Math.max(SCENE3D_LIMITS.minDurationInFrames, Math.round(seconds * fps)),
  )
  return { fps, durationInFrames, width: dimensions.width, height: dimensions.height }
}

type ChildResult = { ok: true; jobId: string } | { ok: false; status: number; body: unknown }

function injectedJson(res: LightMyRequestResponse): unknown {
  try {
    return res.json()
  } catch {
    return {
      error: {
        code: "analysis_unavailable",
        message: res.body || "Video analysis returned no answer",
      },
    }
  }
}

/**
 * Create the video-analysis child THROUGH the analysis route, as the caller.
 *
 * There are TWO authenticated ingresses to this route and they carry identity
 * differently. A browser / SDK request has a Bearer token, which is forwarded
 * verbatim so the child inherits the caller's scopes (a developer-app token's
 * spend cap included). MCP tools and the workflow orchestrator have NO
 * Authorization header at all — they authenticate with the internal
 * orchestrator secret and name the user in the body (`lib/mcp/internal-request.ts`,
 * `services/workflow-engine/node-executor.ts`). Forwarding "the caller's
 * headers" therefore produced an UNAUTHENTICATED child on exactly those paths:
 * every MCP or in-workflow request with a video reference 401'd after the
 * parent row and its reservation already existed.
 *
 * So the fallback is the same trusted server identity the request arrived on,
 * re-asserted for the child: the secret plus `x-internal-user-id`, which the
 * auth middleware reads when the body carries no `userId`. Attribution rides
 * along either way — the workspace header (which payer the child bills), the
 * app-run and web-free-mode surface flags, and `forcePrivate` so a private
 * parent does not spawn a publicly-readable analysis.
 */
async function createAnalysisChild(
  app: FastifyInstance,
  req: FastifyRequest,
  reference: Scene3DReference,
  userId: string,
): Promise<ChildResult> {
  const headers: Record<string, string> = {}
  const auth = req.headers.authorization
  if (typeof auth === "string") {
    headers.authorization = auth
  } else {
    headers["x-internal-orchestrator-secret"] = config.INTERNAL_ORCHESTRATOR_SECRET
    headers["x-internal-user-id"] = userId
  }
  // The workspace/billing context rides a header; forward it so the child
  // bills the same payer the parent does.
  const workspace = req.headers[WORKSPACE_HEADER_LOWER]
  if (typeof workspace === "string") headers[WORKSPACE_HEADER_LOWER] = workspace
  // Spend-surface flags. They only mean anything behind the internal secret,
  // and that is exactly the branch above that re-asserts it.
  for (const flag of ["x-app-run", "x-web-free-mode"] as const) {
    const value = req.headers[flag]
    if (typeof value === "string") headers[flag] = value
  }

  const forcePrivate = extractForcePrivate(req.body)
  const injected = await app.inject({
    method: "POST",
    url: "/v1/video-analysis",
    headers,
    payload: {
      videoUrl: reference.url,
      userId,
      ...(forcePrivate ? { forcePrivate: true } : {}),
    },
  })
  if (injected.statusCode < 200 || injected.statusCode >= 300) {
    return { ok: false, status: injected.statusCode, body: injectedJson(injected) }
  }
  const jobId = (injectedJson(injected) as { jobId?: unknown } | null)?.jobId
  if (typeof jobId !== "string" || jobId.length === 0) {
    return {
      ok: false,
      status: 502,
      body: { error: { code: "analysis_unavailable", message: "Video analysis did not return a job id" } },
    }
  }
  return { ok: true, jobId }
}

/**
 * Undo a parent that never started.
 *
 * Everything after `insertJob` + `reserveCreditsForJob` — creating the child,
 * stamping it on the row, the enqueue itself — can throw, and a throw there
 * used to leave a `pending` row holding a `reserved` credit hold that nothing
 * would ever settle: no BullMQ entry existed, so no worker would fail it and
 * no refund would run. The reconcile sweep does not cover a job that never
 * reached a provider. So every post-reservation failure funnels here, and it
 * goes through the established lifecycle helpers: `cancelOwnedJob` for the
 * analysis child (which refunds ITS hold and flips it to cancelled, the same
 * thing a user cancel does) and `discardUnstartedJob` for the parent (refund,
 * then delete, so a run that never started never shows in a run list).
 *
 * Best-effort by construction: the caller is already answering an error, and
 * a failure to clean up must not replace it with a different one.
 */
async function undoUnstartedParent(
  req: FastifyRequest,
  jobId: string,
  userId: string,
  analysisJobId?: string,
): Promise<void> {
  if (analysisJobId) {
    await cancelOwnedJob(analysisJobId, userId).catch((err: unknown) => {
      req.log.error({ err, analysisJobId }, "[3d-scene] could not cancel the analysis child of an unstarted job")
    })
  }
  await discardUnstartedJob(jobId, userId).catch((err: unknown) => {
    req.log.error({ err, jobId }, "[3d-scene] could not discard an unstarted job")
  })
}

function resolveModel(llmModel: string | undefined): { ok: true; id: string } | { ok: false; message: string } {
  const id = llmModel ?? LLM_FEATURE_DEFAULTS[SCENE3D_LLM_FEATURE]
  return getLlmModel(id) ? { ok: true, id } : { ok: false, message: "Unknown llmModel" }
}

export async function scene3DRoutes(app: FastifyInstance) {
  /** Shared pre-flight both lanes run before anything is inserted. */
  const refuseKeylessOrProxied = async (): Promise<{ status: number; body: unknown } | undefined> => {
    if (await shouldProxyLlmToCloud()) {
      return {
        status: 503,
        body: {
          error: {
            code: "provider_unavailable",
            message:
              "3D scene authoring runs on this instance's own LLM key. Configure one to use this node.",
          },
        },
      }
    }
    // The SAME three keys `shouldProxyLlmToCloud` calls a local lane (and that
    // `lib/llm-client.ts` actually tries, in this order). Listing two of them
    // here made a Gemini-only install unservable: the proxy check saw a local
    // lane and declined to forward, then this check saw no key it recognised
    // and answered 503 for a lane that would have worked.
    if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY && !config.GEMINI_API_KEY) {
      return {
        status: 503,
        body: { error: { code: "provider_unavailable", message: "LLM API key not configured" } },
      }
    }
    return undefined
  }

  app.post(
    "/v1/3d-scene/generate",
    { preHandler: creditGuard((req) => resolveLlmCreditId(SCENE3D_LLM_FEATURE, req.body)) },
    async (req, reply) => {
      const refusal = await refuseKeylessOrProxied()
      if (refusal) return reply.status(refusal.status).send(refusal.body)

      const parsed = scene3DGenerateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const model = resolveModel(parsed.data.llmModel)
      if (!model.ok) {
        return reply.status(400).send({ error: { code: "validation_error", message: model.message } })
      }

      const references = (parsed.data.references ?? []) as Scene3DReference[]
      const referenceError = scene3DReferenceListError(references)
      if (referenceError) {
        return reply.status(400).send({ error: { code: "validation_error", message: referenceError } })
      }
      // Before the reservation, not inside the worker: a text-only model would
      // have the image blocks dropped by the provider and author a scene the
      // references had no part in — billed at the LLM tier, with nothing in the
      // result saying so.
      const modalityError = scene3DImageModalityError(model.id, references)
      if (modalityError) {
        return reply.status(400).send({ error: { code: "validation_error", message: modalityError } })
      }
      const videos = references.filter((r) => r.kind === "video")

      const frame = scene3DRenderFrame(parsed.data)
      const inputData = {
        ...buildJobInputData(parsed.data, SCENE3D_GENERATE_JOB_TYPE),
        ...frame,
        references,
      }
      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: inputData,
      })
      if (jobError) return sendInternalError(reply, req, jobError, "Failed to create job")

      const modelIdentifier = buildLlmCreditIdentifier(
        SCENE3D_LLM_FEATURE,
        model.id,
        parsed.data.reasoningEffort,
      )
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return

      // From here on the parent holds reserved credits, so EVERY failure has
      // to be undone explicitly — see `undoUnstartedParent`.
      let analysisJobId: string | undefined
      try {
        if (videos.length === 1) {
          const child = await createAnalysisChild(app, req, videos[0], userId)
          if (!child.ok) {
            await undoUnstartedParent(req, job.id, userId)
            return reply.status(child.status).send(child.body)
          }
          analysisJobId = child.jobId
          await stampAnalysisChild(job.id, userId, inputData, analysisJobId)
        }

        const payload: Scene3DJobPayload = {
          kind: "generate",
          jobId: job.id,
          usageLogId: reservation?.usageLogId,
          prompt: parsed.data.prompt,
          llmModel: model.id,
          reasoningEffort: parsed.data.reasoningEffort,
          references,
          revisionId: newScene3DRevisionId(),
          ...frame,
          ...(analysisJobId ? { analysisJobId, analyzedReferenceId: videos[0].id } : {}),
        }
        await videoQueue.add(SCENE3D_GENERATE_JOB_TYPE, payload as unknown as Record<string, unknown>, {
          attempts: 1,
          removeOnFail: { count: 200 },
        })
      } catch (err) {
        await undoUnstartedParent(req, job.id, userId, analysisJobId)
        return sendInternalError(reply, req, err, "Failed to start 3D scene authoring")
      }
      return { jobId: job.id }
    },
  )

  app.post(
    "/v1/3d-scene/edit",
    { preHandler: creditGuard((req) => scene3DEditCreditId(req.body)) },
    async (req, reply) => {
      const parsed = scene3DEditBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const deterministic = parsed.data.operations !== undefined
      if (!deterministic) {
        const refusal = await refuseKeylessOrProxied()
        if (refusal) return reply.status(refusal.status).send(refusal.body)
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }

      const planParse = scene3DPlanSchema.safeParse(parsed.data.scenePlan)
      if (!planParse.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(planParse.error) },
        })
      }
      const plan = planParse.data as Scene3DPlan
      // The optimistic-concurrency check, in the ONE place a caller can act on
      // it. Failing this in the worker would turn a client-side conflict into
      // a failed job the caller has to poll to discover.
      if (plan.revisionId !== parsed.data.expectedRevisionId) {
        return reply.status(409).send({
          error: {
            code: "stale_revision",
            message: `This scene has moved on — expected revision ${parsed.data.expectedRevisionId}, the plan is at ${plan.revisionId}.`,
          },
        })
      }

      const model = resolveModel(parsed.data.llmModel)
      if (!model.ok && !deterministic) {
        return reply.status(400).send({ error: { code: "validation_error", message: model.message } })
      }

      const references = (parsed.data.references ?? []) as Scene3DReference[]
      // The set the produced revision will carry: the plan's own references
      // with this request's merged in BY ID. Validated as a WHOLE, because
      // that is the list the plan ends up holding — a request that is legal on
      // its own can still push the merged list past the reference cap or add a
      // second video, and finding that out after the charge is not a fix.
      const mergedReferences = mergeScene3DReferences(plan.references, references)
      const referenceError = scene3DReferenceListError(references) ?? scene3DReferenceListError(mergedReferences)
      if (referenceError) {
        return reply.status(400).send({ error: { code: "validation_error", message: referenceError } })
      }
      if (!deterministic && model.ok) {
        const modalityError = scene3DImageModalityError(model.id, mergedReferences)
        if (modalityError) {
          return reply.status(400).send({ error: { code: "validation_error", message: modalityError } })
        }
      }
      // Only a video the CALLER just attached is analysed. An inherited one
      // came from an earlier revision whose analysis is long gone, and
      // re-analysing it on every edit would bill for a video nobody mentioned.
      const videos = references.filter((r) => r.kind === "video")

      const lockedObjectIds = parsed.data.lockedObjectIds ?? []
      const selectedObjectIds = parsed.data.selectedObjectIds ?? []
      // The revision the edit will produce, minted ONCE so the dry run below
      // and the worker's apply cannot disagree.
      const revisionId = newScene3DRevisionId()

      let operations: Scene3DEditOperation[] | undefined
      if (deterministic) {
        const parsedOps = scene3DEditOperationsSchema.safeParse(parsed.data.operations)
        if (!parsedOps.success) {
          return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsedOps.error) } })
        }
        operations = parsedOps.data as Scene3DEditOperation[]
        // Dry run: an operation list that cannot apply is a 400 the caller can
        // fix, not a job that fails minutes later. It runs the SAME function
        // the worker will, references included, so a reference bound to an
        // object these operations remove — or one they add — is decided here.
        const rehearsal = applyScene3DEditWithReferences({
          plan,
          operations,
          references,
          expectedRevisionId: parsed.data.expectedRevisionId,
          lockedObjectIds,
          revisionId,
        })
        if (!rehearsal.ok) {
          const status = rehearsal.code === "stale_revision" ? 409 : rehearsal.code === "locked_object" ? 403 : 400
          return reply.status(status).send({
            error: {
              code: rehearsal.code,
              message: rehearsal.message,
              ...(rehearsal.operationIndex === undefined ? {} : { operationIndex: rehearsal.operationIndex }),
            },
          })
        }
      }

      const inputData = {
        ...buildJobInputData({ ...parsed.data, scenePlan: undefined, operations: undefined }, SCENE3D_EDIT_JOB_TYPE),
        // The SOURCE scene, stored WHOLE.
        //
        // Only `sourceRevisionId` used to be kept, on the theory that the plan
        // rides the BullMQ payload. It does — until BullMQ prunes that job, and
        // then the edit's own input is gone: a re-run has no scene to re-apply
        // the instruction to and the row cannot say what was edited. The plan
        // IS the input of this job, the way a prompt is the input of a
        // generate, and the row is the durable half of the pair.
        scenePlan: plan,
        sourceRevisionId: plan.revisionId,
        revisionId,
        mode: deterministic ? "operations" : "prompt",
        lockedObjectIds,
        selectedObjectIds,
        // What the CALLER sent. The merge is re-derived from the source plan at
        // apply time, so storing the merged list here would make the row and
        // the request disagree about what this edit actually asked for.
        references,
        ...(operations ? { operations } : {}),
      }
      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: inputData,
      })
      if (jobError) return sendInternalError(reply, req, jobError, "Failed to create job")

      const modelIdentifier = deterministic
        ? SCENE3D_OPS_CREDIT_ID
        : buildLlmCreditIdentifier(SCENE3D_LLM_FEATURE, model.ok ? model.id : undefined, parsed.data.reasoningEffort)
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return

      let analysisJobId: string | undefined
      try {
        if (!deterministic && videos.length === 1) {
          const child = await createAnalysisChild(app, req, videos[0], userId)
          if (!child.ok) {
            await undoUnstartedParent(req, job.id, userId)
            return reply.status(child.status).send(child.body)
          }
          analysisJobId = child.jobId
          await stampAnalysisChild(job.id, userId, inputData, analysisJobId)
        }

        const payload: Scene3DJobPayload = {
          kind: "edit",
          jobId: job.id,
          usageLogId: reservation?.usageLogId,
          plan,
          expectedRevisionId: parsed.data.expectedRevisionId,
          revisionId,
          lockedObjectIds,
          selectedObjectIds,
          references,
          ...(operations ? { operations } : { instruction: parsed.data.prompt! }),
          ...(model.ok ? { llmModel: model.id } : {}),
          reasoningEffort: parsed.data.reasoningEffort,
          ...(analysisJobId ? { analysisJobId, analyzedReferenceId: videos[0].id } : {}),
        }
        await videoQueue.add(SCENE3D_EDIT_JOB_TYPE, payload as unknown as Record<string, unknown>, {
          attempts: 1,
          removeOnFail: { count: 200 },
        })
      } catch (err) {
        await undoUnstartedParent(req, job.id, userId, analysisJobId)
        return sendInternalError(reply, req, err, "Failed to start the 3D scene edit")
      }
      return { jobId: job.id }
    },
  )
}
