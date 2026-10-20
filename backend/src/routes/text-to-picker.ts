import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec, PICKER_TYPES, PICKER_ANALYZER_FAMILIES, type PickerType, type PickerGaps } from "@nodaro/prompts/picker-catalogs"
import { buildLlmCreditIdentifier, resolveLlmCreditId, getLlmModel, defaultReasoningEffort, LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, LLM_STRUCTURED_WITHHELD_MODELS } from "@nodaro/shared/llm-models"
import { PROMPT_HARD_CEILING } from "@nodaro/shared/models"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { llmCompleteStructured, type LlmServedLane } from "../lib/llm-client.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { effortTimeoutMs } from "../lib/llm-effort-timeout.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { withDescribeToPickerDefaults } from "./describe-to-picker.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { billedContentRefusal, billedProviderCost } from "../lib/llm-errors.js"
// From its own module, not the client facade a route test replaces.
import { StructuredLlmError } from "../lib/llm/structured.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"

/**
 * POST /v1/text-to-picker — free text in, pickerJson out.
 *
 * The text twin of describe-to-picker: the SAME analyzer machinery
 * (descriptor registry → forced structured-output tool → pickerJson + gaps),
 * fed a scene description instead of an image. No vision requirement — any
 * structured-output model works; defaults to the describe-to-picker feature
 * default (Gemini 3.8 Flash at Auto since 2026-10-20), and to a chosen
 * model's recipe effort when it has one (Opus 5.5 at high, decided 2026-10-09
 * to match describe-to-picker). Billing deliberately REUSES the
 * describe-to-picker credit identifier: identical LLM call shape (text is
 * strictly cheaper than image+text per picker). It bills its OWN credit rows
 * (`TEXT_TO_PICKER_CREDIT_FEATURE`, migration 546): the default run below
 * reads every picker, several times the tokens of one image read, so
 * describe-to-picker's rows did not cover it (production cost audit,
 * 2026-10-20).
 *
 * Batching: `targetPickers` defaults to ALL 39 analyzable pickers, whose
 * combined legend measures ~53k tokens plus ~46k for Character Motion's
 * 1005-id enum — too heavy for one accurate call.
 * Above FAMILY_BATCH_THRESHOLD pickers, the analysis fans out per
 * PICKER_ANALYZER_FAMILIES (scene/look/camera/character/elements/audio, each
 * 6-15k tokens), runs the calls concurrently, and merges pickerJson + gaps.
 * Powers Cine's tweakable AI Fill (spec: backend-text-to-pickers.md).
 */

const FAMILY_BATCH_THRESHOLD = 8

const textToPickerBody = z.object({
  text: z.string().min(1).max(PROMPT_HARD_CEILING),
  targetPickers: z.array(z.enum(PICKER_TYPES as [string, ...string[]])).min(1).optional(),
  instructions: z.string().max(2000).optional(),
  /** Originating client app slug ('cine', 'studio', …) — attribution only. */
  origin: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
})

/** Split the requested pickers into family-sized batches (registry order
 *  preserved inside each family; pickers outside every family — impossible
 *  today, but future-proof — form a trailing batch). Exported for tests. */
export function batchTargetPickers(targets: ReadonlyArray<PickerType>): PickerType[][] {
  if (targets.length <= FAMILY_BATCH_THRESHOLD) return [[...targets]]
  const requested = new Set(targets)
  const batches: PickerType[][] = []
  const seen = new Set<PickerType>()
  for (const family of Object.values(PICKER_ANALYZER_FAMILIES)) {
    const batch = family.filter((t) => requested.has(t))
    if (batch.length > 0) {
      batches.push(batch)
      for (const t of batch) seen.add(t)
    }
  }
  const leftover = targets.filter((t) => !seen.has(t))
  if (leftover.length > 0) batches.push([...leftover])
  return batches
}

/** Merge per-batch gap sidecars into one (arrays concatenate). */
export function mergeGaps(parts: Array<PickerGaps | undefined>): PickerGaps | undefined {
  const missingItems = parts.flatMap((g) => g?.missingItems ?? [])
  const missingCategories = parts.flatMap((g) => g?.missingCategories ?? [])
  if (missingItems.length === 0 && missingCategories.length === 0) return undefined
  return { missingItems, missingCategories }
}

