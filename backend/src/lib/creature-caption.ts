import { llmComplete, type LlmRequest, type LlmResponse } from "./llm-client.js"

/**
 * Creature canonical-description caption (Claude Sonnet vision).
 *
 * Mirrors captionObject() in object-caption.ts but with a creature-shaped
 * system prompt (describes an animal/creature's form/species/anatomy
 * rather than an object's material/purpose) and the same 4000-char ceiling
 * to fit the DB's canonical_description TEXT CHECK constraint.
 *
 * Returns:
 *   - The captioned text on success
 *   - null if the LLM produced empty / whitespace-only text
 *   - null on any LLM error (swallowed + warn-logged — the caller decides
 *     whether to treat null as fatal (/llm-caption → 502) or non-fatal
 *     (/approve-main-image → 200 with canonical_description: "")).
 *
 * Why swallow inside the helper instead of re-throwing like
 * captionPortrait()? Both call sites (approve-main-image + llm-caption
 * routes) want the boolean "did we get a caption?" — keeping the swallow
 * here means the route handlers stay thin.
 *
 * Length policy: if the model returns > 4000 chars (rare — the system
 * prompt caps at 80–120 words), truncate to 3990 chars and bias the cut
 * toward the last sentence-terminator beyond offset 100. Hard-cut at
 * 3990 when no terminator was found late enough in the slice (anything
 * earlier means the model didn't return prose, and a hard cut is fine).
 */

export const CREATURE_CAPTION_SYSTEM =
  "You are describing a fictional or real animal or creature to inform " +
  "downstream image generation. Write a concise visual description in 80–120 " +
  "words that captures: overall form/anatomy and silhouette, species or " +
  "creature type, primary coloration and markings, coat/skin/feather/scale " +
  "texture, distinguishing anatomical features (horns, wings, fangs, claws, " +
  "fins, tail, eyes), build and proportion, and pose or stance if visually " +
  "evident. Do NOT include scenes, backgrounds, or environments. Do NOT " +
  "mention people or man-made objects (unless an object is anatomically part " +
  "of the creature, like a saddle or armor plating fused to it), or " +
  "narrative. Do NOT add adjectives that imply mood or atmosphere (cozy, " +
  "scary, peaceful). Output plain text only.\n\n" +
  "Language: English ONLY. Do not code-mix or translate any markings/branding " +
  "— use English transliteration for non-English text on the creature."

const MAX_CAPTION_CHARS = 4000
const HARD_CUT = 3990

/** The caption model — fixed in code, so the helper's metered price follows it (`prompt-helper:<model>`). */
export const CREATURE_CAPTION_MODEL = "claude-sonnet-4.6"

/** The caption request as it is sent — what a metered route sizes its hold from. */
export function creatureCaptionRequest(imageUrl: string): LlmRequest {
  return {
    modelId: CREATURE_CAPTION_MODEL,
    system: CREATURE_CAPTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Write a deep visual description of this creature:" },
          { type: "image", url: imageUrl },
        ],
      },
    ],
    maxTokens: 500,
    temperature: 0.6,
  }
}

function fitCaption(raw: string | undefined): string | null {
  const text = (raw ?? "").trim()
  if (text.length === 0) return null
  if (text.length > MAX_CAPTION_CHARS) {
    const truncated = text.slice(0, HARD_CUT)
    const lastDot = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?"),
    )
    console.warn(`[caption_truncated] creature len=${text.length}`)
    return lastDot > 100 ? truncated.slice(0, lastDot + 1) : truncated
  }
  return text
}

/**
 * The caption AND the call behind it: the request as sent and its outcome
 * (the answer, or the error) — so a metered route can record the spend even
 * when the caption came back null (a billed refusal is still a billed call).
 * The caption keeps the swallow-to-null contract.
 */
export async function captionCreatureCall(
  imageUrl: string,
): Promise<{ caption: string | null; request: LlmRequest; outcome: { response: LlmResponse } | { error: unknown } }> {
  const request = creatureCaptionRequest(imageUrl)
  try {
    const response = await llmComplete(request)
    return { caption: fitCaption(response.text), request, outcome: { response } }
  } catch (err) {
    console.warn("[caption_failed]", err)
    return { caption: null, request, outcome: { error: err } }
  }
}

export async function captionCreature(imageUrl: string): Promise<string | null> {
  return (await captionCreatureCall(imageUrl)).caption
}
