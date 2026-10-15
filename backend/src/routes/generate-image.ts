import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { withAdjustments } from "../lib/image-gen-normalize.js"
import { insertJobIdempotent } from "../lib/insert-job.js"
import { runJobBatch, type PlannedBatchJob } from "../lib/job-batch.js"
import {
  batchSeed,
  imageBatchId,
  imageBatchOf,
  imageBatchResponse,
  imageBatchResponseSchema,
  rawImageBatchOf,
  type ImageBatch,
} from "../lib/image-batch.js"
import { sendInternalError } from "../lib/http-errors.js"
import { applyGenerateImagePreset, presetFanOutBodies } from "../lib/presets/generate-image-preset-hook.js"
import { batchPositionsToPrice, replayImageBatch } from "../lib/image-batch-replay.js"
import { userDirectionOf, userDirectionPreHandler, type ResolvedUserDirection } from "../lib/user-direction.js"
import { applyPromptAffixes } from "@nodaro/prompts/prompt-fields"
import { readPromptAffixes } from "@nodaro/shared/nodes"
import { FLUX_LORA_CHARACTER_MODEL_ID, PROMPT_HARD_CEILING } from "@nodaro/shared/models"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { connectedReferenceSchema } from "../lib/connected-reference-schema.js"
import { formatZodError } from "../lib/zod-error.js"
import { generateImageBody, generateImageRequest, type GenerateImageData } from "./generate-image-body.js"
import {
  assembleImageRequest,
  assembledRefCountForPricing,
  buildAssembleInput,
  isStructuredImageMode,
  planImageJob,
  type AssembledImageRequest,
  type ImageJobPlan,
} from "./generate-image-plan.js"

// Re-exported for the key-set drift guard in `__tests__/generate-image.test.ts`.
// The canonical definition now lives in `lib/connected-reference-schema.ts`
// (shared with `generate-video` so both routes use the EXACT same mirror).
export { connectedReferenceSchema }
// The body schema lives in generate-image-body.ts; re-exported for the route's
// importers (tests, the OpenAPI scan) under its long-standing name.
export { generateImageBody }
// The assembly input builder lives in generate-image-plan.ts (every assembly
// the route makes goes through it, told the caller's palette / moodboard).
export { buildAssembleInput }

// `connectedReferenceSchema` now lives in `lib/connected-reference-schema.ts`
// (imported + re-exported above) so `generate-video` shares the EXACT same
// mirror. The key-set drift guard in `__tests__/generate-image.test.ts` still
// pins its fields to the shared `ConnectedReference` type.

/**
 * The credit-CHECK model-identifier resolver (preHandler side). Extracted as a
 * named export so the CHECK===DEBIT billing-parity test can run the EXACT
 * pricing the live preHandler runs — every route test mocks `creditGuard` to a
 * no-op, so this closure would otherwise never execute. The handler's DEBIT
 * identifier (`modelIdentifier` below) is computed at a SEPARATELY-WRITTEN site;
 * the test asserts the two stay byte-identical for the same body across the
 * ref-count cases (see __tests__/generate-image.test.ts). Keep this in lock-step
 * with the handler's reservation identifier.
 */
export function resolveImageCreditIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, unknown>
  // A fan-out names no `provider`: the single identifier the guard also asks
  // about is its first model's (the batch itself is `batchIdentifiers`).
  const first = rawImageBatchOf(body)?.models?.[0]
  return modelCreditIdentifier(req, body, first)
}

/**
 * One model's identifier: from the preset's own request for it when a preset
 * was applied per model (`presetFanOutBodies`), else from the body on `model`.
 */
function modelCreditIdentifier(req: FastifyRequest, body: Record<string, unknown>, model: string | undefined): string {
  const presetBody = model !== undefined ? presetFanOutBodies(req)?.get(model) : undefined
  // The caller's palette / moodboard, resolved by `userDirectionPreHandler`
  // ahead of this guard: a moodboard's images count as references here
  // exactly as they will in the handler's DEBIT.
  const userDirection = userDirectionOf(req)
  return presetBody
    ? imageCreditIdentifierFor(presetBody, undefined, userDirection)
    : imageCreditIdentifierFor(body, model, userDirection)
}

