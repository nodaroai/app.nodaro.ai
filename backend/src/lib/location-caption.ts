import { llmComplete } from "./llm-client.js"

/**
 * Location canonical-description caption (Claude Sonnet vision).
 *
 * Mirrors `captionPortrait()` in `character-portrait-approval.ts` but with a
 * scene/location-shaped system prompt and a hard ceiling on output length to
 * fit the DB's `canonical_description TEXT CHECK (length <= 4000)` constraint.
 *
 * Returns:
 *   - The captioned text on success
 *   - `null` if the LLM produced empty / whitespace-only text
 *   - `null` on any LLM error (swallowed + warn-logged — the caller decides
 *     whether to treat null as fatal (`/llm-caption` → 502) or non-fatal
 *     (`/approve-main-image` → 200 with `canonical_description: null`)).
 *
 * Why swallow inside the helper instead of re-throwing like
 * `captionPortrait()`?  Both call sites (approve-main-image + the upcoming
 * Task-8 llm-caption route) want the boolean "did we get a caption?" — there
 * is no callsite that needs the underlying error. Keeping the swallow here
 * means the route handlers stay thin and don't have to repeat the try/catch.
 *
 * The 4000-char ceiling protects against a model that ignores the 80–120-word
 * budget. We bias the cut toward a sentence boundary in the last ~10 chars
 * window so the caption doesn't end mid-word — but only when the last
 * terminator is at offset > 100 (anything earlier means the model didn't
 * actually return prose, and a hard cut is fine).
 */

export const LOCATION_CAPTION_SYSTEM =
  "You are describing a fictional scene/location to inform downstream image " +
  "generation. Write a concise visual description in 80–120 words that " +
  "captures: architectural features, materials/textures, mood and atmosphere, " +
  "time of day/lighting, key landmarks or focal points, environmental context. " +
  "Do NOT mention people unless they are integral to the scene's identity. Do " +
  "NOT include narrative or backstory. Output plain text only.\n\n" +
  "Language: English ONLY. Do not code-mix or translate scene labels — use " +
  "English names for landmarks and objects."

const MAX_CAPTION_CHARS = 4000
const HARD_CUT = 3990

export async function captionLocation(imageUrl: string): Promise<string | null> {
  try {
    const result = await llmComplete({
      modelId: "claude-sonnet-4.6",
      system: LOCATION_CAPTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Write a deep visual description of this scene:" },
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
      console.warn(`[caption_truncated] location len=${text.length}`)
      return lastDot > 100 ? truncated.slice(0, lastDot + 1) : truncated
    }
    return text
  } catch (err) {
    console.warn("[caption_failed]", err)
    return null
  }
}
