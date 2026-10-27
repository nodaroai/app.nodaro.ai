/**
 * Whether a trend's draft may be published, and if not, every reason why
 * (pure; the admin route reads the engine environments and calls this).
 *
 * A Kling 4 trend is also held to Kling 4's prompt cap (`promptBudget`) and to
 * its 10 images a run, counted at the worst case as the route counts them
 * (every slot filled, a prepared person, pet or product as one picture, a
 * location's 3, plus the fixed references).
 *
 * The draft needs a source clip with its display copy (`source.display`, made
 * at upload: the trend's page shows it as the original), at least one
 * required slot, pictures for every slot in every example (a trend may have
 * no example at all: it shows only its original), valid data
 * (`trendVersionDataSchema`), and pre and trend prompts that leave room for
 * the user's details (`promptBudget`), the 4 s preview's own too when the
 * trend offers one (`promptModesOf`). And the Cast Swap engine of EVERY
 * environment in `TREND_PUBLISH_ENVIRONMENTS` must support it: the slot kinds
 * it uses, fixed references when it has some, face masking when it masks
 * (mode not "off"), a trend pre prompt when it has one, the trend's video
 * engine when it is not Seedance 2.5 (the engine's `engines`), every
 * resolution that engine offers (Seedance 2.5: 480p, 720p and 1080p; Kling 4:
 * 720p and 1080p), Full Quality and trend runs, and stored face masks when
 * it masks (`storedFaceMask`), and the mask's target when it masks the face
 * only (`faceMaskTargets` with "face", need `FACE_ONLY_NEED`; the head, the
 * default, is what every engine that makes stored masks covers). An
 * environment with no recorded row is unknown, which blocks like an
 * unsupported one.
 *
 * A masked trend also needs an approved face mask that is up to date
 * (`faceMaskState`, face-mask.ts): none is `face_mask_missing`; one made from
 * other settings or a source clip since changed, under another Video Mask
 * recipe, or under another engine recipe than an environment's, is
 * `face_mask_out_of_date` (one reason each).
 *
 * Per-person variants (decided 2026-10-27, face-mask-variants.ts): more than
 * `MAX_MARKED_PEOPLE` optional people with slot marks is
 * `face_mask_people_over_cap`, always. A trend whose runs can leave a marked
 * person empty (no examples) needs, once its face mask is approved, every
 * variant made and up to date: `face_mask_variant_missing` (none yet, in the
 * making, or failed; `slots` the people it leaves empty; no `slots` when the
 * approved mask cannot make any) or `face_mask_variant_out_of_date`. Such a
 * trend, like one with erased marks, needs `storedFaceMaskRequired`.
 */
import type { EngineEnvironment } from "../engine-environments.js"
import { faceMaskTargetOf, faceMaskTargetsOf, faceMaskingOn } from "../../../lib/cast-swap-face-masking.js"
import { castSwapEnginesOf } from "../../../lib/cast-swap-engines.js"
import {
  CAST_SWAP_ENGINES,
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_KLING_MAX_IMAGES,
  CAST_SWAP_RESOLUTIONS_BY_ENGINE,
} from "@nodaro/shared/models"
import { castSwapImagesSent } from "@nodaro/render-rules"
import { engineOf, MAX_IMAGES_PER_SLOT, trendVersionDataSchema } from "./schemas.js"
import { promptBudget, promptModesOf, TREND_DETAILS_MAX } from "./prompt-budget.js"
import { withPromptsFor } from "./prompt-parts.js"
import { faceMaskHasErasedMarks, faceMaskState, type FaceMaskOutOfDate } from "./face-mask.js"
import { MAX_MARKED_PEOPLE, faceMaskVariantsApply, faceMaskVariantsState, markedPeople } from "./face-mask-variants.js"
import type { CastSwapEngine, TrendResolution, TrendSlotKind, TrendVersionData } from "./types.js"

export interface PublishBlocker {
  code:
    | "source_missing"
    | "source_display_missing"
    | "no_required_slot"
    | "example_slots_incomplete"
    | "invalid_data"
    | "prompt_budget"
    | "engine_unknown"
    | "engine_unsupported"
    | "too_many_images"
    | "face_mask_missing"
    | "face_mask_out_of_date"
    | "face_mask_people_over_cap"
    | "face_mask_variant_missing"
    | "face_mask_variant_out_of_date"
  env?: string
  /**
   * What the engine lacks: a slot kind, "fixedReferences", "faceMasking",
   * "storedFaceMask", "faceMaskTarget:face", "trendPrePrompt", a video engine ("kling-4"), a resolution, "fullQuality",
   * "trendRun" or "castSwap".
   */
  need?: string
  /** 1-based example, for `example_slots_incomplete`. */
  example?: number
  /**
   * The slot keys an example has no pictures for, for `example_slots_incomplete`; the
   * people a person variant leaves empty, for `face_mask_variant_*`.
   */
  slots?: string[]
  /** What is wrong, for `invalid_data`, `prompt_budget`, `too_many_images` and the face mask codes. */
  message?: string
  /** Why the face mask is out of date: "settings", "core_recipe" or "plugin_recipe" (with `env`). */
  why?: FaceMaskOutOfDate["why"]
}