/**
 * The CHECK identifier of EVERY job a batch request will create, in job order
 * (model by model, then image by image) — the guard's `batchIdentifiers`, so
 * the pre-flight prices the whole batch. Each model is priced exactly as a
 * single call naming it would be (its own assembled ref count, its own snap).
 * A repeat of a keyed batch prices only the jobs it will still pay for
 * (`replayImageBatch` found the others). Undefined for a single-image request,
 * or one whose batch fields are invalid (the handler refuses those before
 * anything is created).
 */
export function resolveImageBatchCreditIdentifiers(req: FastifyRequest): string[] | undefined {
  const body = req.body as Record<string, unknown>
  const batch = rawImageBatchOf(body)
  if (!batch) return undefined
  const perModel = batch.models
    ? batch.models.map((model) => modelCreditIdentifier(req, body, model))
    : [imageCreditIdentifierFor(body, undefined, userDirectionOf(req))]
  const all = perModel.flatMap((identifier) => Array.from({ length: batch.count }, () => identifier))
  const toPrice = batchPositionsToPrice(req)
  return toPrice ? all.filter((_, position) => toPrice.has(position)) : all
}

/**
 * The credit identifier of one image of `body` — on `model` when given (one
 * model of a fan-out), else on the body's own `provider` / default.
 */
function imageCreditIdentifierFor(
  body: Record<string, unknown>,
  model: string | undefined,
  userDirection: ResolvedUserDirection | undefined,
): string {
  // Character LoRA single-node Run hint — runs BEFORE Zod, so credits
  // reserve as flux-lora-character (3cr) instead of the default nano-banana
  // (2cr). Without this short-circuit, the preHandler would silently
  // under-bill by 1cr per LoRA inference. Mirrors the kill-switch gate
  // in the handler below — when routing is disabled, fall through to the
  // default identifier so the handler and the preHandler agree.
  if (
    body &&
    typeof body === "object" &&
    "_internalLora" in body &&
    config.CHARACTER_LORA_ROUTING_ENABLED
  ) {
    return FLUX_LORA_CHARACTER_MODEL_ID
  }
  // One model of a fan-out is assembled AS that model: the reference gate
  // inside the assembler is per provider, so the ref count (a pricing input)
  // can differ model to model.
  const pricedBody = model !== undefined ? { ...body, provider: model } : body
  const rawProvider = model ?? (body?.provider as string) ?? defaultImageModel("general", body?.aspectRatio as string | undefined)
  const flatRefs = body?.referenceImageUrls as string[] | undefined
  // Read the levers RAW — this preHandler runs before Zod, so any of them can
  // be a non-string. `resolveNormalizedImageGen` coerces defensively.
  const aspectRatio = body?.aspectRatio
  const quality = body?.quality
  const resolution = body?.resolution
  const renderingSpeed = body?.renderingSpeed

  // WI-1b: in structured mode, `connectedReferences` expand to URLs and are
  // gated per-provider INSIDE `buildImagePrompt` — so the billed reference
  // count must reflect the ASSEMBLED (post-gate, post-dedup) count, not the
  // raw `connectedReferences.length`. We run the SAME shared `assembleImageInput`
  // here that the handler runs, so this CHECK prices the exact amount the
  // handler will DEBIT. (`assembleImageInput` is pure — no I/O, no mutation —
  // so running it twice is safe and cheap. The atomic `reserve_credits` RPC in
  // the handler is the authoritative debit + balance/cap guard; this preHandler
  // is the advisory pre-check, and keeping it on the same count avoids a false
  // 402 / false pass.)
  const structured = isStructuredImageMode(body as {
    connectedReferences?: unknown
    describedReferences?: unknown
    direction?: unknown
    subject?: unknown
    structured?: unknown
  })
  const refCount = structured
    ? assembledRefCountForPricing(pricedBody as Parameters<typeof assembledRefCountForPricing>[0], userDirection)
    : (flatRefs?.length ?? 0)

  // Shared reference-aware builder: mirrors the handler's T2I→I2I auto-swap
  // (triggered by refs being attached — in structured mode the ASSEMBLED count,
  // so a wired character with no @-mention contributes zero refs and does not
  // swap) and encodes the per-ref Flux 2 tier. The SAME helper drives the
  // workflow orchestrator (payload-builder.ts), so single-node and DAG runs
  // reserve identical credits.
  // The catalog snap runs HERE, inside the CHECK, because `resolution` and
  // `quality` are pricing dimensions — a snap applied only in the handler would
  // break CHECK === DEBIT (see `resolveNormalizedImageGen`'s docstring).
  // `aspectRatio` is threaded too: it does not price on its own, but the
  // cross-field rules (gpt-image-2 `auto` → 1K) re-price through it.
  return resolveNormalizedImageGen({
    provider: rawProvider,
    aspectRatio,
    quality,
    resolution,
    renderingSpeed,
    refCount,
    swapToI2i: true,
  }).identifier
}


