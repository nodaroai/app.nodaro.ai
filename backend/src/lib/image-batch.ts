/**
 * Several images in one `POST /v1/generate-image` call: `count` and `models`.
 *
 *  - `count` (1–4): that many images of one model, each its OWN job (one image
 *    per job), each under its own idempotency key.
 *  - `models` (2–4 distinct image model ids, instead of `provider`): the same
 *    request on each model — each model's levers snapped by the same catalog
 *    functions as a single call. With `count`, per model; models × count ≤ 8.
 *
 * Neither (or `count: 1`) is a single call, answered exactly as before. This
 * module holds what the CHECK (the credit guard, reading the raw body before
 * Zod) and the handler must agree on — the fields, the cross-field rules, the
 * job order — plus the batch's id, its seeds and its answer.
 *
 * Why these caps: the batch is checked, created and reserved inside one
 * request, so it stays a handful of jobs (8 at most) — a request cannot fan
 * out into an unbounded number of paid jobs. Four of one model fills a picker
 * grid, and four models side by side is a comparison; past that a batch only
 * lengthens the queue its own jobs wait in.
 */
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { IMAGE_GEN_PROVIDERS } from "@nodaro/shared/models"
import type { ModelInputAdjustment } from "@nodaro/shared/model-catalog"
import type { BatchJob } from "./job-batch.js"

export const IMAGE_BATCH_MAX_COUNT = 4
export const IMAGE_BATCH_MAX_MODELS = 4
/** models × count — the most jobs one request creates. */
export const IMAGE_BATCH_MAX_JOBS = 8

/** The two batch fields, spread into the route's body schema. */
export const imageBatchFields = {
  /** How many images to make (1–4), each its own job. With `models`, per model. */
  count: z.number().int().min(1).max(IMAGE_BATCH_MAX_COUNT).optional(),
  /** Run the same request on 2–4 image models at once, instead of `provider`. */
  models: z.array(z.enum(IMAGE_GEN_PROVIDERS)).min(2).max(IMAGE_BATCH_MAX_MODELS).optional(),
}

export interface ImageBatchIssue {
  readonly path: string
  readonly message: string
}

/** The cross-field rules a batch request must pass, beyond each field's own. */
export function imageBatchIssues(data: {
  readonly count?: number
  readonly models?: readonly string[]
  readonly provider?: unknown
  readonly _internalLora?: unknown
}): ImageBatchIssue[] {
  const issues: ImageBatchIssue[] = []
  if (data.models) {
    if (new Set(data.models).size !== data.models.length) {
      issues.push({ path: "models", message: "models must be distinct" })
    }
    if (data.provider !== undefined) {
      issues.push({ path: "models", message: "send either models or provider, not both" })
    }
    if (data._internalLora !== undefined) {
      issues.push({ path: "models", message: "models cannot be combined with a trained character model" })
    }
  }
  if ((data.models?.length ?? 1) * (data.count ?? 1) > IMAGE_BATCH_MAX_JOBS) {
    issues.push({ path: "count", message: `models × count is at most ${IMAGE_BATCH_MAX_JOBS} images per request` })
  }
  return issues
}

/** What a batch request asks for. `models` null = the request's one model. */
export interface ImageBatch {
  readonly models: readonly string[] | null
  readonly count: number
}

/** The batch a validated request asks for, or null when it asks for one image. */
export function imageBatchOf(data: { readonly count?: number; readonly models?: readonly string[] }): ImageBatch | null {
  const count = data.count ?? 1
  if (!data.models && count <= 1) return null
  return { models: data.models ?? null, count }
}

const rawBatchFields = z.object({
  ...imageBatchFields,
  provider: z.unknown().optional(),
  _internalLora: z.unknown().optional(),
})

/**
 * The raw-body twin of {@link imageBatchOf}, for the credit guard, which runs
 * before the handler's validation: the batch a body asks for, or null when it
 * asks for one image OR its batch fields are invalid — the handler answers
 * those with a 400 before anything is created, so they are never priced as one.
 */
export function rawImageBatchOf(body: unknown): ImageBatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const parsed = rawBatchFields.safeParse(body)
  if (!parsed.success || imageBatchIssues(parsed.data).length > 0) return null
  return imageBatchOf(parsed.data)
}

/** A 31-bit seed is one every image model accepts. */
const SEED_SPAN = 2 ** 31