function buildSystemPrompt(legend: string, instructions?: string): string {
  return [
    "You are analyzing a TEXT description of a scene/shot to fill one or more structured pickers.",
    "Call the emit tool exactly once. For EACH picker section below, choose the closest-matching option id(s) from that picker's lists.",
    "Fill as many dimensions as the description supports; OMIT a dimension the text says nothing about — do NOT guess beyond the text. Never exceed a dimension's stated maximum. Only use ids from the lists below.",
    "",
    "GAPS (catalog feedback): Leave `gaps` empty unless the closest available id clearly misrepresents what the text describes — most descriptions need none.",
    "- Each entry in missingItems { picker, dimension, observed }: within an existing dimension, no id is a good match (still pick the closest id for the result).",
    "- Each entry in missingCategories { picker, suggestedDimension, observed }: a salient described attribute is covered by NO dimension of any wired picker.",
    instructions ? `Additional guidance: ${instructions}` : "",
    "",
    "PICKERS AND ALLOWED VALUES:",
    legend,
  ]
    .filter(Boolean)
    .join("\n")
}

/** One family batch's answer: its picker sections, gaps, usage, cost and the lane that served it. */
interface BatchResult {
  pickerJson: Record<string, unknown>
  gaps: PickerGaps | undefined
  inputTokens: number
  outputTokens: number
  providerCost?: number
  lane: LlmServedLane
}

/** One lane when every batch landed on it, else each batch's lane in batch order. */
export function servedLanes(lanes: readonly string[]): string {
  return lanes.every((l) => l === lanes[0]) ? (lanes[0] ?? "") : lanes.join(",")
}

/**
 * The credit feature this route bills under (migration 546). It used to reuse
 * describe-to-picker's id, but a default run here reads EVERY picker's legend
 * — several times the tokens of one image read — so a 2026-10-20 production
 * cost audit gave it rows of its own. Model and effort defaults are still
 * describe-to-picker's (`withDescribeToPickerDefaults`): same analyzer, same
 * recipe; only the price differs.
 */
export const TEXT_TO_PICKER_CREDIT_FEATURE = "text-to-picker"

/**
 * The spend of a run whose batches did not all succeed: every settled batch's
 * cost — a batch that answered reported it, a batch that failed may carry
 * billed usage — or `null` when none reported one. Exported for unit testing.
 */
export function settledProviderCost(results: ReadonlyArray<PromiseSettledResult<{ providerCost?: number }>>): number | null {
  const costs = results.map((r) => (r.status === "fulfilled" ? r.value.providerCost : billedProviderCost(r.reason) ?? undefined))
  return costs.some((c) => c !== undefined) ? costs.reduce<number>((s, c) => s + (c ?? 0), 0) : null
}

