/**
 * How each tail-recipe Extend Video provider continues a clip: it generates a
 * new clip from the LAST `tailSec` seconds of the source (sent as the
 * `@video_1` reference), then the two are stitched into one.
 *
 * The tail length lives here and nowhere else: the run cuts it, and the
 * provider's price rows are held to what a run with it bills
 * (`ee/billing/__tests__/extend-price-rows.test.ts`).
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec, SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC, type SeedanceExtendProvider } from "@nodaro/shared/models"

export interface TailRecipe {
  /** The video model that generates the continuation. */
  genModel: "seedance-2-5" | "seedance-2" | "kling-4"
  /** Seconds of the source's end sent as the `@video_1` reference. */
  tailSec: number
  /**
   * The shortest source (its picture) a run can continue: the shortest
   * reference clip the model takes. A source between this and `tailSec` sends
   * all it has. The route refuses a shorter one before anything is reserved,
   * and the worker again before it generates.
   */
  minSourceSec: number
  /** The seconds a run may add. */
  window: { min: number; max: number }
  /** The prompt sent to the model, from the user's own (absent in untyped job data reads as empty). */
  prompt(userPrompt: string | null | undefined): string
}

const seedancePrompt = (userPrompt: string | null | undefined): string =>
  "extend @video_1 as follows:\n" + String(userPrompt ?? "").trim()

export const TAIL_RECIPES: Record<SeedanceExtendProvider, TailRecipe> = {
  "seedance-2-5-extend": {
    genModel: "seedance-2-5",
    tailSec: 2,
    minSourceSec: SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
    window: { min: 4, max: 30 },
    prompt: seedancePrompt,
  },
  "seedance-2-0-extend": {
    genModel: "seedance-2",
    tailSec: 2,
    minSourceSec: SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
    window: { min: 4, max: 15 },
    prompt: seedancePrompt,
  },
}

/** The refusal for a source shorter than its provider's `minSourceSec`, in the route's and the worker's words alike. */
export function extendSourceTooShortMessage(provider: keyof typeof TAIL_RECIPES, pictureSec: number): string {
  const label = MODEL_CATALOG[provider]?.label ?? provider
  return `Source video is too short to extend: ${label} needs at least ${TAIL_RECIPES[provider].minSourceSec}s of footage to continue from (got ${pictureSec.toFixed(2)}s).`
}

/** Whether an Extend Video provider runs a tail recipe. Own keys only, so `"toString"` answers false. */
export function isTailRecipeProvider(p: string): p is keyof typeof TAIL_RECIPES {
  return Object.hasOwn(TAIL_RECIPES, p)
}

/**
 * The seconds a tail-recipe run adds for a requested `duration`: the seconds
 * its price counts (`pricedOutputDurationSec` — the provider's catalog default
 * when unset or unreadable), rounded and held in the recipe's window. The one
 * reading of the length: the route queues it, the worker generates it and the
 * output-length rule records it.
 */
export function tailRecipeSeconds(provider: keyof typeof TAIL_RECIPES, duration: unknown): number {
  const { window } = TAIL_RECIPES[provider]
  const requested = typeof duration === "number" || typeof duration === "string" ? duration : undefined
  return Math.min(window.max, Math.max(window.min, Math.round(pricedOutputDurationSec(provider, requested))))
}
