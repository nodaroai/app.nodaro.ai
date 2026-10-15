/**
 * generate_image's several-images path — `count` and `models` — kept beside
 * verbs-image.ts rather than in it: the two arguments, how they become the
 * /v1/generate-image body, and the grouped answer.
 *
 * A model id is matched case-insensitively; one that is not an
 * image-generation model is refused by name (a list of models asks for those
 * models — dropping one would run something the caller did not ask for).
 * The route checks, creates and charges the batch as a whole, fits each
 * model's levers to it and reports what it changed — so the levers of a
 * fan-out are only spelled the catalog way here, against every model's lists,
 * never snapped to one model.
 */
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { IMAGE_GEN_PROVIDERS } from "@nodaro/shared/models"
import { isAutoAspectToken, MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import type { McpSession } from "../session.js"
import { registerTask } from "../tasks.js"
import { mcpInject } from "../internal-request.js"
import { normalizeAspectRatio, normalizeModel, normalizeQuality, normalizeResolution } from "../normalize.js"
import { cardResultText, dispatchJob, errorResult, parseFailure, type SingleJobStructuredContent } from "./_verb-helpers.js"
import { presetCallFields } from "./_image-preset-call.js"

/**
 * The tool's two arguments, kept to the bytes the per-tool wire budget leaves:
 * no schema bounds (the tool and the route refuse a count outside 1-4 or more
 * than 4 models by name), and the rules live in docs/mcp/tools.md. The answer
 * adds nothing to the outputSchema either: its text lists every job id by
 * model, and `jobId` (the first) drives the card.
 */
export const imageBatchArgs = {
  count: z.number().int().optional().describe("1-4 images per model."),
  models: z.array(z.string()).optional().describe("2-4 models instead of model."),
}

const IMAGE_MODELS = new Set<string>(IMAGE_GEN_PROVIDERS)

/** `count` as the route takes it: above 1 makes a batch, anything else is one image. */
export function imageBatchCount(count: unknown): number | undefined {
  return typeof count === "number" && count > 1 ? count : undefined
}

/**
 * `models` as distinct image-generation model ids, in the caller's order, and
 * the ids it names that are not image models. A list of models is a request to
 * run on THOSE models, so an id that is not one is refused by name rather than
 * dropped (dropping every id once ran one default-model job instead).
 */
export function imageBatchModels(models: readonly string[] | undefined): { models: string[]; unknown: string[] } {
  const out: string[] = []
  const unknown: string[] = []
  for (const raw of models ?? []) {
    const id = normalizeModel(raw, "")
    if (!id || !IMAGE_MODELS.has(id)) unknown.push(raw)
    else if (!out.includes(id)) out.push(id)
  }
  return { models: out, unknown }
}

/** The most models one call runs on (the route's cap; the schema leaves it out to spare wire bytes). */
export const IMAGE_BATCH_MAX_MODELS = 4

/** The refusal of a `models` list longer than the cap. */
/** The refusal of a `count` outside 1-4 (the schema carries no bounds, to spare wire bytes). */
export function imageCountRefusal(count: unknown) {
  if (count === undefined || (typeof count === "number" && count >= 1 && count <= 4)) return null
  return {
    content: [{ type: "text" as const, text: `count takes 1-4 images; got ${String(count)}.` }],
    isError: true as const,
  }
}

export function tooManyImageModelsResult(count: number) {
  return {
    content: [{ type: "text" as const, text: `models takes 2-${IMAGE_BATCH_MAX_MODELS} image models; got ${count}.` }],
    isError: true as const,
  }
}

/** The refusal of a `models` list naming ids that are not image models. */
export function unknownImageModelsResult(unknown: readonly string[]) {
  return {
    content: [{
      type: "text" as const,
      text: `Not image models: ${unknown.map((id) => JSON.stringify(id)).join(", ")}. Call list_models for the image model ids, or use model for one model.`,
    }],
    isError: true as const,
  }
}

/** Every value any of `models` lists for a lever. */
function unionOf(models: readonly string[], lever: "aspectRatios" | "resolutions" | "qualities"): string[] {
  const values: string[] = []
  for (const model of models) {
    for (const value of (MODEL_CATALOG[model]?.[lever] as readonly string[] | undefined) ?? []) {
      if (!values.includes(value)) values.push(value)
    }
  }
  return values
}

/** A fan-out's levers, spelled the catalog way against every model's lists (the caller's, else the saved defaults). */
export function fanOutLevers(
  models: readonly string[],
  raw: { aspect_ratio?: string; resolution?: string; quality?: string },
  saved: { aspectRatio?: string; resolution?: string; quality?: string },
): { aspectRatio?: string; resolution?: string; quality?: string } {
  const ratios = unionOf(models, "aspectRatios")
  const resolutions = unionOf(models, "resolutions")
  const qualities = unionOf(models, "qualities")
  return {
    aspectRatio: normalizeAspectRatio(raw.aspect_ratio, ratios, "16:9") ?? normalizeAspectRatio(saved.aspectRatio, ratios, "16:9"),
    resolution: normalizeResolution(raw.resolution, resolutions) ?? normalizeResolution(saved.resolution, resolutions),
    quality: normalizeQuality(raw.quality, qualities) ?? normalizeQuality(saved.quality, qualities),
  }
}

/**
 * A preset across several models: the route body that hands the preset to
 * /v1/generate-image, whose preset hook applies it once per model through the
 * one application path (the model as the provider edit, each model then
 * snapped). Carries only what the caller set — the preset fills the rest, as on
 * a one-model preset call — with the levers spelled against every model's lists.
 */
export async function presetFanOutPayload(
  args: Record<string, unknown>,
  session: McpSession,
  models: readonly string[],
  count: number | undefined,
): Promise<Record<string, unknown>> {
  const spelled = fanOutLevers(models, {
    aspect_ratio: args.aspect_ratio as string | undefined,
    resolution: args.resolution as string | undefined,
    quality: args.quality as string | undefined,
  }, {})
  return {
    presetId: args.presetId,
    ...(args.variables !== undefined ? { presetVariables: args.variables } : {}),
    models,
    ...(count ? { count } : {}),
    ...(await presetCallFields(args, session)),
    ...(args.aspect_ratio !== undefined ? { aspectRatio: isAutoAspectToken(args.aspect_ratio) ? "auto" : spelled.aspectRatio } : {}),
    ...(args.resolution !== undefined && spelled.resolution !== undefined ? { resolution: spelled.resolution } : {}),
    ...(args.quality !== undefined && spelled.quality !== undefined ? { quality: spelled.quality } : {}),
    mcp_client: session.clientName,
    userId: session.userId,
  }
}

/**
 * Send one generate_image call: one image through the standard dispatch, a
 * batch with its grouped answer. A refusal's text names the tool's own
 * `variables` argument where the route says `presetVariables`.
 */
export async function dispatchImageGeneration(
  fastify: FastifyInstance,
  session: McpSession,
  opts: {
    readonly payload: Record<string, unknown>
    readonly batch: boolean
    readonly label: string
    readonly widgetData: Omit<SingleJobStructuredContent, "jobId">
  },
) {
  if (!opts.batch) {
    // A moodboard whose images did not all fit says so in the answer.
    return dispatchJob(fastify, session, { url: "/v1/generate-image", payload: opts.payload, label: opts.label, widgetKind: "image", widgetData: opts.widgetData, surfaceWarnings: true })
  }
  const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/generate-image", payload: opts.payload })
  if (res.statusCode >= 400) return errorResult(res.statusCode, res.body.replace(/presetVariables/g, "variables"))
  const batch = parseImageBatch(res.body)
  return batch ? imageBatchResult(batch, session, opts.widgetData) : parseFailure(res.body)
}

interface ImageBatchAnswer {
  jobIds: string[]
  batchId: string
  groups: Array<{ model: string; jobIds: string[]; warnings?: string[] }>
}

/** A route answer's `warnings[].message` (none when absent or malformed). */
function warningMessages(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return []
  return warnings
    .map((w) => (w && typeof w === "object" && typeof (w as { message?: unknown }).message === "string" ? (w as { message: string }).message : ""))
    .filter((m) => m.length > 0)
}

/** The route's batch answer, or null for a one-image answer. */
export function parseImageBatch(body: string): ImageBatchAnswer | null {
  try {
    const parsed = JSON.parse(body) as Partial<ImageBatchAnswer>
    if (!Array.isArray(parsed.jobIds) || !Array.isArray(parsed.groups) || typeof parsed.batchId !== "string") return null
    return {
      jobIds: parsed.jobIds,
      batchId: parsed.batchId,
      groups: parsed.groups.map((group) => ({ model: group.model, jobIds: group.jobIds, warnings: warningMessages(group.warnings) })),
    }
  } catch {
    return null
  }
}

/** The tool result for a batch: every job id grouped by model; the card follows the first. */
export function imageBatchResult(
  batch: ImageBatchAnswer,
  session: McpSession,
  widgetData: Omit<SingleJobStructuredContent, "jobId">,
) {
  for (const jobId of batch.jobIds) registerTask({ taskId: jobId, userId: session.userId, kind: "image" })
  const groups = batch.groups.map((group) => `${group.model}: ${group.jobIds.join(", ")}`).join("; ")
  const started = cardResultText({
    started: `${batch.jobIds.length} image generations started (batch ${batch.batchId}) — ${groups}.`,
    noun: "outputs",
    pollHint: "poll get_job with each id every 5-10 s, or call wait_for_job for each",
  })
  // A moodboard whose images did not all fit says so, per model.
  const notes = batch.groups.flatMap((group) => (group.warnings ?? []).map((w) => `Note (${group.model}): ${w}`))
  const text = notes.length > 0 ? [started, "", ...notes].join("\n") : started
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      jobId: batch.jobIds[0]!,
      ...widgetData,
    } as unknown as Record<string, unknown>,
  }
}