export async function textToPickerRoutes(app: FastifyInstance) {
  app.post(
    "/v1/text-to-picker",
    // Same LLM call shape as describe-to-picker, so its defaults are applied
    // before the pre-check prices it — on this route's OWN credit rows.
    { preHandler: creditGuard((req) => resolveLlmCreditId(TEXT_TO_PICKER_CREDIT_FEATURE, withDescribeToPickerDefaults(req.body))) },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/text-to-picker", "text-to-picker")) return

      const parsed = textToPickerBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { text, instructions } = parsed.data
      const targetPickers = (parsed.data.targetPickers as PickerType[] | undefined) ?? [...PICKER_TYPES]
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // Text-only structured analysis — either LLM key works (mirrors
      // describe-to-picker / prompt-helper).
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }

      const llmModelId = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["describe-to-picker"]
      const model = getLlmModel(llmModelId)
      if (!model) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Unknown llmModel" } })
      }
      // The models withheld from every legend-sized read (Claude Fable 5): the
      // same 400 as an unknown model, before any row or reservation exists.
      if (LLM_STRUCTURED_WITHHELD_MODELS.has(model.id)) {
        return reply.status(400).send({ error: { code: "validation_error", message: `llmModel ${model.id} is not offered on text-to-picker` } })
      }
      const advancedError = advancedModeError(parsed.data, model.id)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      // As in describe-to-picker: no effort sent → a model with a recipe effort
      // runs at it, any other model (the default included) keeps its Auto.
      // Resolved ONCE for every batch's request and the credit id, so the bill
      // and the wire agree.
      const reasoningEffort = parsed.data.reasoningEffort ?? defaultReasoningEffort("describe-to-picker", parsed.data.llmModel)
      const modelIdentifier = buildLlmCreditIdentifier(TEXT_TO_PICKER_CREDIT_FEATURE, llmModelId, reasoningEffort, parsed.data.advancedMode)
      // describe-to-picker's effort-aware timeout, from the same resolved
      // effort: a default run goes out at high and gets high's 240 s. Batches
      // run concurrently, so each one gets the whole timeout.
      const timeoutMs = effortTimeoutMs(reasoningEffort)

      const { data: job, error: jobError } = await insertSyncJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "text-to-picker"),
      })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      // What the run spent when a batch failed: the batches that answered
      // before it were paid for too, and `Promise.all` would have dropped them.
      let spentOnFailure: number | null = null
      try {
        const batches = batchTargetPickers(targetPickers)
        const settled: PromiseSettledResult<BatchResult>[] = await Promise.allSettled(
          batches.map(async (batch): Promise<BatchResult> => {
            const { schema, toolName, legend } = buildMultiPickerAnalyzerSpec(batch)
            const { output, inputTokens, outputTokens, providerCost, lane } = await llmCompleteStructured(
              {
                modelId: model.id,
                system: buildSystemPrompt(legend, instructions),
                messages: [{ role: "user", content: [{ type: "text", text: `Scene description:\n${text}\n\nAnalyze it and emit the picker JSON.` }] }],
                reasoningEffort,
                ...resolveLlmParams(parsed.data),
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
              },
              schema,
              { schemaName: toolName },
            )
            const { gaps, ...pickerJson } = output as Record<string, unknown> & { gaps?: PickerGaps }
            return { pickerJson, gaps, inputTokens, outputTokens, providerCost, lane }
          }),
        )
        const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")
        if (failed) {
          spentOnFailure = settledProviderCost(settled)
          throw failed.reason
        }
        const results = settled.map((r) => (r as PromiseFulfilledResult<BatchResult>).value)

        const pickerJson = Object.assign({}, ...results.map((r) => r.pickerJson)) as Record<string, unknown>
        const gaps = mergeGaps(results.map((r) => r.gaps))
        const usage = {
          inputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
          outputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
          batches: batches.length,
        }
        // The run's spend: every batch's cost summed; null when no batch reported one.
        const providerCost = results.some((r) => r.providerCost !== undefined)
          ? results.reduce((s, r) => s + (r.providerCost ?? 0), 0)
          : null

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            ...completedJobColumns(),
            output_data: { json: pickerJson, targetPickers, usage },
            // Which LLM lane served the answer, a fallback included; batches that
            // did not all land on one lane are listed in batch order — and what
            // the run cost the platform on them.
            // `provider` and `provider_cost` are admin-only — outside PUBLIC_JOB_KEYS
            // (routes/jobs.ts) and outside the browser's column grant on jobs
            // (migration 347) — while output_data is owner-readable through both,
            // so neither ever rides there.
            provider: servedLanes(results.map((r) => r.lane)),
            provider_cost: providerCost,
          })
          .eq("id", job.id)
          .eq("user_id", userId)
        await commitReservedCreditsForJob(job.id)

        return reply.send({ jobId: job.id, pickerJson, gaps })
      } catch (err) {
        const message = userFacingMessage(err, "Picker analysis failed")
        // A failure that carried usage was a paid call: its cost — and the
        // batches that answered before it — stays on the row, with the lane
        // the failing batch names when it names one.
        const lane = err instanceof StructuredLlmError ? err.lane : undefined
        await markJobFailed(job.id, {
          error_message: message,
          extra: {
            output_data: { error: message },
            provider_cost: spentOnFailure ?? billedProviderCost(err),
            ...(lane ? { provider: lane } : {}),
          },
        })
        // A content refusal the provider billed is a paid answer: committed, not refunded.
        if (billedContentRefusal(err)) await commitReservedCreditsForJob(job.id)
        else await refundReservedCreditsForJob(job.id)
        return reply.status(502).send({ error: { code: llmErrorCode(err), message } })
      }
    },
  )
}
