import {
  GPT_IMAGE_2_KIE_CREDITS,
  KIE_CREDIT_USD,
  MINIMAX_H3_IMAGE_KIE_HUNDREDTHS,
  MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS,
  type KieModelConfig,
} from "./models.js"
import { MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION, isMinimaxH3Image, isMinimaxH3ImageI2i } from "@nodaro/shared/model-catalog"

/**
 * What KIE bills for one picture, recorded as the job's provider cost
 * (`jobs.provider_cost`). Recorded only: it reaches the commit as `result.cost`,
 * and the charge, the reserved tier, never reads it.
 *
 * GPT Image 2 bills by the resolution sent, so the model entry's one figure
 * (its 1K price) would understate a 2K or 4K picture. MiniMax H3 Image bills by
 * the size sent and, on an edit, by each reference image sent.
 */

const GPT_IMAGE_2_PROVIDERS: ReadonlySet<string> = new Set(["gpt-image-2", "gpt-image-2-i2i"])

type GptImage2Resolution = keyof typeof GPT_IMAGE_2_KIE_CREDITS

const isGptImage2Resolution = (resolution: string | number): resolution is GptImage2Resolution =>
  resolution === "1K" || resolution === "2K" || resolution === "4K"

/**
 * The USD KIE bills for a picture of this model at the resolution on the wire.
 * Every other model keeps its entry's figure. GPT Image 2 with no resolution on
 * the wire renders at KIE's default, 1K; a value the table does not name keeps
 * the entry's figure, so a job can never record NaN.
 */
export function kieImageCostUsd(
  provider: string,
  modelConfig: KieModelConfig,
  resolution: string | number | undefined,
  inputImages = 0,
): number {
  if (isMinimaxH3Image(provider)) return minimaxH3ImageCostUsd(provider, resolution, inputImages)
  if (!GPT_IMAGE_2_PROVIDERS.has(provider)) return modelConfig.cost
  const sent = resolution ?? "1K"
  return isGptImage2Resolution(sent) ? GPT_IMAGE_2_KIE_CREDITS[sent] * KIE_CREDIT_USD : modelConfig.cost
}

/**
 * The KIE credits the credit audit expects for a request whose listed cost is
 * `listedCost` (USD, from `kieImageCostUsd`): the entry's own figure when the
 * listed cost is the entry's, so a model whose price never varies logs what it
 * always logged, else that cost in KIE credits (to 1/10000, so a float quotient
 * never reads as a mismatch).
 */
export function expectedKieCreditsFor(modelConfig: Pick<KieModelConfig, "cost" | "credits">, listedCost: number): number {
  if (listedCost === modelConfig.cost) return modelConfig.credits
  return Math.round((listedCost / KIE_CREDIT_USD) * 10000) / 10000
}

/**
 * MiniMax H3 Image: the size sent (KIE's default 2K when none is, matched in
 * any case as KIE reads it), and on an edit every reference image sent.
 */
function minimaxH3ImageCostUsd(provider: string, resolution: string | number | undefined, inputImages: number): number {
  const sent = typeof resolution === "string" ? resolution.trim().toUpperCase() : MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION
  const size = sent === "1K" || sent === "2K" || sent === "4K" ? sent : MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION
  const references = isMinimaxH3ImageI2i(provider) ? Math.max(0, Math.trunc(inputImages)) : 0
  const hundredths = MINIMAX_H3_IMAGE_KIE_HUNDREDTHS[size] + MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS * references
  return (hundredths / 100) * KIE_CREDIT_USD
}

/**
 * The KIE credits a finished task really consumed, from its own record: the
 * whole recordInfo answer, `{ code, message, data: { ... } }`, with the figure
 * inside `data`. Absent, not a number, or not above zero: undefined, so a job
 * records the listed figure rather than nothing or a false zero.
 */
export function kieTaskCreditsConsumed(record: Record<string, unknown> | undefined): number | undefined {
  const data = record?.data
  const task = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
  const raw = task?.creditsConsumed ?? task?.consumeCredits ?? task?.credits_consumed
  const credits = typeof raw === "string" ? Number(raw) : raw
  return typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? credits : undefined
}
