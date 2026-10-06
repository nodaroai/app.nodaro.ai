/**
 * Length-based speech pricing — the backend half: ONE character count and ONE
 * reader of the model's `:per-100-chars` row, for every seam that reserves
 * speech credits (the two REST route guards, the orchestrator's override, the
 * voiced-video add-on) and for the worker that records what a job cost.
 *
 * The count is the text the worker SENDS: clamped to the cap of the model the
 * request runs as (the route clamps first — routes/text-to-speech.ts), then
 * stripped of [audio tags] when that model does not perform them (the worker
 * strips after — workers/handlers/audio-ai.ts). UTF-16 code units, like every
 * cap check. Dialogue is the sum of its line texts, unstripped (v3 performs
 * tags). Anything that is not text counts 0 → the floor.
 *
 * The amount of a unit is the `model_pricing` row (admin-editable), read
 * through `baseCreditCostFor` (core-safe: ee/ by dynamic import). The formula
 * is `@nodaro/shared`'s `speechCredits`, so a client reading the same row
 * computes the same number.
 */
import { getMaxTtsChars, ttsSupportsAudioTags, speechCredits, speechUnitCreditId, dialogueProviderOf, getDialogueCapabilities } from "@nodaro/shared"
import { stripAudioTags } from "../providers/elevenlabs/audio-tags.js"
import { ttsModelKey } from "../providers/elevenlabs/tts-models.js"
import { baseCreditCostFor } from "./credit-base-cost.js"

/** The default dialogue model's credit id (v3 dialogue); another dialogue model passes its own id, resolved by `dialogueProviderOf`. */
export const DIALOGUE_CREDIT_ID = "elevenlabs-dialogue"

/**
 * The text-to-speech model a request RUNS as: the legacy alias resolved; a
 * missing, unknown or non-string id (node data written straight into workflow
 * JSON) runs as the fallback model — the egress seam's own rule
 * (`ttsModelKey`, providers/elevenlabs/tts-models.ts), so the model priced is
 * the model whose wire id is sent.
 */
export function speechRunsAs(provider: unknown): string {
  return ttsModelKey(typeof provider === "string" ? provider : undefined)
}

/** Characters of `text` the worker will send on `provider`: clamped to the model's cap, tags stripped when the model does not perform them. */
export function billableSpeechChars(provider: unknown, text: unknown): number {
  if (typeof text !== "string") return 0
  const runsAs = speechRunsAs(provider)
  const clamped = text.slice(0, getMaxTtsChars(runsAs))
  return (ttsSupportsAudioTags(runsAs) ? clamped : stripAudioTags(clamped)).length
}

/** Characters of a dialogue script: the sum of its lines' texts, at most the total cap of the dialogue model it runs as (its capability sheet). */
export function billableDialogueChars(lines: unknown, provider?: unknown): number {
  if (!Array.isArray(lines)) return 0
  let total = 0
  for (const line of lines) {
    const text = (line as { text?: unknown } | null)?.text
    if (typeof text === "string") total += text.length
  }
  return Math.min(total, getDialogueCapabilities(provider).maxChars)
}

/** BASE (pre-markup) credits a text-to-speech request on `provider` reserves. */
export async function speechBaseCredits(provider: unknown, text: unknown): Promise<number> {
  const perUnit = await baseCreditCostFor(speechUnitCreditId(speechRunsAs(provider)))
  return speechCredits(billableSpeechChars(provider, text), perUnit)
}

/** BASE (pre-markup) credits a dialogue request on `provider` (a dialogue model id; default v3 dialogue) reserves. */
export async function dialogueBaseCredits(lines: unknown, provider?: unknown): Promise<number> {
  const model = dialogueProviderOf(provider)
  const perUnit = await baseCreditCostFor(speechUnitCreditId(model))
  return speechCredits(billableDialogueChars(lines, model), perUnit)
}