openApiRegistry.registerPath({
  method: "post",
  path: "/v1/generate-image",
  description:
    "Generate an image (async). Returns a jobId — poll GET /v1/jobs/{id}/status. " +
    "Every generation node follows this same shape: POST /v1/{node-type} with " +
    "that node's params (see the node catalog for per-type fields). " +
    "`count` (up to 4 images, each its own job) and `models` (the same request on " +
    "2-4 models) make several jobs in one call, answered with every job id grouped " +
    "by model; the batch is checked and charged as a whole or not at all.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: generateImageBody } } } },
  responses: {
    200: {
      description: "Job created — or, with `count` above 1 or `models`, the batch's jobs",
      content: {
        "application/json": {
          schema: z.union([
            z.object({
              jobId: z.string().uuid(),
              /** Present only when a catalog-invalid parameter was corrected. */
              adjustments: z.array(z.object({
                field: z.enum(["aspectRatio", "resolution", "quality", "duration"]),
                from: z.union([z.string(), z.number()]),
                to: z.union([z.string(), z.number()]).optional(),
                reason: z.string(),
              })).optional(),
              /** Present only when something you asked for was not sent — e.g.
               *  `moodboard_images_not_sent`: some of a `moodboard:<id>`
               *  direction's images did not fit the model's reference limit. */
              warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
            }),
            imageBatchResponseSchema,
          ]),
        },
      },
    },
    400: { description: "Invalid request — including a `palette:` / `moodboard:` direction value that is malformed or on the wrong key" },
    401: { description: "Unauthorized" },
    402: { description: "Insufficient credits — for a batch, for the batch as a whole (`required` is its total)" },
    404: { description: "`direction_not_found` — a `palette:<id>` / `moodboard:<id>` direction that is not one of yours" },
  },
})

/**
 * The character text identity injection appends, or null when the request
 * does not ask for it (or the character has none). Looked up ONCE per request:
 * every model of a fan-out appends the same text. Degradation chain:
 * canonical_description -> description; the `name`-only case is skipped on
 * purpose — injecting just a name adds zero identity signal and pollutes the
 * prompt. (Kept in the route, beside its other reads, so the planner module
 * holds no database client.)
 */
