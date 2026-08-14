import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec, PICKER_TYPES, PICKER_ANALYZER_FAMILIES, type PickerType, type PickerGaps } from "@nodaro/prompts"
import { buildLlmCreditIdentifier, resolveLlmCreditId, getLlmModel, LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, PROMPT_HARD_CEILING } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { llmCompleteStructured } from "../lib/llm-client.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"

/**
 * POST /v1/text-to-picker — free text in, pickerJson out.
 *
 * The text twin of describe-to-picker: the SAME analyzer machinery
 * (descriptor registry → forced structured-output tool → pickerJson + gaps),
 * fed a scene description instead of an image. No vision requirement — any
 * structured-output model works; defaults to the describe-to-picker feature
 * default. Billing deliberately REUSES the describe-to-picker credit
 * identifier: identical LLM call shape (text is strictly cheaper than
 * image+text), so no new pricing surface. Revisit if the economics diverge.
 *
 * Batching: `targetPickers` defaults to ALL 38 analyzable pickers, whose
 * combined legend measures ~53k tokens — too heavy for one accurate call.
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

export async function textToPickerRoutes(app: FastifyInstance) {
  app.post(
    "/v1/text-to-picker",
    // Same LLM call shape as describe-to-picker → same credit identifier.
    { preHandler: creditGuard((req) => resolveLlmCreditId("describe-to-picker", req.body)) },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/text-to-picker")) return

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
      const advancedError = advancedModeError(parsed.data, model.id)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("describe-to-picker", llmModelId, parsed.data.reasoningEffort, parsed.data.advancedMode)

      const { data: job, error: jobError } = await insertJob(req, {
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

      try {
        const batches = batchTargetPickers(targetPickers)
        const results = await Promise.all(
          batches.map(async (batch) => {
            const { schema, toolName, legend } = buildMultiPickerAnalyzerSpec(batch)
            const { output, inputTokens, outputTokens } = await llmCompleteStructured(
              {
                modelId: model.id,
                system: buildSystemPrompt(legend, instructions),
                messages: [{ role: "user", content: [{ type: "text", text: `Scene description:\n${text}\n\nAnalyze it and emit the picker JSON.` }] }],
                reasoningEffort: parsed.data.reasoningEffort,
                ...resolveLlmParams(parsed.data),
              },
              schema,
              { schemaName: toolName },
            )
            const { gaps, ...pickerJson } = output as Record<string, unknown> & { gaps?: PickerGaps }
            return { pickerJson, gaps, inputTokens, outputTokens }
          }),
        )

        const pickerJson = Object.assign({}, ...results.map((r) => r.pickerJson)) as Record<string, unknown>
        const gaps = mergeGaps(results.map((r) => r.gaps))
        const usage = {
          inputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
          outputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
          batches: batches.length,
        }

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: { json: pickerJson, targetPickers, usage },
          })
          .eq("id", job.id)
          .eq("user_id", userId)
        await commitReservedCreditsForJob(job.id)

        return reply.send({ jobId: job.id, pickerJson, gaps })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Picker analysis failed"
        await supabase.from("jobs").update({ status: "failed", output_data: { error: message } }).eq("id", job.id).eq("user_id", userId)
        await refundReservedCreditsForJob(job.id)
        return reply.status(502).send({ error: { code: "llm_error", message } })
      }
    },
  )
}
