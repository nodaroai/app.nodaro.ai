import type { TtsProvider } from "@nodaro/shared"

import type {
  FrameSettings,
  MotionSettings,
  SceneSettings,
} from "./scene-settings"
import { readReferences } from "./connected-references"
import { DIRECTING_MODES, type DirectingMode } from "./model-menu"
import type { ShotVoice } from "./shot"
import type { SubjectSelection } from "./subject-pickers"
// `VOICE_TYPES` rides the inline `type` modifier: it is referenced only from
// a `{@link}` now that `isVoiceType` reads the list, so imported type-only —
// a value import would be dead weight.
import {
  isTtsProvider,
  isVoiceType,
  type VOICE_TYPES,
} from "./tts-provider"
import { readDeliverySettings } from "./voice-delivery-settings"
import { readVoiceDirections } from "./voice-direction"

/**
 * A scene's PLAN — what it is set up to render, before it has rendered anything.
 *
 * An unrendered scene has nowhere durable to keep its framing prompt or its
 * frame / motion levers today: they live on a generated result's restore
 * context, or in the 7-day per-browser Composer draft (`lib/composer-draft`).
 * An IMPORTED scene has neither, so the plan is where imported intent lands
 * (see the import/export spec §5) — and once the scene renders, the plan STAYS:
 * a result records what it was made with, the plan records what the scene was
 * set up to be.
 *
 * The stage shapes are the copy-settings types PLUS the prose, so a lever added
 * to `FrameSettings` / `MotionSettings` flows into the plan's TYPE for free;
 * `readPlan` must still be taught to read it — the `Required<PlanFrame>` fixture
 * in the tests is what forces that.
 *
 * BROWSER-FREE: the format's renderers read these types under node. Nothing in
 * this module's closure may reach React or `import.meta.env`.
 */

/**
 * The RESULT-PROVENANCE half of the settings types, which a plan never has.
 * `look` + `promptFormat` record what an OPTION was projected from (spec
 * `2026-08-30-structured-prompt-assembly.md` D4b) — a plan has produced
 * nothing, so it has neither, and a scene's look already travels on the scene
 * itself (`shot.look`, mapped whole by the format). …and no layer split for the
 * same reason — a scene's look, film and scene alike, travels on the production
 * and the scene themselves. Omitted by the TYPE, the way `beats` and the three
 * reference channels already are, so the coverage guard's `Required<…>` fixtures
 * keep naming exactly what a plan carries.
 */
type ResultProvenance = "look" | "filmLook" | "sceneLook" | "promptFormat"

/**
 * The Framing stage's plan: {@link FrameSettings} + the prompt that goes with
 * it, and the one thing a plan DOES know about its own prose.
 *
 * `promptBaked` is the D4 classification the plan rung was missing. A plan
 * prompt is normally RAW — it is authored intent, exactly like a draft or a
 * storyboard breakdown, and D4's rule is that user prose never suppresses. But
 * the plan format's exporter accepts a stored LEGACY result prompt as its last
 * resort (`production-format/export.ts`'s `framingPrompt`), and that prose has
 * every look clause already folded into it. Exported beside the scene's `look`,
 * it would be folded a SECOND time on the next Generate — the exact double-fold
 * D4 exists to kill. So the only party that can tell (the exporter) STAMPS it,
 * and the Composer's suppression reads it for the plan rung the way it reads a
 * result's `promptFormat` marker for the result rung.
 *
 * EXPLICIT-BAKED, not the results' explicit-RAW polarity, and deliberately:
 * absent must mean "raw", because a hand-authored document has no marker and
 * gagging its look would repeat the bug the D4 comments warn about. It rides
 * `PlanFrame` rather than `ResultProvenance`'s `promptFormat` so the two
 * spellings never have to be reconciled — a plan still has no result provenance.
 */
export type PlanFrame = Omit<FrameSettings, ResultProvenance> & {
  readonly prompt?: string
  readonly promptBaked?: true
}

/**
 * The Directing stage's plan. It needs no `promptBaked` twin: `motionPrompt`
 * takes the draft or the plan and NEVER a take, so directing plan prose is raw
 * by construction.
 *
 * The shot breakdown (`beats`) is the scene's own — and so are the scene's
 * GENERIC PROMPT (`Shot.scenePrompt`) and its way OUT (`Shot.endTransition`,
 * D43), for the same reason: all three are authoring state the shot itself
 * owns, and a plan that kept a second copy would drift from the one the
 * composer writes (the plan FILE still carries `motion.endTransition`; import
 * lands it on the shot, export reads it back off the shot). The three
 * reference CHANNELS are likewise
 * the shot's own fields — so what is left is the levers, the directing prose,
 * the `/` voice-direction chips (they ride the plan since leg B — their
 * tokens sit in `prompt`), and the clip-level Camera Movement pick, which no
 * result records.
 */
