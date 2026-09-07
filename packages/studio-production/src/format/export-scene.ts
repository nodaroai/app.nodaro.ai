import { normalizeSubjectFields, type SubjectFields } from "@nodaro/prompts"

import type { StageDraft } from "../composer-draft-types"
import type { FrameSettings, MotionSettings } from "../scene-settings"
import { stillResults, type Shot, type ShotStillResult } from "../shot"
import { subjectSelection } from "../subject"
import type { SubjectSelection } from "../subject-pickers"
import { TRANSITION_AUTO_ID } from "../transition"

import { audioFromDirections } from "./audio"
import type { FrameDocument, LeverNode, MotionDocument } from "./schema"

/**
 * The FRAME/MOTION half of the scene projection (B14) — split out of
 * `export.ts` pre-emptively (the file sat at 736 lines, under the 800-line
 * house cap, but close enough that the program's later tasks would push it
 * over). `toFrameDocument` and `toMotionDocument`, plus the prose/subject
 * helpers only they need (`activeStill`, `framingPrompt`, `motionPrompt` are
 * also read by `export.ts`'s own `toCast`, so they are exported back to it
 * rather than duplicated).
 * `toScene` itself — the whole-scene assembler that calls both — stays in
 * `export.ts`, alongside `toLookMap`/`toShotDocument`/`toVoiceDocument` and
 * everything else a scene carries beside its frame and motion. Same discipline
 * as the rest of the format: PURE, copy-on-write, every relocation here a pure
 * move.
 */

/** The catalogs' "the model decides" row — `transitionIsSet`'s own rule. A node
 *  sitting on it carries no decision and must not travel: an exported `auto`
 *  would inflate the recipient's transition count. `lib/character-fx` spells the
 *  same literal in an unexported constant, so the exported one is the single
 *  name for both. */
const AUTO_ID = TRANSITION_AUTO_ID

/** A lever node as the document writes it; `undefined` when nothing is picked —
 *  an absent id OR the catalog's `auto` row both mean the model decides
 *  (`transitionIsSet`'s rule). The levers drop with it: a lever without an
 *  effect is nothing — `ShotCharacterFx`'s own rule.
 *
 *  Lives HERE rather than in `export.ts` (a pure move) because the scene's own
 *  `motion.endTransition` is written by {@link toMotionDocument} below, and
 *  export.ts already imports from this module — one definition, no cycle. */
export function toLeverNode(
  node:
    | {
        readonly id?: string
        readonly position?: string
        readonly duration?: string
        readonly intensity?: string
      }
    | undefined,
): LeverNode | undefined {
  if (!node?.id || node.id === AUTO_ID) return undefined
  return {
    id: node.id,
    ...(node.position ? { position: node.position } : {}),
    ...(node.duration ? { duration: node.duration } : {}),
    ...(node.intensity ? { intensity: node.intensity } : {}),
  }
}

/** The first value that carries text, trimmed. */
function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const text = value?.trim()
    if (text) return text
  }
  return undefined
}

/** The still a scene currently reads as. */
export function activeStill(shot: Shot): ShotStillResult | undefined {
  if (!shot.still) return undefined
  return stillResults(shot.still)[shot.still.activeIndex ?? 0]
}

/**
 * The Framing prose — the unsent draft, else the plan, else what a still
 * recorded (the LAST resort).
 *
 * A LEGACY still prompt is NOT raw: before the direction channel went
 * server-side, the framing submit folded every look clause into the string at
 * FULL verbosity and `useStartFraming` echoed THAT verbatim onto every result —
 * so exporting it beside `look` / `film` would fold twice on the next render,
 * the exact class {@link motionPrompt} guards against. It is still accepted
 * last, because folded prose beats no prose.
 *
 * So the rung is CLASSIFIED, not just picked: whichever one wins says whether
 * its prose is folded, and a folded one is stamped `promptBaked` on the way out
 * (`FrameDocument.promptBaked`). That is what makes D4's legacy-seed rule
 * compose with the plan the importer builds — without it a plan prompt is
 * permanently unclassifiable, and an imported legacy scene generates with its
 * `look` folded a second time.
 *
 * Rung by rung: an unsent DRAFT is what the user is typing — raw. The PLAN
 * carries its own flag, so an export → import → re-export cannot launder the
 * marker away. A `promptFormat: 2` RESULT is raw prose (every look clause rides
 * the `direction` field). Only an UNMARKED result is baked.
 *
 * `shot.still?.prompt` is the final rung, for a LEGACY collapsed still:
 * `buildStill` drops the results list of a bare lone result and `stillResults`
 * then yields `[{ url }]`, so the prompt survives only at still level. It is
 * legacy by definition — a marked result never collapses without its marker.
 */
