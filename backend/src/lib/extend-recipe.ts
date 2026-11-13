/**
 * How each tail-recipe Extend Video provider continues a clip: it generates a
 * new clip from the LAST `tailSec` seconds of the source (sent as the
 * `@video_1` reference; all of a shorter source's picture, `tailCutSec`),
 * then the two are stitched into one.
 *
 * The tail length lives here and nowhere else: the run cuts it, and the
 * provider's price rows are held to what a run with it bills
 * (`ee/billing/__tests__/extend-price-rows.test.ts`).
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  EXTEND_VIDEO_PROVIDERS,
  isSeedanceExtendProvider,
  pricedOutputDurationSec,
  SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  type SeedanceExtendProvider,
  type TailExtendProvider,
} from "@nodaro/shared/models"

export interface TailRecipe {
  /** The video model that generates the continuation. */
  genModel: "seedance-2-5" | "seedance-2" | "kling-4"
  /**
   * Seconds of the source's end sent as the `@video_1` reference — at most:
   * a source with less picture sends all of it (`tailCutSec`).
   */
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

const klingPrompt = (userPrompt: string | null | undefined): string =>
  "Continue @video_1 as one continuous shot, starting exactly where it ends: " + String(userPrompt ?? "").trim()

export const TAIL_RECIPES: Record<TailExtendProvider, TailRecipe> = {
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
  // Kling 4.0 refuses a reference clip under 2 s, and a 2 s cut can measure a
  // frame short of it (1.958 s), so a Kling run sends a 3 s tail; a source
  // with between 2 and 3 s of picture sends all of it. Its price rows hold the
  // 3 s, and no shorter tail changes them: Kling bills the seconds added plus
  // the longer of those and the reference, and it adds 3 s or more.
  "kling-4-extend": {
    genModel: "kling-4",
    tailSec: 3,
    minSourceSec: VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4"]!.minSec,
    window: { min: 3, max: 30 },
    prompt: klingPrompt,
  },
}

/**
 * The Extend Video providers that take the user's reference images
 * (`referenceImageUrls` / `connectedReferences`): Seedance's, whose transport
 * seats them beside the last-frame anchor. Kling 4's extend takes none. The
 * route refuses them on any other provider, and the MCP tool names exactly
 * these: one list.
 */
export const EXTEND_REFERENCE_IMAGE_PROVIDERS: readonly SeedanceExtendProvider[] = EXTEND_VIDEO_PROVIDERS.filter(isSeedanceExtendProvider)

/** The refusal for a source shorter than its provider's `minSourceSec`, in the route's and the worker's words alike. */
export function extendSourceTooShortMessage(provider: keyof typeof TAIL_RECIPES, pictureSec: number): string {
  const label = MODEL_CATALOG[provider]?.label ?? provider
  return `Source video is too short to extend: ${label} needs at least ${TAIL_RECIPES[provider].minSourceSec}s of footage to continue from (got ${pictureSec.toFixed(2)}s).`
}

/**
 * Whether an extension's picture is too short to deliver: shorter than half
 * the seconds the run is billed for (`billedSec`). Exactly half is delivered.
 * No picture (none, zero, or a length that does not read) is too short. Such a
 * run fails with a full refund (`extensionTooShortMessage`), so neither the
 * source alone nor the source with the short extension is ever delivered. For
 * every extend that generates its extension: the tail recipes here, and the
 * native extends.
 */
export function extensionTooShort(pictureSec: number | undefined, billedSec: number): boolean {
  return !(pictureSec !== undefined && pictureSec > 0 && pictureSec >= billedSec / 2)
}

/** Seconds as the extend's messages write them: a whole number as it is, else to one decimal. */
const secondsText = (sec: number): string => (Number.isInteger(sec) ? String(sec) : sec.toFixed(1))

/**
 * The failure an extension refused by `extensionTooShort` reports, word for
 * word what the user sees. Its length is rounded down to one decimal, so a
 * refused length never reads as the half that passes (2.46 s of 5 s: "2.4s");
 * the 1e-9 keeps a tenth that floats a hair below itself (2.3 × 10) whole.
 */
export function extensionTooShortMessage(pictureSec: number | undefined, billedSec: number): string {
  const got = Math.floor((pictureSec !== undefined && pictureSec > 0 ? pictureSec : 0) * 10 + 1e-9) / 10
  return `The model returned only ${got.toFixed(1)}s of the ${secondsText(billedSec)}s extension, so nothing was charged. Try again.`
}

/**
 * The seconds of picture a run cuts as its tail from a source whose picture
 * lasts `pictureSec`: the recipe's `tailSec`, or all of a shorter picture (a
 * source between `minSourceSec` and `tailSec`), so the tail always ends on the
 * last frame.
 */
export function tailCutSec(provider: keyof typeof TAIL_RECIPES, pictureSec: number): number {
  return Math.min(TAIL_RECIPES[provider].tailSec, pictureSec)
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