export type PlanMotion = Omit<
  MotionSettings,
  | "beats"
  | "endTransition"
  | "referenceImageUrls"
  | "referenceVideoUrls"
  | "referenceAudioUrls"
  | ResultProvenance
> & {
  readonly prompt?: string
  readonly cameraMotionId?: string
  /**
   * Which input drives this scene's motion (plan-import-v2 D3) — not a
   * `MotionSettings` lever either (no result records it, exactly like
   * `cameraMotionId`), so it rides the plan's own additive half. The
   * Composer applies it to the Directing input picker (a SHELL prop,
   * `directingMode`/`onDirectingModeChange` — Composer itself owns no
   * directing-mode state), never through the settings-shaped lever seed.
   */
  readonly input?: DirectingMode
}

/**
 * A scene's voiceover plan (plan-import-v2 D4) — {@link ShotVoice} minus its
 * result `url` (media never rides a plan, the same rule {@link PlanFrame} and
 * {@link PlanMotion} already keep for a take's own url), plus `casting`: who
 * says the line, in prose, the way an imported document's `VoiceDocument`
 * carries it. Unlike the two stage plans it has no PROSE/SETTINGS split — a
 * voiceover has no "settings-only" copy use, so `omitProse`/`omitMedia`
 * (below) leave it untouched.
 */
export type PlanVoice = Omit<ShotVoice, "url"> & {
  readonly casting?: string
}

/** Both stages' authored intent, plus the scene's voiceover plan. Absent when
 *  the scene has none. */
export interface ScenePlan {
  readonly frame?: PlanFrame
  readonly motion?: PlanMotion
  readonly voice?: PlanVoice
}

/** True when a plan would carry nothing — the gate that keeps a plan-less save
 *  byte-identical (the mirror of `isEmptySettings`). `voice` needs no
 *  `Object.keys` check the way the two stages do: {@link readVoice} never
 *  returns an object without `text`, so its mere presence already means
 *  "carries something". */
export function isEmptyPlan(plan: ScenePlan | undefined): boolean {
  if (!plan) return true
  return (
    Object.keys(plan.frame ?? {}).length === 0 &&
    Object.keys(plan.motion ?? {}).length === 0 &&
    !plan.voice
  )
}

/** Narrow an unknown field to a non-empty string, else undefined. */
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

/** Narrow an unknown field to a finite number, else undefined. */
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** Narrow an unknown field to a non-empty `string[]`, else undefined. */
const strings = (value: unknown): ReadonlyArray<string> | undefined => {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0)
  return out.length ? out : undefined
}

/** A plan stage blob → a record, or undefined when it isn't one. */
const stage = (raw: unknown): Record<string, unknown> | undefined =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined

/** Narrow an unknown field to one of the four directing input modes, else
 *  undefined — the same drop-what-this-studio-doesn't-know discipline as the
 *  rest of this reader, applied to a fixed vocabulary rather than a string. */
const directingMode = (value: unknown): DirectingMode | undefined =>
  typeof value === "string" && (DIRECTING_MODES as ReadonlyArray<string>).includes(value)
    ? (value as DirectingMode)
    : undefined

/** {@link PlanFrame.subject} narrowed from an untrusted blob: a record of
 *  non-empty strings / non-empty `string[]` per field, everything else
 *  dropped — the same per-field narrowing `str`/`strings` give the rest of
 *  this reader, applied to each dimension field in turn. `undefined` when
 *  nothing survives, so an empty or malformed `subject` never persists as a
 *  key on the plan. */