async function characterIdentityText(data: GenerateImageData, userId: string): Promise<string | null> {
  if (!data.injectCharacterContext || !data.attachToCharacterId) return null
  const { data: char } = await supabase
    .from("characters")
    .select("canonical_description, description, name")
    .eq("id", data.attachToCharacterId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  if (!char) return null
  const canonical = typeof char.canonical_description === "string" ? char.canonical_description.trim() : ""
  const desc = typeof char.description === "string" ? char.description.trim() : ""
  const identityText = canonical.length > 0 ? canonical : (desc.length > 0 ? desc : "")
  return identityText.length > 0 ? identityText : null
}

/**
 * Resolve `_internalLora.characterId` to `{ version, trigger }` via a
 * server-side lookup scoped by the caller. The caller never sees the raw
 * Replicate version hash — preventing a stolen JWT from running inference
 * against another user's trained model by submitting a guessed version string.
 * The `lora_training_status='succeeded'` filter ensures we only route through
 * fully-trained models (in-flight or failed trainings fall back to the generic
 * provider).
 */
async function resolveTrainedCharacter(
  internalLora: GenerateImageData["_internalLora"],
  userId: string,
): Promise<{ ok: true; lora: { version: string; trigger: string } | null } | { ok: false }> {
  // Gated by CHARACTER_LORA_ROUTING_ENABLED — when "false", we ignore the
  // body hint entirely and the request proceeds as the default provider.
  // The frontend may still send `_internalLora`; the server is the
  // authority on whether to swap.
  if (!internalLora || !config.CHARACTER_LORA_ROUTING_ENABLED) return { ok: true, lora: null }
  const { data: char } = await supabase
    .from("characters")
    .select("lora_replicate_version, lora_trigger_word, lora_training_status")
    .eq("id", internalLora.characterId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  if (
    !char ||
    char.lora_training_status !== "succeeded" ||
    !char.lora_replicate_version ||
    !char.lora_trigger_word
  ) {
    return { ok: false }
  }
  return { ok: true, lora: { version: char.lora_replicate_version, trigger: char.lora_trigger_word } }
}

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", {
    // `replayImageBatch` first: a repeat of a keyed batch is answered from its
    // jobs, or priced for the jobs it still pays for, before any check.
    // `applyGenerateImagePreset` next: the preset is applied to the body before
    // anything prices it (it rewrites the body into the editor's request). Then
    // the caller's palette / moodboard (`direction.colorLook: "palette:<id>"`,
    // `direction.style: "moodboard:<id>"`) is resolved on the body that will
    // run, BEFORE the credit guard: the guard prices the run on its assembled
    // references, which a moodboard adds to. `batchIdentifiers`: with `count` /
    // `models`, the guard checks the WHOLE batch — every job's price summed —
    // before anything is created.
    preHandler: [
      replayImageBatch,
      applyGenerateImagePreset,
      userDirectionPreHandler,
      creditGuard(resolveImageCreditIdentifier, { batchIdentifiers: resolveImageBatchCreditIdentifiers }),
    ],
  }, async (req, reply) => {
    const parsed = generateImageRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    // The batch fields describe the REQUEST, not any one job: each job is one
    // image on one model, so neither is stored on a job.
    const { count: _count, models: _models, ...fields } = parsed.data
    const batch = imageBatchOf(parsed.data)
    // No model named → the platform's default for this ratio (shared
    // `image-model-roles.ts`), resolved once here so the snap, the credit
    // reservation and the job all see the same concrete model. A fan-out
    // names its models instead.
    let data: GenerateImageData = fields
    if (!batch?.models && !data.provider) {
      data = { ...data, provider: defaultImageModel("general", data.aspectRatio) as NonNullable<GenerateImageData["provider"]> }
    }

    // Pre & post text: wrapped around the caller's prompt ONCE, here — before
    // structured assembly, the prompt policies and every length check — so all
    // of them see the one prompt the provider will get. Dropped from the body
    // afterwards: `input_data` then holds the wrapped prompt alone, and nothing
    // that re-sends it can wrap it a second time.
    {
      const wrapped = applyPromptAffixes(data.prompt, readPromptAffixes(data), new Map())
      if (wrapped.length > PROMPT_HARD_CEILING) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `prompt with its pre/post text exceeds ${PROMPT_HARD_CEILING} characters` },
        })
      }
      const { promptPrefix: _prefix, promptSuffix: _suffix, ...rest } = data
      data = { ...rest, prompt: wrapped }
    }

    // One request per model: a single call (and `count`) is one model, a
    // fan-out one per entry — each assembled AS that model, since the
    // reference gate inside the assembler is per provider. With a preset, a
    // model's request is the one the preset built for it (the hook applies it
    // per model), validated like any request.
    const presetBodies = presetFanOutBodies(req)
    const perModel: GenerateImageData[] = []
    for (const model of batch?.models ?? []) {
      const presetBody = presetBodies?.get(model)
      if (!presetBody) {
        perModel.push({ ...data, provider: model as NonNullable<GenerateImageData["provider"]> })
        continue
      }
      const { count: _c, models: _m, ...modelBody } = presetBody
      const own = generateImageBody.safeParse(modelBody)
      if (!own.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(own.error) },
        })
      }
      perModel.push(own.data)
    }
    if (!batch?.models) perModel.push(data)
    const structuredMode = isStructuredImageMode(data)
    // The caller's palette / moodboard, resolved before the credit guard (the
    // same resolution the guard priced on); every model's assembly is told it.
    const userDirection = userDirectionOf(req)
    const assembled: AssembledImageRequest[] = []
    for (const request of perModel) {
      const result = assembleImageRequest(request, structuredMode, userDirection)
      if (!result) {
        return reply.status(400).send({
          error: { code: "no_prompt", message: "No prompt" },
        })
      }
      assembled.push(result)
    }

    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Internal-only provider gate: flux-lora-character requires the paired
    // _internalLora hint. If a client somehow submits the provider literal
    // without the hint, reject — this is internal-orchestrator-only.
    if (data.provider === FLUX_LORA_CHARACTER_MODEL_ID && !data._internalLora) {
      return reply.status(400).send({
        error: {
          code: "internal_only_provider",
          message: "flux-lora-character requires _internalLora hint",
        },
      })
    }

    // A fan-out never carries the hint (refused by the schema).
    const trained = await resolveTrainedCharacter(data._internalLora, userId)
    if (!trained.ok) {
      return reply.status(400).send({
        error: {
          code: "character_not_trained",
          message: "Character not found or has no successful LoRA training.",
        },
      })
    }

    // Looked up once: every model of a fan-out appends the same text.
    const identityText = await characterIdentityText(data, userId)
    const plans: ImageJobPlan[] = []
    for (const [i, request] of perModel.entries()) {
      plans.push(await planImageJob({ data: request, assembled: assembled[i]!, resolvedLora: trained.lora, identityText, userDirection, log: req.log }))
    }

    const mcpClient = extractMcpClient(req.body)
    const rowBase = {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    }

    if (batch) return runImageBatch(req, reply, { batch, plans, rowBase, userId })

    const plan = plans[0]!
    // Race-proof INSERT: if a concurrent caller already inserted a row with
    // the same (user_id, idempotency_key), the DB UNIQUE constraint catches
    // it and we get back the winner's row with `created: false`. Skip credit
    // reservation in that case — the original caller already reserved.
    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertJobIdempotent<{ id: string }>(
        req,
        { ...rowBase, input_data: plan.inputData },
        req.idempotencyKey,
      )
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create image generation job")
    }
    const job = insertResult.row

    if (!insertResult.created) {
      // Dedup hit at the DB layer (race winner already exists). Mirror the
      // preHandler dedup-hit response so callers see a consistent contract.
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, plan.creditIdentifier)
    if (reply.sent) return

    await videoQueue.add("generate-image", { jobId: job.id, ...plan.queueData, usageLogId: reservation?.usageLogId })

    // Disclose corrections rather than silently handing back something else.
    // Absent when nothing changed, so the mainline body is unchanged.
    return withAdjustments({ jobId: job.id, ...(plan.warnings.length > 0 ? { warnings: plan.warnings } : {}) }, plan.adjustments)
  })
}