/**
 * Image i's seed: `seed + i`, since one seed for every image of a model would
 * draw the same image N times. Image 0 keeps the caller's seed exactly; past
 * the 31-bit range a later image wraps round to 0.
 */
export function batchSeed(seed: number | undefined, index: number): number | undefined {
  if (seed === undefined || index === 0) return seed
  const next = seed + index
  return seed < SEED_SPAN ? next % SEED_SPAN : next
}

/**
 * The batch's id, on every one of its jobs (`input_data.batchId`, the filter of
 * `GET /v1/jobs?batchId=`). With an Idempotency-Key it is derived from the key,
 * so a retried request (and the job it adds to a partly-created batch) carries
 * the same id; without one it is new each time.
 */
export function imageBatchId(userId: string, idempotencyKey: string | null | undefined): string {
  if (!idempotencyKey) return randomUUID()
  const hex = createHash("sha256").update(`generate-image-batch\u0000${userId}\u0000${idempotencyKey}`).digest("hex")
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

/** One model's share of a planned batch, in job order. */
export interface ImageBatchPlanGroup {
  /** The model id the caller asked for. */
  readonly model: string
  /** How many of the batch's consecutive jobs are this model's. */
  readonly size: number
  readonly adjustments: readonly ModelInputAdjustment[]
  /** Something asked for that was not sent on this model (a moodboard past its reference limit). */
  readonly warnings?: readonly { readonly code: string; readonly message: string }[]
}

const adjustmentSchema = z.object({
  field: z.enum(["aspectRatio", "resolution", "quality", "duration"]),
  from: z.union([z.string(), z.number()]),
  to: z.union([z.string(), z.number()]).optional(),
  reason: z.string(),
})

/** The answer to a batch request (OpenAPI). */
export const imageBatchResponseSchema = z.object({
  jobId: z.string().uuid().describe("The first job — so a reader of the single-image answer keeps working."),
  jobIds: z.array(z.string().uuid()).describe("Every job of the batch, in order: model by model, then image by image."),
  batchId: z.string().describe("On every job of the batch as `input_data.batchId`; `GET /v1/jobs?batchId=` lists them."),
  groups: z.array(z.object({
    model: z.string(),
    jobIds: z.array(z.string().uuid()),
    credits: z.number().optional().describe("Credits held for this model's images; absent where nothing is charged."),
    adjustments: z.array(adjustmentSchema).optional().describe("Parameters corrected for this model, as on a single call."),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional()
      .describe("Something asked for that was not sent on this model, as on a single call."),
  })),
  totalCredits: z.number().optional().describe("The sum of the groups' credits."),
  deduped: z.literal(true).optional().describe("Every job already existed and this request charged nothing: a repeat of a request with the same Idempotency-Key."),
})

export type ImageBatchResponse = z.infer<typeof imageBatchResponseSchema>

/** Credits summed, or null when any of them is unknown (nothing is charged). */
function sumCredits(jobs: readonly BatchJob[]): number | null {
  let total = 0
  for (const job of jobs) {
    if (job.credits === null) return null
    total += job.credits
  }
  return total
}

/** The batch's answer: every job id, grouped by model, with what each model's images hold. */
export function imageBatchResponse(input: {
  readonly batchId: string
  readonly groups: readonly ImageBatchPlanGroup[]
  readonly jobs: readonly BatchJob[]
}): ImageBatchResponse {
  let offset = 0
  const groups = input.groups.map((group) => {
    const jobs = input.jobs.slice(offset, offset + group.size)
    offset += group.size
    const credits = sumCredits(jobs)
    return {
      model: group.model,
      jobIds: jobs.map((job) => job.jobId),
      ...(credits !== null ? { credits } : {}),
      ...(group.adjustments.length > 0 ? { adjustments: [...group.adjustments] } : {}),
      ...(group.warnings && group.warnings.length > 0 ? { warnings: group.warnings.map((w) => ({ ...w })) } : {}),
    }
  })
  const total = sumCredits(input.jobs)
  return {
    jobId: input.jobs[0]!.jobId,
    jobIds: input.jobs.map((job) => job.jobId),
    batchId: input.batchId,
    groups,
    ...(total !== null ? { totalCredits: total } : {}),
    // A repeat that charged nothing: no job made, none taken over and reserved.
    ...(input.jobs.every((job) => !job.created && !job.takenOver) ? { deduped: true as const } : {}),
  }
}
