import { llmComplete } from "./llm-client.js"

/**
 * Object canonical-description caption (Claude Sonnet vision).
 *
 * Mirrors captionLocation() in location-caption.ts but with an
 * object-shaped system prompt and the same 4000-char ceiling to fit the
 * DB's canonical_description TEXT CHECK constraint (migration 147).
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
 * routes, shipped in Phase C1b) want the boolean "did we get a caption?"
 * — keeping the swallow here means the route handlers stay thin.
 *
 * Length policy: if the model returns > 4000 chars (rare — the system
 * prompt caps at 80–120 words), truncate to 3990 chars and bias the cut
 * toward the last sentence-terminator beyond offset 100. Hard-cut at
 * 3990 when no terminator was found late enough in the slice (anything
 * earlier means the model didn't return prose, and a hard cut is fine).
 */

export const OBJECT_CAPTION_SYSTEM =
  "You are describing a fictional or real object to inform downstream image " +
  "generation. Write a concise visual description in 80–120 words that " +
  "captures: form/shape, primary material(s) and texture(s), color palette, " +
  "condition (clean/weathered/damaged), distinguishing features (engravings, " +
  "ornamentation, mechanical detail), proportion, and intended purpose if " +
  "visually evident. Do NOT include scenes, backgrounds, or environments. " +
  "Do NOT mention people, animals (unless the object IS an animal-shaped " +
  "artifact like a stuffed toy or statue), or narrative. Do NOT add " +
  "adjectives that imply mood or atmosphere (cozy, scary, peaceful). " +
  "Output plain text only.\n\n" +
  "Language: English ONLY. Do not code-mix or translate engravings/branding " +
  "— use English transliteration for non-English text on the object."

const MAX_CAPTION_CHARS = 4000
const HARD_CUT = 3990

export async function captionObject(imageUrl: string): Promise<string | null> {
  try {
    const result = await llmComplete({
      modelId: "claude-sonnet-4.6",
      system: OBJECT_CAPTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Write a deep visual description of this object:" },
            { type: "image", url: imageUrl },
          ],
        },
      ],
      maxTokens: 500,
      temperature: 0.6,
    })
    const text = (result.text ?? "").trim()
    if (text.length === 0) return null
    if (text.length > MAX_CAPTION_CHARS) {
      const truncated = text.slice(0, HARD_CUT)
      const lastDot = Math.max(
        truncated.lastIndexOf("."),
        truncated.lastIndexOf("!"),
        truncated.lastIndexOf("?"),
      )
      console.warn(`[caption_truncated] object len=${text.length}`)
      return lastDot > 100 ? truncated.slice(0, lastDot + 1) : truncated
    }
    return text
  } catch (err) {
    console.warn("[caption_failed]", err)
    return null
  }
}
