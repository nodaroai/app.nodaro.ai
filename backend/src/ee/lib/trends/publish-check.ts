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
 * at upload: the trend's page shows it as the original), its preview input
 * clip when it offers a preview (`previewClip`, cut from THIS source at THIS
 * `previewStart` with the current recipe and the current stored face mask,
 * `previewClipState`: none is `preview_clip_missing`, a stale one
 * `preview_clip_out_of_date` with `why`; the publish route makes it first,
 * so these block only when making it failed), at least one
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
 * A trend that prepares its clip in a depth mode (`faceMasking.source`
 * `"full-depth"` or `"keep-people"`) needs, in every environment, an engine
 * that declares that mode (`castSwap.sourceModes`; absent = faces only):
 * `face_mask_source_unsupported` otherwise. A face mask (absent or `"faces"`)
 * never needs it. Such a trend's runs use its stored clip only
 * (`storedFaceMaskRequired`), and keep people's whole-person target is a need
 * of its own (`faceMaskTarget:body`). The person-variant gates below are a
 * face mask's alone.
 *
 * A trend whose prompt style is not its clip preparation's default
 * (`promptStyle`), or a full-depth trend whose scene source an engine does not
 * take (`faceMasking.scene`; an engine without `castSwap.fullDepthScenes`
 * always sends the original), needs, in every environment, an engine that
 * declares it: `prompt_style_unsupported` / `full_depth_scene_unsupported`
 * otherwise (prompt-style.ts). A full-depth trend that sends the original as
 * a second video with a source clip over `FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC`
 * is `full_depth_clip_too_long`, always (the engines refuse it at run).
 *
 * A trend that overrides the engine's prompt parts (`promptParts`) needs, in
 * every environment, an engine that takes them (`castSwap.promptParts`):
 * `prompt_parts_unsupported` otherwise (it would run on the defaults). And
 * the overrides must still fit the draft as it is now: the route asks this
 * environment's engine (prompt-parts-check.ts) and passes its problems in
 * (`promptPartProblems`); any is `prompt_parts_invalid` with every problem
 * (`problems`; `part_not_used` for an override the trend's clip preparation,
 * prompt style or scene no longer uses).
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
import { faceMaskTargetOf, faceMaskTargetsOf, faceMaskingOn, faceMaskingSourceOf, type FaceMaskingSource } from "../../../lib/cast-swap-face-masking.js"
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
import { promptPartTexts } from "./prompt-parts-store.js"
import { FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC, fullDepthClipTooLong, promptStyleBlockers } from "./prompt-style.js"
import { faceMaskState, faceMaskStoredRequired, type FaceMaskOutOfDate } from "./face-mask.js"
import { previewClipState, type PreviewClipState } from "./preview-clip.js"
import { MAX_MARKED_PEOPLE, faceMaskVariantsApply, faceMaskVariantsState, markedPeople } from "./face-mask-variants.js"
import type { TrendPromptPartProblem } from "./prompt-parts-check.js"
import type { CastSwapEngine, TrendResolution, TrendSlotKind, TrendVersionData } from "./types.js"

export interface PublishBlocker {
  code:
    | "source_missing"
    | "source_display_missing"
    | "preview_clip_missing"
    | "preview_clip_out_of_date"
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
    | "face_mask_source_unsupported"
    | "prompt_parts_unsupported"
    | "prompt_parts_invalid"
    | "prompt_style_unsupported"
    | "full_depth_scene_unsupported"
    | "full_depth_clip_too_long"
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
   * The required slot keys an example has no pictures for, for `example_slots_incomplete`; the
   * people a person variant leaves empty, for `face_mask_variant_*`.
   */
  slots?: string[]
  /** What is wrong, for `invalid_data`, `prompt_budget`, `too_many_images` and the face mask codes. */
  message?: string
  /**
   * Why the face mask is out of date: "settings", "core_recipe" or "plugin_recipe" (with `env`);
   * why the preview clip is: "source", "start", "recipe" or "face_mask".
   */
  why?: FaceMaskOutOfDate["why"] | PreviewClipOutOfDate
  /** What the engine finds wrong with the trend's engine prompt changes, for `prompt_parts_invalid`. */
  problems?: TrendPromptPartProblem[]
}

const OUT_OF_DATE_MESSAGES: Readonly<Record<FaceMaskOutOfDate["why"], string>> = {
  settings: "The source clip or the face masking settings changed since the face mask was made. Make it again.",
  core_recipe: "Video Mask changed since the face mask was made. Make it again.",
  plugin_recipe: "This environment's Cast Swap engine masks faces differently since the face mask was made. Make it again.",
}

/** Why a stored preview input clip is out of date (`preview_clip_out_of_date`). */
export type PreviewClipOutOfDate = Extract<PreviewClipState, { kind: "out_of_date" }>["why"]