export function framingPrompt(
  shot: Shot,
  draft: StageDraft | undefined,
): { readonly text: string; readonly baked: boolean } | undefined {
  const still = activeStill(shot)
  const rungs: ReadonlyArray<{ text: string | undefined; baked: boolean }> = [
    { text: draft?.text, baked: false },
    { text: shot.plan?.frame?.prompt, baked: shot.plan?.frame?.promptBaked === true },
    { text: still?.prompt, baked: still?.promptFormat !== 2 },
    { text: shot.still?.prompt, baked: true },
  ]
  for (const rung of rungs) {
    const text = rung.text?.trim()
    if (text) return { text, baked: rung.baked }
  }
  return undefined
}

/**
 * The Directing prose — the draft or the plan, NEVER a take.
 *
 * A LEGACY take stores the SUBMITTED string with the camera-movement and look
 * clauses already folded into it, so exporting it beside `look` /
 * `cameraMotionId` would fold twice on the next render. And a scene with shots
 * has no scene-level prose at all: the shots ARE the directing prompt. (Same
 * `promptFormat: 2` follow-up as {@link framingPrompt}.)
 */
export function motionPrompt(
  shot: Shot,
  draft: StageDraft | undefined,
  hasShots: boolean,
): string | undefined {
  if (hasShots) return undefined
  return firstText(draft?.text, shot.plan?.motion?.prompt)
}

/**
 * A subject selection (readonly arrays) as the document writes it — fresh
 * arrays, never the still's or the plan's (mirrors `export.ts`'s `toLookMap`;
 * the document's own `FrameDocument.subject` is `Record<string, string |
 * string[]>`, a mutable shape {@link SubjectSelection}'s `ReadonlyArray`
 * doesn't satisfy).
 *
 * NORMALIZED THROUGH THE PLATFORM (R35): `normalizeSubjectFields` owns the
 * canonical shape — a single-id array collapses to a bare string, multi picks
 * stay arrays — and it is what `repairSubject` converges on at import. Without
 * it a still-authored export wrote `["x"]` where the same selection arriving
 * through the plan path wrote `"x"`, so `import(export(p))` differed by shape
 * depending on which rung the subject came from. Copy-on-write and idempotent
 * (its own doc), so running it here costs nothing.
 */
function toSubjectMap(subject: SubjectSelection): Record<string, string | string[]> {
  const normalized =
    (normalizeSubjectFields(subject as SubjectFields) as
      | Record<string, unknown>
      | undefined) ?? {}
  const out: Record<string, string | string[]> = {}
  for (const [field, value] of Object.entries(normalized)) {
    if (typeof value === "string") out[field] = value
    else if (Array.isArray(value)) out[field] = value.map(String)
  }
  return out
}

