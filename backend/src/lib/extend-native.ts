/**
 * PixVerse V6 Extend's own rules (`pixverse-v6-extend`): a native extend, no
 * tail recipe (those are `extend-recipe.ts`'). The whole source goes to
 * PixVerse's extend, which returns it with the new seconds joined on; the run
 * keeps the user's own source and stitches only the new seconds to it.
 *
 * The route, the workflow run and the worker read the run's seconds and its
 * prompt floor here, so none of them can differ. The seconds
 * (`pixverseExtendSeconds`) are `@nodaro/render-rules`', so the output-length
 * rule the editor's and the server's estimates share reads the same ones.
 */
import { PIXVERSE_V6_EXTEND_PROVIDER } from "@nodaro/shared/models"

export { pixverseExtendSeconds } from "@nodaro/render-rules"

/** The shortest prompt PixVerse V6 Extend takes, in characters, once trimmed (its schema's `minLength`). */
export const PIXVERSE_EXTEND_PROMPT_MIN_CHARS = 3

/**
 * The refusal for a PixVerse V6 Extend prompt shorter than
 * {@link PIXVERSE_EXTEND_PROMPT_MIN_CHARS} once trimmed (none included), in
 * the route's and the workflow run's words alike; null for one long enough.
 * Checked before anything is reserved: the provider refuses it only after.
 */
export function pixverseExtendPromptProblem(prompt: string | null | undefined): string | null {
  return String(prompt ?? "").trim().length < PIXVERSE_EXTEND_PROMPT_MIN_CHARS
    ? `prompt (what happens next) must be at least ${PIXVERSE_EXTEND_PROMPT_MIN_CHARS} characters for ${PIXVERSE_V6_EXTEND_PROVIDER}`
    : null
}