const PREVIEW_CLIP_OUT_OF_DATE_MESSAGES: Readonly<Record<PreviewClipOutOfDate, string>> = {
  source: "The source clip changed since the preview's input clip was cut. Save the draft, or publish again, to cut it again.",
  start: "The preview start moved since the preview's input clip was cut. Save the draft, or publish again, to cut it again.",
  recipe: "The preview's input clip is cut differently since it was made. Save the draft, or publish again, to cut it again.",
  face_mask: "The face mask changed since the preview's input clip was cut. Save the draft, or publish again, to cut it again.",
}

const RESOLUTIONS: readonly TrendResolution[] = ["480p", "720p", "1080p"]

/** The need of a trend whose masks cover the face only (`faceMasking.target: "face"`). */
export const FACE_ONLY_NEED = "faceMaskTarget:face"

/** The need of a keep-people trend whose masks cover the whole person (`faceMasking.target: "body"`, its default). */
export const BODY_NEED = "faceMaskTarget:body"

const SOURCE_MODE_NAMES: Readonly<Record<FaceMaskingSource, string>> = {
  faces: "Faces hidden",
  "full-depth": "Full depth",
  "keep-people": "Keep people",
}

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
    // Erased marks, a depth mode, or person variants: a run must use the stored mask (or variant) it is
    // sent, and the engine must refuse to mask per run instead.
    ...(faceMaskStoredRequired(data) || faceMaskVariantsApply(data) ? ["storedFaceMaskRequired"] : []),
    // The head (the default) is every masking engine's: only the face alone, or the whole person, is a need of its own.
    ...(faceMaskingOn(data.faceMasking) && faceMaskTargetOf(data.faceMasking) === "face" ? [FACE_ONLY_NEED] : []),
    ...(faceMaskingOn(data.faceMasking) && faceMaskTargetOf(data.faceMasking) === "body" ? [BODY_NEED] : []),
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
    if (need === BODY_NEED) return !faceMaskTargetsOf(cs).includes("body")
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
  promptPartProblems: readonly TrendPromptPartProblem[] = [],
): PublishBlocker[] {
  const out: PublishBlocker[] = []
  if (!data.source) out.push({ code: "source_missing" })
  else if (!data.source.display) out.push({ code: "source_display_missing" })
  // The preview's input clip, cut ahead of time: a trend that offers a preview publishes with a current one only.
  const clip = previewClipState(data)
  if (clip.kind === "missing") {
    out.push({ code: "preview_clip_missing", message: "The 4 s preview's input clip is not prepared yet. Save the draft, or publish again, to cut it." })
  } else if (clip.kind === "out_of_date") {
    out.push({ code: "preview_clip_out_of_date", why: clip.why, message: PREVIEW_CLIP_OUT_OF_DATE_MESSAGES[clip.why] })
  }
  if (!data.slots.some((s) => s.required)) out.push({ code: "no_required_slot" })
  // A required slot needs pictures in every example; an optional one an example has none for stays as in the clip.
  data.examples.forEach((ex, i) => {
    const missing = data.slots
      .filter((s) => s.required && !(Object.hasOwn(ex.slots, s.key) && (ex.slots[s.key]?.length ?? 0) > 0))
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

  if (fullDepthClipTooLong(data)) {
    out.push({
      code: "full_depth_clip_too_long",
      message: `The source clip is ${data.source!.durationSec.toFixed(1)} s: sending the original as a second video takes clips up to ${FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC} s. Use a shorter clip, or take the scene from a description or from nothing.`,
    })
  }

  if (promptPartProblems.length > 0) {
    out.push({
      code: "prompt_parts_invalid",
      problems: [...promptPartProblems],
      message: `The engine prompt changes no longer fit this trend: ${promptPartProblems.map((p) => p.message).join(" ")}`,
    })
  }

  const source = faceMaskingOn(data.faceMasking) ? faceMaskingSourceOf(data.faceMasking) : "faces"
  if (faceMaskingOn(data.faceMasking)) {
    const mask = faceMaskState(data, environments, required)
    if (mask.status === "none") {
      out.push({
        code: "face_mask_missing",
        message: source === "faces" ? "This trend masks faces: make its face mask and approve it." : "This trend prepares its clip ahead of time: make it and approve it.",
      })
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
    // A depth mode an engine does not declare: it would strip `source` and mask faces (or refuse the run).
    if (source !== "faces" && !(row.supports.castSwap?.sourceModes ?? []).includes(source)) {
      out.push({
        code: "face_mask_source_unsupported",
        env,
        need: source,
        message: `${env}: this environment's Cast Swap engine cannot run the clip preparation "${SOURCE_MODE_NAMES[source]}" yet.`,
      })
    }
    // Prompt part overrides an engine does not declare it takes: the run would be sent its defaults.
    if (promptPartTexts(data.promptParts) && row.supports.castSwap?.promptParts !== true) {
      out.push({
        code: "prompt_parts_unsupported",
        env,
        need: "promptParts",
        message: `${env}: this environment's Cast Swap engine cannot take the trend's engine prompt changes yet: reset them, or wait for the engine.`,
      })
    }
    out.push(...promptStyleBlockers(data, env, row.supports.castSwap))
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
