import { hasCredits } from "./config.js"

/**
 * The BASE credits a GPT Image 2.6 run at quality Auto really cost, from the
 * KIE credits its task used, or `undefined` when there is nothing to settle on
 * (no credits in this edition, or not an Auto run): the caller then commits the
 * reservation exactly as before.
 *
 * WHY: at Auto KIE picks the quality, so the price is known only afterwards.
 * The run is reserved at the Max row and this settles the difference, handed to
 * `finalizeJobWithMedia` as `meteredBaseCredits` (held and approved runs replay
 * it) and to the entity tail. Core shim over the ee helper (dynamic import, the
 * credit-guard pattern): community and business never load a billing module.
 */
export async function gptImage26AutoSettledBase(kieCredits: number | undefined): Promise<number | undefined> {
  if (kieCredits === undefined || !hasCredits()) return undefined
  const { gptImage26AutoBaseCredits } = await import("../ee/billing/gpt-image-2-6-pricing.js")
  return gptImage26AutoBaseCredits(kieCredits)
}
