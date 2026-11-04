import { GPT_IMAGE_2_KIE_CREDITS, KIE_CREDIT_USD, type KieModelConfig } from "./models.js"

/**
 * What KIE bills for one picture, recorded as the job's provider cost
 * (`jobs.provider_cost`). Recorded only: it reaches the commit as `result.cost`,
 * and the charge, the reserved tier, never reads it.
 *
 * GPT Image 2 bills by the resolution sent, so the model entry's one figure
 * (its 1K price) would understate a 2K or 4K picture.
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
): number {
  if (!GPT_IMAGE_2_PROVIDERS.has(provider)) return modelConfig.cost
  const sent = resolution ?? "1K"
  return isGptImage2Resolution(sent) ? GPT_IMAGE_2_KIE_CREDITS[sent] * KIE_CREDIT_USD : modelConfig.cost
}