const OUT_OF_DATE_MESSAGES: Readonly<Record<FaceMaskOutOfDate["why"], string>> = {
  settings: "The source clip or the face masking settings changed since the face mask was made. Make it again.",
  core_recipe: "Video Mask changed since the face mask was made. Make it again.",
  plugin_recipe: "This environment's Cast Swap engine masks faces differently since the face mask was made. Make it again.",
}

const RESOLUTIONS: readonly TrendResolution[] = ["480p", "720p", "1080p"]

/** The need of a trend whose masks cover the face only (`faceMasking.target: "face"`). */
export const FACE_ONLY_NEED = "faceMaskTarget:face"

export { castSwapEnginesOf }

/** What every environment's engine must support for this draft, in report order. */
function needsOf(data: TrendVersionData): string[] {
  const engine = engineOf(data)
  const kinds: TrendSlotKind[] = []
  for (const s of data.slots) if (!kinds.includes(s.kind)) kinds.push(s.kind)
  return [
    "trendRun",
    ...kinds,
    ...(data.references.length > 0 ? ["fixedReferences"] : []),
    ...(faceMaskingOn(data.faceMasking) ? ["faceMasking", "storedFaceMask"] : []),
    // Erased marks, or person variants: a run must use the stored mask (or variant) it is sent, and
    // the engine must refuse to mask per run instead.
    ...(faceMaskHasErasedMarks(data) || faceMaskVariantsApply(data) ? ["storedFaceMaskRequired"] : []),
    // The head (the default) is every masking engine's: only the face alone is a need of its own.
    ...(faceMaskingOn(data.faceMasking) && faceMaskTargetOf(data.faceMasking) === "face" ? [FACE_ONLY_NEED] : []),
    // A pre prompt either run sends: the full run's, or the preview's own while it offers one.
    ...(promptModesOf(data).some((mode) => withPromptsFor(data, mode).prePrompt) ? ["trendPrePrompt"] : []),
    // Seedance 2.5 is every engine's: only another engine is a need of its own.
    ...(engine !== CAST_SWAP_ENGINE_WHEN_OMITTED ? [engine] : []),
    ...CAST_SWAP_RESOLUTIONS_BY_ENGINE[engine],
    "fullQuality",
  ]
}

function missingNeeds(env: EngineEnvironment, needs: string[]): string[] {
  const cs = env.supports.castSwap
  if (!cs) return ["castSwap"]
  return needs.filter((need) => {
    if (need === "trendRun") return cs.trendRun !== true
    if (need === "fullQuality") return cs.fullQuality !== true
    if (need === "fixedReferences") return cs.fixedReferences !== true
    if (need === "faceMasking") return cs.faceMasking !== true
    if (need === "storedFaceMask") return cs.storedFaceMask !== true
    if (need === "storedFaceMaskRequired") return cs.storedFaceMaskRequired !== true
    if (need === FACE_ONLY_NEED) return !faceMaskTargetsOf(cs).includes("face")
    if (need === "trendPrePrompt") return cs.trendPrePrompt !== true
    if ((CAST_SWAP_ENGINES as readonly string[]).includes(need)) return !(castSwapEnginesOf(cs) as readonly string[]).includes(need)
    if ((RESOLUTIONS as readonly string[]).includes(need)) return !(cs.resolutions ?? []).includes(need as TrendResolution)
    return !(cs.roleKinds ?? []).includes(need as TrendSlotKind)
  })
}

/** The most images a run of this version sends, as the route counts them (a trend run prepares its references). */
export function klingWorstImages(data: Pick<TrendVersionData, "slots" | "references">): number {
  return castSwapImagesSent(
    data.slots.map((s) => ({ kind: s.kind, images: MAX_IMAGES_PER_SLOT })),
    data.references.reduce((n, r) => n + r.images.length, 0),
  )
}

