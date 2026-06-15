import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  buildMultiPickerAnalyzerSpec,
  PICKER_TYPES,
  buildLlmCreditIdentifier,
  resolveLlmCreditId,
  getLlmModel,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  type PickerType,
  type PickerGaps,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { prefetchAsBase64 } from "../lib/anthropic-image.js"
import { callStructuredLlm } from "../lib/structured-llm.js"
import type { LlmContentBlock } from "../lib/llm-client.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"

const describeToPickerBody = z
  .object({
    imageUrl: safeUrlSchema,
    targetPickers: z.array(z.enum(PICKER_TYPES as [string, ...string[]])).min(1).optional(),
    /** Legacy single-picker form (pre-multi-picker SDK callers). Normalized to an array. */
    targetPicker: z.enum(PICKER_TYPES as [string, ...string[]]).optional(),
    instructions: z.string().max(2000).optional(),
    userId: z.string().uuid().optional(),
    llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  })
  .refine((b) => (b.targetPickers?.length ?? 0) > 0 || !!b.targetPicker, {
    message: "targetPickers (or legacy targetPicker) is required",
  })

/** Normalize the body's picker selection to a non-empty array (array form wins;
 *  legacy scalar is wrapped). Exported for unit testing. */
export function resolveTargetPickers(body: {
  targetPickers?: string[]
  targetPicker?: string
}): PickerType[] {
  if (body.targetPickers && body.targetPickers.length > 0) return body.targetPickers as PickerType[]
  if (body.targetPicker) return [body.targetPicker as PickerType]
  return []
}

interface GapRpcArgs {
  p_picker_type: string
  p_gap_type: "item" | "category"
  p_dimension: string
  p_observed: string
  p_observed_norm: string
  p_chosen_id: string | null
  p_sample_user_id: string
}

function normObserved(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ")
}

/** Flatten gaps into record_picker_catalog_gap arg tuples. chosenId is JOINED
 *  server-side from the picker result (single source of truth — the LLM never
 *  echoes it). Exported for unit testing. */
export function buildGapRecords(
  gaps: PickerGaps | undefined,
  pickerJson: Record<string, unknown>,
  userId: string,
): GapRpcArgs[] {
  const recs: GapRpcArgs[] = []
  for (const it of gaps?.missingItems ?? []) {
    const section = pickerJson[it.picker] as Record<string, unknown> | undefined
    const chosen = section?.[it.dimension]
    recs.push({
      p_picker_type: it.picker,
      p_gap_type: "item",
      p_dimension: it.dimension,
      p_observed: it.observed,
      p_observed_norm: normObserved(it.observed),
      p_chosen_id: Array.isArray(chosen) ? (chosen[0] as string) ?? null : (chosen as string) ?? null,
      p_sample_user_id: userId,
    })
  }
  for (const c of gaps?.missingCategories ?? []) {
    recs.push({
      p_picker_type: c.picker,
      p_gap_type: "category",
      p_dimension: c.suggestedDimension,
      p_observed: c.observed,
      p_observed_norm: normObserved(c.observed),
      p_chosen_id: null,
      p_sample_user_id: userId,
    })
  }
  return recs
}

function buildSystemPrompt(legend: string, instructions?: string): string {
  return [
    "You are analyzing the primary subject and scene of an image to fill one or more structured pickers.",
    "Call the emit tool exactly once. For EACH picker section below, choose the closest-matching option id(s) from that picker's lists.",
    "Fill as many dimensions as possible across all sections; OMIT a dimension only when it is not visible or not determinable. Never exceed a dimension's stated maximum. Only use ids from the lists below.",
    "",
    "GAPS (catalog feedback): Leave `gaps` empty unless the closest available id clearly misrepresents what you see — most images need none.",
    "- Each entry in missingItems { picker, dimension, observed }: within an existing dimension, no id is a good match (still pick the closest id for the result).",
    "- Each entry in missingCategories { picker, suggestedDimension, observed }: a salient visible attribute is covered by NO dimension of any wired picker.",
    instructions ? `Additional guidance: ${instructions}` : "",
    "",
    "PICKERS AND ALLOWED VALUES:",
    legend,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function describeToPickerRoutes(app: FastifyInstance) {
  app.post(
    "/v1/describe-to-picker",
    { preHandler: creditGuard((req) => resolveLlmCreditId("describe-to-picker", req.body)) },
    async (req, reply) => {
      const parsed = describeToPickerBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { imageUrl, instructions } = parsed.data
      const targetPickers = resolveTargetPickers(parsed.data)
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "Anthropic API key required for structured picker analysis" } })
      }

      const llmModelId = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["describe-to-picker"]
      const model = getLlmModel(llmModelId)
      if (!model || model.vendor !== "anthropic" || !model.directFallbackModel) {
        return reply.status(400).send({ error: { code: "validation_error", message: "describe-to-picker requires an Anthropic vision model" } })
      }
      const modelIdentifier = buildLlmCreditIdentifier("describe-to-picker", llmModelId)

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "describe-to-picker"),
        })
        .select("id")
        .single()
      if (jobError) {
        return reply.status(500).send({ error: { code: "internal_error", message: jobError.message } })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        const { schema, toolName, legend } = buildMultiPickerAnalyzerSpec(targetPickers)
        const imageBlock = await prefetchAsBase64(imageUrl)
        const content: LlmContentBlock[] = [imageBlock, { type: "text", text: "Analyze the subject and emit the picker JSON." }]

        const { output, inputTokens, outputTokens } = await callStructuredLlm({
          schema,
          modelId: model.directFallbackModel,
          toolName,
          system: buildSystemPrompt(legend, instructions),
          content,
        })

        const { gaps, ...pickerJson } = output as Record<string, unknown> & { gaps?: PickerGaps }

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: { json: pickerJson, targetPickers, usage: { inputTokens, outputTokens } },
          })
          .eq("id", job.id)
          .eq("user_id", userId)
        await commitReservedCreditsForJob(job.id)

        // Persist catalog-gap feedback (best-effort — never breaks the analysis).
        // Parallel so a 0-8 gap batch doesn't add serial RPC latency to the response.
        await Promise.all(
          buildGapRecords(gaps, pickerJson, userId).map(async (rec) => {
            const { error: gapErr } = await supabase.rpc("record_picker_catalog_gap", rec)
            if (gapErr) req.log.warn({ err: gapErr.message }, "picker gap upsert failed")
          }),
        )

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