function readSubject(raw: unknown): SubjectSelection | undefined {
  const s = stage(raw)
  if (!s) return undefined
  const out: Record<string, string | string[]> = {}
  for (const [field, value] of Object.entries(s)) {
    if (typeof value === "string" && value.length > 0) {
      out[field] = value
      continue
    }
    const arr = strings(value)
    if (arr) out[field] = [...arr]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function readFrame(raw: unknown): PlanFrame | undefined {
  const f = stage(raw)
  if (!f) return undefined
  const references = readReferences(f.references)
  const referenceImageUrls = strings(f.referenceImageUrls)
  const subject = readSubject(f.subject)
  const out: PlanFrame = {
    ...(str(f.prompt) ? { prompt: str(f.prompt) } : {}),
    // Only `true` narrows — the flag says "this prose is folded", so anything
    // else (absent, `false`, a string) means the safe answer, raw.
    ...(f.promptBaked === true ? { promptBaked: true as const } : {}),
    ...(str(f.negativePrompt) ? { negativePrompt: str(f.negativePrompt) } : {}),
    ...(str(f.provider) ? { provider: str(f.provider) } : {}),
    ...(str(f.aspectRatio) ? { aspectRatio: str(f.aspectRatio) } : {}),
    ...(str(f.resolution) ? { resolution: str(f.resolution) } : {}),
    ...(num(f.count) !== undefined ? { count: num(f.count) } : {}),
    ...(references ? { references } : {}),
    ...(referenceImageUrls ? { referenceImageUrls: [...referenceImageUrls] } : {}),
    ...(subject ? { subject } : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function readMotion(raw: unknown): PlanMotion | undefined {
  const m = stage(raw)
  if (!m) return undefined
  const references = readReferences(m.references)
  const directions = readVoiceDirections(m.directions)
  const out: PlanMotion = {
    ...(str(m.prompt) ? { prompt: str(m.prompt) } : {}),
    ...(str(m.negativePrompt) ? { negativePrompt: str(m.negativePrompt) } : {}),
    ...(str(m.provider) ? { provider: str(m.provider) } : {}),
    ...(str(m.aspectRatio) ? { aspectRatio: str(m.aspectRatio) } : {}),
    ...(str(m.resolution) ? { resolution: str(m.resolution) } : {}),
    ...(num(m.duration) !== undefined ? { duration: num(m.duration) } : {}),
    ...(str(m.cameraMotionId) ? { cameraMotionId: str(m.cameraMotionId) } : {}),
    ...(directingMode(m.input) ? { input: directingMode(m.input) } : {}),
    ...(references ? { references } : {}),
    ...(directions ? { directions } : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Narrow an unknown field to one of {@link VOICE_TYPES} — through the ONE
 *  guard both untrusted readers use (`isVoiceType`, `tts-provider.ts`), the
 *  same discipline `ttsProvider` below already keeps. */
const voiceType = (value: unknown): ShotVoice["voiceType"] =>
  isVoiceType(value) ? value : undefined

/** Narrow an unknown field to a known TTS provider id — through the ONE guard
 *  every reader of an untrusted `ttsProvider` uses (`isTtsProvider`,
 *  `tts-provider.ts`, fix round 1 R38-1), replacing this file's own
 *  hand-rolled `TTS_PROVIDERS` check. */
const ttsProvider = (value: unknown): TtsProvider | undefined =>
  isTtsProvider(value) ? value : undefined

/** Narrow an unknown field to a TRIMMED non-empty string — `text`/`casting`
 *  read through THIS, never bare `str` (R38-3): a canvas-edited whitespace-
 *  only value must not survive as a plan, mirroring `repairVoice`'s own
 *  `.trim()` on `text` — `readVoice`'s "no line, no plan" rule only holds if
 *  whitespace is trimmed BEFORE the emptiness check runs. */
const trimmed = (value: unknown): string | undefined => {
  const s = str(value)
  return s ? s.trim() || undefined : undefined
}

/** {@link PlanVoice} narrowed from an untrusted blob: `undefined` when there is
 *  no non-empty `text` to say — the same "no line, no plan" rule the format's
 *  own `repairVoice` enforces, mirrored here for a canvas-persisted plan. */
function readVoice(raw: unknown): PlanVoice | undefined {
  const v = stage(raw)
  if (!v) return undefined
  const text = trimmed(v.text)
  if (!text) return undefined
  const delivery = readDeliverySettings(v.delivery)
  const out: PlanVoice = {
    text,
    ...(trimmed(v.casting) ? { casting: trimmed(v.casting) } : {}),
    ...(str(v.voiceId) ? { voiceId: str(v.voiceId) } : {}),
    ...(voiceType(v.voiceType) ? { voiceType: voiceType(v.voiceType) } : {}),
    ...(ttsProvider(v.ttsProvider) ? { ttsProvider: ttsProvider(v.ttsProvider) } : {}),
    ...(str(v.model) ? { model: str(v.model) } : {}),
    ...(delivery ? { delivery } : {}),
  }
  return out
}

/**
 * Narrow a persisted `plan` blob to a {@link ScenePlan} — the parse-side twin of
 * `shot-graph`'s `readBeats` / `readLookMap`, and the same contract: the blob is
 * untrusted (a canvas-edited workflow, an imported file), so a field of the
 * wrong type is DROPPED rather than trusted, and hydration never throws.
 * Unknown keys drop too — a plan written by a newer studio opens in an older
 * one, minus what it can't understand. An empty result is `undefined`, so a
 * plan-less scene stays byte-identical on the next save.
 */
export function readPlan(raw: unknown): ScenePlan | undefined {
  if (!stage(raw)) return undefined
  const p = raw as Record<string, unknown>
  const frame = readFrame(p.frame)
  const motion = readMotion(p.motion)
  const voice = readVoice(p.voice)
  const plan: ScenePlan = {
    ...(frame ? { frame } : {}),
    ...(motion ? { motion } : {}),
    ...(voice ? { voice } : {}),
  }
  return isEmptyPlan(plan) ? undefined : plan
}

/**
 * Copy a plan stage without the fields a COPY must never carry: the prose
 * (copy-settings' SETTINGS, NOT PROSE invariant) and `cameraMotionId`, the
 * clip-level Camera Movement pick that is not a `MotionSettings` lever. A
 * SUBTRACTIVE copy on purpose — a lever added to the settings types must reach
 * a plan-sourced copy without an edit here.
 *
 * `promptBaked` goes with the prose it describes: a copy that carries no prompt
 * has nothing for the flag to classify. `input` (plan-import-v2 D3) is
 * prose-ADJACENT authoring the same way — a per-scene lever "copy settings
 * from scene N" never offers, exactly like `cameraMotionId`.
 */
function omitProse<T extends PlanFrame | PlanMotion>(
  planStage: T,
): Omit<T, "prompt" | "promptBaked" | "cameraMotionId" | "input"> {
  const out = { ...planStage } as Record<string, unknown>
  delete out.prompt
  delete out.promptBaked
  delete out.cameraMotionId
  delete out.input
  return out as Omit<T, "prompt" | "promptBaked" | "cameraMotionId" | "input">
}

/**
 * Copy a plan stage without the fields that carry MEDIA — the bound entity
 * chips (`references`, each a `ConnectedReference` with a url) and the manual
 * reference images (`referenceImageUrls`). SUBTRACTIVE for the same reason
 * {@link omitProse} is: a lever added to the settings types must reach a
 * media-free plan without an edit here.
 *
 * `referenceImageUrls` is deleted from BOTH stages even though `PlanMotion`
 * omits it by type — the delete is the invariant, not a mirror of today's type.
 */
function omitMedia<T extends PlanFrame | PlanMotion>(
  planStage: T,
): Omit<T, "references" | "referenceImageUrls"> {
  const out = { ...planStage } as Record<string, unknown>
  delete out.references
  delete out.referenceImageUrls
  return out as Omit<T, "references" | "referenceImageUrls">
}

/**
 * THE PLAN A "RECIPE ONLY" BUNDLE CARRIES (portability spec §3; closes the
 * assembly spec's OPEN interaction note).
 *
 * A recipe is the regeneration INPUTS with no media and no references — so the
 * question the note left open was whether authored intent is part of a recipe
 * at all. It is: a plan is prose and levers, which is exactly what a recipe is
 * made of, and the alternative was watching an imported, unrendered production
 * lose every prompt it was authored with the moment it was re-exported
 * recipe-only (while the same export with LINKED media kept them).
 *
 * The invariant survives by SUBTRACTION rather than by dropping the plan: the
 * only url-bearing fields a plan holds are `frame.references`,
 * `frame.referenceImageUrls` and `motion.references`, and {@link omitMedia}
 * removes them. What is left — the prose, `promptBaked`, the model/format
 * levers, `cameraMotionId` — has no url in it.
 *
 * Omit-when-empty cascades: a stage with nothing left is dropped, and a plan
 * with no stage left is `undefined`, so a plan-less (or reference-only) scene
 * exports byte-identically to before this existed.
 */
export function planWithoutMedia(
  plan: ScenePlan | undefined,
): ScenePlan | undefined {
  if (!plan) return undefined
  const frame = plan.frame ? omitMedia(plan.frame) : undefined
  const motion = plan.motion ? omitMedia(plan.motion) : undefined
  const out: ScenePlan = {
    ...(frame && Object.keys(frame).length > 0 ? { frame } : {}),
    ...(motion && Object.keys(motion).length > 0 ? { motion } : {}),
    // No url-bearing field to subtract — a voiceover carries no media of its
    // own (D8's rule for every stage), so a recipe keeps it whole. COPIED, not
    // passed through: the two stages above hand back fresh objects, and a
    // projection that aliased one stage of its input would be the only one.
    ...(plan.voice
      ? {
          voice: {
            ...plan.voice,
            ...(plan.voice.delivery ? { delivery: { ...plan.voice.delivery } } : {}),
          },
        }
      : {}),
  }
  return isEmptyPlan(out) ? undefined : out
}

/**
 * A plan as a COPY SOURCE — "take the settings of scene 3" on a scene that has
 * not rendered yet. The look is NOT here: it lives on the shot itself, and
 * `sceneSettings` reads it from there for planned and rendered scenes alike.
 */
export function planToSceneSettings(plan: ScenePlan): SceneSettings {
  const frame = plan.frame ? omitProse(plan.frame) : undefined
  const motion = plan.motion ? omitProse(plan.motion) : undefined
  return {
    ...(frame && Object.keys(frame).length > 0 ? { frame } : {}),
    ...(motion && Object.keys(motion).length > 0 ? { motion } : {}),
  }
}