export function publishBlockers(
  data: TrendVersionData,
  environments: readonly EngineEnvironment[],
  required: readonly string[],
): PublishBlocker[] {
  const out: PublishBlocker[] = []
  if (!data.source) out.push({ code: "source_missing" })
  else if (!data.source.display) out.push({ code: "source_display_missing" })
  if (!data.slots.some((s) => s.required)) out.push({ code: "no_required_slot" })
  data.examples.forEach((ex, i) => {
    const missing = data.slots
      .filter((s) => !(Object.hasOwn(ex.slots, s.key) && (ex.slots[s.key]?.length ?? 0) > 0))
      .map((s) => s.key)
    if (missing.length > 0) out.push({ code: "example_slots_incomplete", example: i + 1, slots: missing })
  })
  const parsed = trendVersionDataSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    out.push({ code: "invalid_data", message: issue ? `${issue.path.join(".") || "data"}: ${issue.message}` : "Invalid trend data." })
  }
  for (const mode of promptModesOf(data)) {
    // The texts a run in this mode sends: the preview's own role names, reference lines and prompts where it has them.
    const texts = withPromptsFor(data, mode)
    const budget = promptBudget(texts)
    const trendLen = texts.trendPrompt?.length ?? 0
    const what = mode === "preview" ? "4 s preview: the" : "The"
    if (trendLen > budget.trendPromptMax) {
      out.push({
        code: "prompt_budget",
        message: `${what} trend prompt is ${trendLen} characters; with the user's details (up to ${TREND_DETAILS_MAX}) the most is ${budget.trendPromptMax}.`,
      })
    } else if (budget.room < 0) {
      const kling = engineOf(data) === "kling-4" ? " on Kling 4" : ""
      out.push({
        code: "prompt_budget",
        message: `${what} pre and trend prompts are ${(texts.prePrompt?.length ?? 0) + trendLen} characters together; with the engine's own text and the user's details the most${kling} is ${Math.max(0, budget.promptsMax)}.`,
      })
    }
  }
  // Kling 4 takes at most 10 images a run, as the route counts them: every slot filled to its 3,
  // a prepared one (person, pet, product: a trend run prepares) as one, plus the fixed references.
  const images = klingWorstImages(data)
  if (engineOf(data) === "kling-4" && images > CAST_SWAP_KLING_MAX_IMAGES) {
    out.push({
      code: "too_many_images",
      message: `A run can send ${images} images (1 per person, pet or product slot, prepared; 3 per location slot; plus the fixed references); Kling 4 takes at most ${CAST_SWAP_KLING_MAX_IMAGES}.`,
    })
  }

  if (faceMaskingOn(data.faceMasking)) {
    const mask = faceMaskState(data, environments, required)
    if (mask.status === "none") {
      out.push({ code: "face_mask_missing", message: "This trend masks faces: make its face mask and approve it." })
    }
    for (const r of mask.reasons) {
      out.push({ code: "face_mask_out_of_date", why: r.why, ...(r.why === "plugin_recipe" ? { env: r.env } : {}), message: OUT_OF_DATE_MESSAGES[r.why] })
    }
    out.push(...variantBlockers(data, mask.status === "approved"))
  }

  const needs = needsOf(data)
  for (const env of required) {
    const row = environments.find((e) => e.env === env)
    if (!row) {
      out.push({ code: "engine_unknown", env })
      continue
    }
    for (const need of missingNeeds(row, needs)) out.push({ code: "engine_unsupported", env, need })
  }
  return out
}

/**
 * The person variants' blockers: the cap on marked people (always), then,
 * when runs can leave a marked person empty and the base mask is approved
 * and up to date (`baseApproved`; otherwise the base's own blocker says it),
 * every variant missing or out of date.
 */
function variantBlockers(data: TrendVersionData, baseApproved: boolean): PublishBlocker[] {
  const people = markedPeople(data)
  if (people.length > MAX_MARKED_PEOPLE) {
    return [{
      code: "face_mask_people_over_cap",
      slots: people,
      message: `${people.length} optional people have face marks; at most ${MAX_MARKED_PEOPLE} may. Remove the face marks of ${people.length - MAX_MARKED_PEOPLE} of them.`,
    }]
  }
  const state = faceMaskVariantsState(data)
  if (!state.applies || !baseApproved) return []
  if (state.baseProblem !== null) {
    return [{
      code: "face_mask_variant_missing",
      message: "The approved face mask kept no copy from before its marks, so no person mask can be made from it. Make the face mask again, then the person masks.",
    }]
  }
  return state.variants.flatMap((v): PublishBlocker[] => {
    const who = v.emptySlots.join(", ")
    if (v.status === "approved") return []
    if (v.status === "out_of_date") {
      return [{ code: "face_mask_variant_out_of_date", slots: v.emptySlots, message: `The face mask for runs without ${who} was made from older marks or another face mask. Make the person masks again.` }]
    }
    const what = v.status === "making" ? "is still being made" : v.status === "failed" ? "failed" : "has not been made"
    return [{ code: "face_mask_variant_missing", slots: v.emptySlots, message: `The face mask for runs without ${who} ${what}. Make the person masks.` }]
  })
}
