/**
 * How each tail-recipe Extend Video provider continues a clip: it generates a
 * new clip from the LAST `tailSec` seconds of the source (sent as the
 * `@video_1` reference; all of a shorter source's picture, `tailCutSec`),
 * then the two are stitched into one.
 *
 * - Seedance 2.5 (decided 2026-11-12, the provider guide's recipe, rated best
 *   in a blind comparison): the source's last 10 seconds (the whole source
 *   when it is shorter), declared as an extension (`omni_reference_task_type:
 *   "extend"`), with NO start image; the extension is new footage only, so
 *   the stitch is a hard cut at the source's end with a sound crossfade.
 *   Charged per second sent and added (@nodaro/render-rules
 *   `seedance-extend-pricing.ts`).
 * - Seedance 2.0 (unchanged since the 2026-07-12 spike): the last 2 seconds
 *   and the source's last frame as the opening image, undeclared; the stitch
 *   finds and drops the duplicated boundary frame. Priced on its per-length rows.
 * - Kling 4: the last 3 seconds and the source's last frame as the opening
 *   image, with its own prompt, and the same stitch as Seedance 2.0. Priced on
 *   its per-length rows.
 *
 * The tail length lives here and nowhere else (2.5's is the window its price
 * counts, `SEEDANCE_EXTEND_CONTEXT_MAX_SEC`): the run cuts it, and the
 * provider's price rows are held to what a run with it bills
 * (`ee/billing/__tests__/extend-price-rows.test.ts`). The seconds a run may
 * add (each recipe's `window`) and the seconds it adds for a request
 * (`tailRecipeSeconds`) are `@nodaro/render-rules`', so the editor's and the
 * server's estimates read the same extension the run generates.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  EXTEND_VIDEO_PROVIDERS,
  isSeedanceExtendProvider,
  SEEDANCE_2_EXTEND_STITCH,
  SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  type DeclaredSeedanceTaskType,
  type SeedanceExtendProvider,
  type TailExtendProvider,
} from "@nodaro/shared/models"
import { SEEDANCE_EXTEND_CONTEXT_MAX_SEC } from "@nodaro/shared/credits"
import { TAIL_RECIPE_WINDOWS } from "@nodaro/render-rules"

export { isTailRecipeProvider, tailRecipeSeconds } from "@nodaro/render-rules"

/** How the extension is joined onto the source (`stitchExtension`'s boundary options). */
export interface TailRecipeStitch {
  /** Search the boundary with the smart-cut matcher over these windows. Absent: no search, the trims below. */
  smartCut?: { framesFromPrev: number; framesFromNext: number }
  /** Frames dropped from the source's end and the extension's start when no match is applied. */
  fallbackTrims: { trimEndFrames: number; trimStartFrames: number }
  /** The sound's crossfade at the join, in seconds. */
  audioFadeSec: number
}

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
  /** The seconds a run may add (`TAIL_RECIPE_WINDOWS`, @nodaro/render-rules). */
  window: { readonly min: number; readonly max: number }
  /**
   * Whether the source's last frame is sent as the extension's opening image
   * (an anchor the stitch then drops as a duplicate). False: the request
   * carries no image of its own beside the user's references.
   */
  startImage: boolean
  /** The reference task type the request declares (`resolveSeedanceTaskType` decides it is sent), or none. */
  referenceTaskType?: DeclaredSeedanceTaskType
  /** The prompt sent to the model, from the user's own (absent in untyped job data reads as empty) and the seconds added. */
  prompt(userPrompt: string | null | undefined, addedSec: number): string
  /** How the extension is joined onto the source. */
  stitch: TailRecipeStitch
}

const userText = (userPrompt: string | null | undefined): string => String(userPrompt ?? "").trim()

/** Seedance 2.0's prompt (the 2026-07-12 spike's template). */
const seedance20Prompt = (userPrompt: string | null | undefined): string =>
  "extend @video_1 as follows:\n" + userText(userPrompt)

/** Seedance 2.5's prompt: the provider guide's extension trigger, then what happens next. */
const seedance25Prompt = (userPrompt: string | null | undefined, addedSec: number): string =>
  `Extend @video_1 forward by ${addedSec} seconds: ${userText(userPrompt)}`

/** Kling 4's prompt. */
const klingPrompt = (userPrompt: string | null | undefined): string =>
  "Continue @video_1 as one continuous shot, starting exactly where it ends: " + userText(userPrompt)

/** The stitch of a recipe whose extension opens on the source's last frame: find and drop the duplicate. */
const ANCHORED_STITCH: TailRecipeStitch = {
  smartCut: { framesFromPrev: 8, framesFromNext: 8 },
  fallbackTrims: {
    trimEndFrames: SEEDANCE_2_EXTEND_STITCH.trimTailFrames,
    trimStartFrames: SEEDANCE_2_EXTEND_STITCH.trimHeadFrames,
  },
  audioFadeSec: SEEDANCE_2_EXTEND_STITCH.audioFadeSec,
}

export const TAIL_RECIPES: Record<TailExtendProvider, TailRecipe> = {
  "seedance-2-5-extend": {
    genModel: "seedance-2-5",
    tailSec: SEEDANCE_EXTEND_CONTEXT_MAX_SEC,
    minSourceSec: SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
    window: TAIL_RECIPE_WINDOWS["seedance-2-5-extend"],
    startImage: false,
    referenceTaskType: "extend",
    prompt: seedance25Prompt,
    // A declared extension is new footage only: its first frame follows the
    // source's last, it does not repeat it. Nothing is a duplicate, so nothing
    // is searched for or trimmed (a smart cut would "match" two neighbouring
    // frames and cut real footage): a hard cut at the source's end, the sound
    // crossfaded across it.
    stitch: {
      fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
      audioFadeSec: SEEDANCE_2_EXTEND_STITCH.audioFadeSec,
    },
  },
  "seedance-2-0-extend": {
    genModel: "seedance-2",
    tailSec: 2,
    minSourceSec: SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
    window: TAIL_RECIPE_WINDOWS["seedance-2-0-extend"],
    startImage: true,
    prompt: seedance20Prompt,
    stitch: ANCHORED_STITCH,
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
    window: TAIL_RECIPE_WINDOWS["kling-4-extend"],
    startImage: true,
    prompt: klingPrompt,
    stitch: ANCHORED_STITCH,
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