/** A batch job's queue id: its own, so the queue holds one entry per job (BullMQ ids may not contain ":"). */
export function imageBatchQueueId(jobId: string): string {
  return `generate-image-${jobId}`
}

/**
 * The batch lane (`count` > 1, or `models`): each plan × `count`, in job order
 * (model by model, then image by image — the order the CHECK priced), created,
 * reserved and queued all or nothing by `runJobBatch`. Image i of a model gets
 * `seed + i`; every job carries the batch's id and its position.
 */
async function runImageBatch(
  req: FastifyRequest,
  reply: FastifyReply,
  args: {
    readonly batch: ImageBatch
    readonly plans: readonly ImageJobPlan[]
    readonly rowBase: Record<string, unknown> & { readonly user_id: string }
    readonly userId: string
  },
) {
  const batchId = imageBatchId(args.userId, req.idempotencyKey)
  const jobs: PlannedBatchJob[] = []
  const queueData: Record<string, unknown>[] = []
  for (const plan of args.plans) {
    for (let i = 0; i < args.batch.count; i++) {
      const seed = batchSeed(plan.queueData.seed as number | undefined, i)
      const seeded = seed !== undefined ? { seed } : {}
      jobs.push({
        row: { ...args.rowBase, input_data: { ...plan.inputData, ...seeded, batchId, batchIndex: jobs.length } },
        creditIdentifier: plan.creditIdentifier,
      })
      queueData.push({ ...plan.queueData, ...seeded })
    }
  }

  const created = await runJobBatch(req, reply, jobs, {
    idempotencyKey: req.idempotencyKey,
    failureMessage: "Failed to create image generation jobs",
    // One call: BullMQ adds the whole list atomically, or none of it. Each
    // entry's queue id is its job's, so a retry that queues a job again is
    // ignored while that job is still in the queue.
    enqueue: async (toQueue) => {
      await videoQueue.addBulk(toQueue.map((job) => ({
        name: "generate-image",
        data: { jobId: job.jobId, ...queueData[job.index], usageLogId: job.usageLogId },
        opts: { jobId: imageBatchQueueId(job.jobId) },
      })))
    },
  })
  if (!created) return

  const response = imageBatchResponse({
    batchId,
    groups: args.plans.map((plan) => ({ model: plan.model, size: args.batch.count, adjustments: plan.adjustments, warnings: plan.warnings })),
    jobs: created,
  })
  // Every job already existed and nothing was charged: the same contract as a
  // single call's replay.
  if (response.deduped) reply.header("X-Dedup-Hit", "1")
  return response
}