export function toFrameDocument(
  shot: Shot,
  settings: FrameSettings | undefined,
  draft: StageDraft | undefined,
): FrameDocument | undefined {
  // PER FIELD (§5): what the active result recorded, else what was planned.
  // Never "settings, else the plan" as a whole — `sceneSettings` returns a
  // non-empty stage object as soon as ANY of its inputs exists, so a
  // stage-level fallback would drop the plan's levers on a scene that has, say,
  // shots but no take.
  const plan = shot.plan?.frame
  // `shot.still?.provider` is the LEGACY rung, for the same collapsed still
  // {@link framingPrompt} ends on — a bare lone result keeps its model only at
  // still level. `buildStill` writes `""` when it had none; the spread drops it.
  const model = settings?.provider ?? plan?.provider ?? shot.still?.provider
  // The Subject builder's ids: the ACTIVE result's own (only when it is a
  // `promptFormat: 2` result — a legacy still never carried this channel), else
  // the plan's. NOT read through `settings` like the levers above — no result
  // records a copyable "subject lever" (`FrameSettings` has none), so this is
  // the one field `toFrameDocument` reads straight off the still (D9).
  //
  // AND the fmt2 rung is not AUTHORITATIVE-EMPTY here, unlike the Composer's
  // (where a fmt2 result with no subject means "the user cleared it", so the
  // editor shows nothing). An export is a portable RECORD, not the live editor
  // state: a scene whose plan says who is in it and whose last render happened
  // to carry no subject channel still reads as that person, and a file that
  // dropped it would lose authored intent nothing else in the document holds.
  const still = activeStill(shot)
  const subject =
    still?.promptFormat === 2 && still.subject
      ? subjectSelection(still.subject)
      : (plan?.subject ??
        // …and a RECIPE-ONLY scene's own framing recipe (R48), last: a bundle
        // that stripped the media kept the subject ids beside the look ids, and
        // this is the only rung that can still read them. Below the plan for
        // the same reason the plan is below the result — a recipe is what the
        // scene WAS made from, an authored plan is what it is meant to be.
        (shot.recipe?.framing?.subject
          ? subjectSelection(shot.recipe.framing.subject)
          : undefined))
  const aspectRatio = settings?.aspectRatio ?? plan?.aspectRatio
  const resolution = settings?.resolution ?? plan?.resolution
  const count = settings?.count ?? plan?.count
  const prompt = framingPrompt(shot, draft)
  const negativePrompt = firstText(
    settings?.negativePrompt,
    draft?.negative,
    plan?.negativePrompt,
  )
  // The manual reference strip is draft state ("what you see"); the settings
  // hold what the active result was made with, the plan what was authored.
  const referenceImageUrls = draft?.extraRefs?.length
    ? draft.extraRefs
    : (settings?.referenceImageUrls ?? plan?.referenceImageUrls)
  const doc: FrameDocument = {
    prompt: prompt?.text ?? "",
    // Only a BAKED rung is stamped — the flag is explicit-baked (`scene-plan`'s
    // `PlanFrame.promptBaked`), so raw prose simply carries no key and a
    // plan-less, result-less scene stays byte-identical to what it exported
    // before the flag existed.
    ...(prompt?.baked ? { promptBaked: true as const } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(model ? { model } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(referenceImageUrls?.length
      ? { referenceImageUrls: [...referenceImageUrls] }
      : {}),
    ...(subject && Object.keys(subject).length ? { subject: toSubjectMap(subject) } : {}),
  }
  // `prompt` is required whenever `frame` is present, so an empty one still
  // travels when the stage has levers worth carrying — but a stage with
  // NOTHING contributes no `frame` at all.
  return doc.prompt || Object.keys(doc).length > 1 ? doc : undefined
}

export function toMotionDocument(
  shot: Shot,
  settings: MotionSettings | undefined,
  draft: StageDraft | undefined,
  hasShots: boolean,
): MotionDocument | undefined {
  // PER FIELD, for the reason spelled out in `toFrameDocument`.
  const plan = shot.plan?.motion
  const model = settings?.provider ?? plan?.provider
  const aspectRatio = settings?.aspectRatio ?? plan?.aspectRatio
  const resolution = settings?.resolution ?? plan?.resolution
  const duration = settings?.duration ?? plan?.duration
  const prompt = motionPrompt(shot, draft, hasShots)
  const negativePrompt = firstText(
    settings?.negativePrompt,
    draft?.negative,
    plan?.negativePrompt,
  )
  // Read straight off the scene, like `beats` — never through {@link motionPrompt}.
  // A take's stored prompt has the scene paragraph folded INTO it, and
  // `motion.prompt` is dropped beside shots; this field is the description that
  // stands over them, so it needs its own key and its own source.
  const scenePrompt = firstText(shot.scenePrompt)
  const endTransition = toLeverNode(shot.endTransition)
  // PER FIELD, same rung order as the prose: the unsent draft, else the plan —
  // and only for a scene with NO shots (D5), the shots carry their own cues.
  const directions = hasShots
    ? undefined
    : draft?.directions?.length
      ? draft.directions
      : shot.plan?.motion?.directions
  const doc: MotionDocument = {
    ...(prompt ? { prompt } : {}),
    ...(scenePrompt ? { scenePrompt } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(model ? { model } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(duration !== undefined ? { duration } : {}),
    // A take records no camera movement, and `sceneSettings` strips it by
    // construction — the plan is the only place it lives.
    ...(plan?.cameraMotionId ? { cameraMotionId: plan.cameraMotionId } : {}),
    // Same rung: no result records the directing input mode either (D3) — the
    // plan is its only source, planned or already rendered alike. ON THE
    // RECORD (whole-branch review): that is the DECISION, not an omission. A
    // clip's stored take has no `input` seat to read, and the live editor's
    // picker is session state (R36 keeps the plan's seed out of the persisted
    // preference), so there is nothing else honest to export. Precedented by
    // `cameraMotionId` directly above, which travels the same one rung.
    ...(plan?.input ? { input: plan.input } : {}),
    // How the scene GOES OUT — read straight off the scene, like `scenePrompt`
    // above and like `beats`: it is authoring state the shot itself owns, not a
    // lever a take or a plan records. An `auto` pick carries no decision and is
    // dropped by `toLeverNode`, so a scene that never chose one exports
    // byte-identically.
    ...(endTransition ? { endTransition } : {}),
    // The three CHANNELS belong to the scene, not to a take.
    ...(shot.directingReferenceUrls?.length
      ? { referenceImageUrls: [...shot.directingReferenceUrls] }
      : {}),
    ...(shot.directingReferenceVideoUrls?.length
      ? { referenceVideoUrls: [...shot.directingReferenceVideoUrls] }
      : {}),
    ...(shot.directingReferenceAudioUrls?.length
      ? { referenceAudioUrls: [...shot.directingReferenceAudioUrls] }
      : {}),
    ...(directions?.length ? { audio: audioFromDirections(directions) } : {}),
  }
  return Object.keys(doc).length > 0 ? doc : undefined
}
