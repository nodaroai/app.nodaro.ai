/**
 * Worker handler for the `motion-graphics-lottie` job (Lottie engine, design §3).
 *
 * Async LLM path: the route (P1.8) / payload-builder (P1.9) enqueue a
 * MotionGraphicsLottiePayload; this handler calls the LLM to author a COMPLETE
 * Lottie (Bodymovin) document, validates + auto-fixes it via the pure
 * `validateLottieGraphic` layer, and persists the assembled render plan.
 *
 * Failure semantics (charge-for-nothing guard): a parse/validation failure that
 * survives ONE bounded retry throws a plain Error BEFORE `markJobCompleted`, so
 * the worker's final-attempt catch marks the job failed and refunds the
 * reserved credits. The handler NEVER writes `provider_kind` — the worker's
 * generic "pre-task" pickup is the stale-sweep contract.
 */

import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { llmComplete } from "../../lib/llm-client.js"
import { extractJsonFromAIResponse } from "../../lib/json-utils.js"
import { validateLottieGraphic } from "../../lib/lottie-graphic-validator.js"
import { LOTTIE_GRAPHIC_SYSTEM_PROMPT } from "../../prompts/lottie-graphic-system.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import {
  type HandlerFn,
  markJobCompleted,
  commitJobCredits,
  setJobProgress,
  shouldSaveJobResult,
} from "../shared.js"

const LOTTIE_LLM_TIMEOUT_MS = 240_000
const LOTTIE_MAX_TOKENS = 8192

interface MotionGraphicsLottiePayload {
  jobId: string
  prompt: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor: string
  llmModel?: string
  /** Regeneration hint (Phase 2) — accepted from day 1. */
  previousSids?: string[]
  usageLogId?: string
}

function buildUserMessage(p: {
  prompt: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  previousSids?: string[]
}): string {
  const sidHint = p.previousSids?.length
    ? `\nKeep these existing slot names stable: ${p.previousSids.join(", ")}.`
    : ""
  return `Create a Lottie animation: ${p.prompt}\n\nCanvas: ${p.width}x${p.height}, ${p.fps} fps, ${p.durationInFrames} frames total (ip=0, op=${p.durationInFrames}).${sidHint}`
}

const handleMotionGraphicsLottie: HandlerFn = async function handleMotionGraphicsLottie(job, ctx) {
  const { prompt, fps, width, height, durationInFrames, backgroundColor, llmModel, previousSids } =
    job.data as MotionGraphicsLottiePayload
  const modelId = llmModel ?? LLM_FEATURE_DEFAULTS["motion-graphics-lottie"]
  console.log(`[worker] motion-graphics-lottie ${ctx.jobId} (model: ${modelId})`)

  const expected = { fps, width, height, durationInFrames, backgroundColor }
  const userMessage = buildUserMessage({ prompt, fps, width, height, durationInFrames, previousSids })

  let totalProviderCost = 0
  let lastUsage: unknown

  const attempt = async (messages: Array<{ role: "user" | "assistant"; content: string }>) => {
    const response = await llmComplete({
      modelId,
      system: LOTTIE_GRAPHIC_SYSTEM_PROMPT,
      messages,
      maxTokens: LOTTIE_MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: LOTTIE_LLM_TIMEOUT_MS,
    })
    totalProviderCost += response.providerCost ?? 0
    lastUsage = response.usage
    let parsed: unknown
    let parseError: string | undefined
    try {
      parsed = JSON.parse(extractJsonFromAIResponse(response.text))
    } catch {
      parseError = "Response was not valid JSON."
    }
    const validation = parseError ? null : validateLottieGraphic(parsed, expected)
    return { responseText: response.text, parseError, validation }
  }

  let result = await attempt([{ role: "user", content: userMessage }])

  if (result.parseError || result.validation!.rejected) {
    const problems = result.parseError ?? result.validation!.errors.join("\n")
    console.log(`[worker] motion-graphics-lottie ${ctx.jobId} retry after validation failure`)
    result = await attempt([
      { role: "user", content: userMessage },
      { role: "assistant", content: result.responseText },
      {
        role: "user",
        content: `Your Lottie JSON failed validation:\n${problems}\n\nReturn the corrected COMPLETE JSON object only.`,
      },
    ])
    if (result.parseError) {
      throw new Error("AI returned invalid JSON for the Lottie animation. Please try again.")
    }
    if (result.validation!.rejected) {
      throw new Error(`Lottie validation failed: ${result.validation!.errors.join("; ")}`)
    }
  }

  const validation = result.validation!
  if (validation.autoFixed.length > 0) {
    console.log(`[worker] motion-graphics-lottie ${ctx.jobId} auto-fixes: ${validation.autoFixed.join(", ")}`)
  }

  await setJobProgress(job, ctx.jobId, 100)
  if (!(await shouldSaveJobResult(ctx.jobId))) return

  // Persist the authored Lottie JSON to R2 so it can flow over the `lottie`
  // source handle into lottie-overlay (Phase 4). This is ADDITIVE — the inline
  // plan in output_data is fully usable for preview + render without it, so a
  // failed upload NEVER fails the job (no refund, no throw). The deterministic
  // key (`lottie/<jobId>.json`) is never deleted on failure (repo invariant).
  // Placed after the shouldSaveJobResult gate so cancelled jobs skip the upload.
  let lottieUrl: string | undefined
  try {
    const lottieBuffer = Buffer.from(JSON.stringify(validation.plan!.lottie), "utf-8")
    lottieUrl = await uploadBufferToR2(lottieBuffer, `lottie/${ctx.jobId}.json`, "application/json", ctx.jobUserId)
  } catch (err) {
    console.warn(
      `[worker] motion-graphics-lottie ${ctx.jobId} lottie JSON upload failed (plan still delivered):`,
      err,
    )
  }

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      motionPlan: validation.plan,
      validationErrors: validation.errors,
      autoFixes: validation.autoFixed,
      usage: lastUsage,
      ...(lottieUrl ? { lottieUrl } : {}),
    },
    provider_cost: totalProviderCost || null,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, totalProviderCost || undefined)
  const layerCount = (validation.plan!.lottie as { layers?: unknown[] }).layers?.length ?? 0
  console.log(`[worker] Job ${ctx.jobId} completed: lottie-graphic plan (${layerCount} layers)`)
}

export const motionGraphicsLottieHandlers: Record<string, HandlerFn> = {
  "motion-graphics-lottie": handleMotionGraphicsLottie,
}
