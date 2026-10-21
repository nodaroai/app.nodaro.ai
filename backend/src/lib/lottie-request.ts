/**
 * The Lottie motion-graphics LLM request, built in ONE place for the three
 * readers that must agree on it: the worker handler that sends it
 * (`workers/handlers/motion-graphics-lottie.ts`), and the two metered holds
 * sized from its first attempt — the route's (`routes/motion-graphics-ai.ts`)
 * and the workflow engine's (`computeLlmMeteredHold`, node-executor).
 */
import { LLM_ROUTE_DEFAULTS, LLM_FEATURE_DEFAULTS, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { resolveLlmParams, type LlmAdvancedInput } from "./llm-advanced-mode.js"
import { cheapLanesParam } from "./llm-cheap-lanes.js"
import { LOTTIE_GRAPHIC_SYSTEM_PROMPT } from "../prompts/lottie-graphic-system.js"
import type { LlmMessage, LlmRequest } from "./llm/types.js"

export const LOTTIE_LLM_TIMEOUT_MS = 240_000
export const LOTTIE_MAX_TOKENS = 8192

export interface MotionGraphicsLottiePayload {
  jobId: string
  prompt: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor: string
  llmModel?: string
  advanced?: LlmAdvancedInput
  reasoningEffort?: string
  /** The run is kept to the cheap lanes (`WorkflowExecutionJob.cheapLanesOnly`): no direct-vendor fallback. */
  cheapLanesOnly?: boolean
  /** Regeneration hint (Phase 2) — accepted from day 1. */
  previousSids?: string[]
  usageLogId?: string
}

export function buildLottieUserMessage(p: {
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

/** The model a lottie job runs on: the payload's, else the feature default. */
export function lottieModelId(payload: Pick<MotionGraphicsLottiePayload, "llmModel">): string {
  return payload.llmModel ?? LLM_FEATURE_DEFAULTS["motion-graphics-lottie"]
}

/**
 * The request one lottie attempt sends — built in ONE place. With the
 * payload's own user message it is the FIRST attempt, which is what the
 * metered hold is sized from (the route's `reserveLlmCall` and the workflow
 * engine's `computeLlmMeteredHold`): the repair re-ask is not held (D1), the
 * settle collects it.
 */
export function buildLottieRequest(
  payload: Pick<MotionGraphicsLottiePayload, "prompt" | "fps" | "width" | "height" | "durationInFrames" | "previousSids" | "llmModel" | "reasoningEffort" | "advanced" | "cheapLanesOnly">,
  messages?: LlmMessage[],
): LlmRequest {
  return {
    modelId: lottieModelId(payload),
    system: LOTTIE_GRAPHIC_SYSTEM_PROMPT,
    messages: messages ?? [{ role: "user", content: buildLottieUserMessage(payload) }],
    ...resolveLlmParams(payload.advanced ?? {}, { ...LLM_ROUTE_DEFAULTS["motion-graphics-lottie"], maxTokens: LOTTIE_MAX_TOKENS }),
    ...cheapLanesParam({ cheapLanesOnly: payload.cheapLanesOnly }),
    timeoutMs: LOTTIE_LLM_TIMEOUT_MS,
    reasoningEffort: payload.reasoningEffort as LlmReasoningEffort | undefined,
  }
}
