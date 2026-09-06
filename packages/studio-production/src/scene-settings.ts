import type { ConnectedReference } from "@nodaro/shared"

import {
  clipResults,
  stillResults,
  type LookSelectionMap,
  type Shot,
  type ShotBeat,
  type ShotTransition,
  type ShotClipResult,
  type ShotStillResult,
  type ShotCharacterFx,
} from "./shot"
import {
  beatsTotalSeconds,
  clampBeatSeconds,
  roundSeconds,
} from "./beats"
import type { CastLookMap } from "./cast"
import { planToSceneSettings } from "./scene-plan"
import { subjectSelection } from "./subject"
import type { SubjectSelection } from "./subject-pickers"
import type { VoiceDirection } from "./voice-direction"

/**
 * "Take the settings of scene 3."
 *
 * A production accumulates a lot of small decisions — a model, an aspect, a
 * quality tier, how many options to fan, a set of references, a scene look, a
 * shot breakdown — and re-entering them for every scene is the tedium this
 * answers. The copy reads them from where they already live: each generated
 * OPTION records what it was made with (prompt / model / refs, and now the
 * levers), and the scene itself owns its look, its reference channels and its
 * shots. Nothing new is written to describe a scene — a settings record kept
 * alongside would drift from what the scene actually is.
 *
 * SETTINGS, NOT PROSE. A copy never carries prompt text, a take's shot
 * descriptions, or a scene's rendered media: those are the work, not the setup.
 * Shots travel as their timing SKELETON (how many, how long, which picks) —
 * the part that is tedious to rebuild — with the writing left blank.
 *
 * Pure: every function reads and returns plain data, never the store's objects.
 */

/** What the FRAME stage can take from another scene's option. */
export interface FrameSettings {
  readonly provider?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  /** How many options that batch fanned out. */
  readonly count?: number
  readonly negativePrompt?: string
  /** Bound `@`-entity chips (identity), rebuilt as chips on apply. */
  readonly references?: ReadonlyArray<ConnectedReference>
  /** Flat manual reference images. */
  readonly referenceImageUrls?: ReadonlyArray<string>
  /**
   * The look IDS this option was projected from, and its prompt FORMAT — the
   * copy carries the ids, never the catalog wording, so pasting into a scene
   * and re-generating uses today's phrasing. A copy with no marker is LEGACY by
   * definition (its source's prompt had the clauses baked in).
   */
  readonly look?: LookSelectionMap
  readonly promptFormat?: 2
  /** …and the layer split behind those ids (D-A1) — carried so a copy does not
   *  quietly lose which surface each id came from. What a copy APPLIES is
   *  unchanged: the scene layer only (the film half of a copy is still
   *  unmodelled). */
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  /**
   * The Structured Subject builder's picks (plan-import-v2 D9). A settings
   * field like the look ids beside it: "who is in this scene" is exactly the
   * kind of standing decision "Copy settings from scene 3" exists to move, and
   * without it the copy quietly dropped the whole Subject panel while the
   * toast said it had been applied.
   *
   * Read from a `promptFormat: 2` option's own ids (the marker gate the
   * exporter's own subject rung uses — a legacy option never carried this
   * channel), and from a PLAN through `omitProse`, which keeps it the way it
   * keeps every other lever.
   */
  readonly subject?: SubjectSelection
}

/** What the MOTION stage can take from another scene's take. */
export interface MotionSettings {
  readonly provider?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly duration?: number
  readonly negativePrompt?: string
  readonly references?: ReadonlyArray<ConnectedReference>
  /** The `/` voice-direction chips. */
  readonly directions?: ReadonlyArray<VoiceDirection>
  /** The shot breakdown's SKELETON — timing + picks, no writing. */
  readonly beats?: ReadonlyArray<ShotBeat>
  // NO `scenePrompt`, and there is no skeleton spelling of it either: the
  // scene's generic prompt is ENTIRELY prose (what the clip is about, its mood,
  // what to avoid), so SETTINGS-NOT-PROSE leaves nothing behind to copy. A
  // shot's timing survives its writing; a paragraph does not.
  /** The scene's three reference channels (they belong to the scene, not a take). */
  readonly referenceImageUrls?: ReadonlyArray<string>
  readonly referenceVideoUrls?: ReadonlyArray<string>
  readonly referenceAudioUrls?: ReadonlyArray<string>
  /** How the scene GOES OUT — its way out is SETUP, not writing (the rule the
   *  per-beat {@link BeatSettings.transition} travels under), so it copies with
   *  the rest. Shot-owned, which is why `PlanMotion` omits it (D43). */
  readonly endTransition?: ShotTransition
  /** The take's look ids + prompt format (see {@link FrameSettings.look}). */
  readonly look?: LookSelectionMap
  readonly promptFormat?: 2
  /** The take's layer split (see {@link FrameSettings.filmLook}). */
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
}

/** One SHOT's own settings — its window, its picks and how it comes in, never
 *  its prose. A transition is SETUP, not writing, so it copies with the rest. */
export interface BeatSettings {
  readonly seconds: number
  readonly picks?: Readonly<Record<string, string>>
  readonly transition?: ShotTransition
  readonly characterFx?: ShotCharacterFx
}

/** A whole scene: both stages plus the look that spans them. */
export interface SceneSettings {
  readonly frame?: FrameSettings
  readonly motion?: MotionSettings
  readonly look?: LookSelectionMap
  /**
   * The scene's CAST LOOK pins (cast registry, D6f) — which view of each role
   * this scene uses. Setup in exactly the sense this file means it: it decides
   * which reference the scene sends, never what it says, and re-picking a look
   * per role across ten scenes is precisely the tedium a copy answers.
   *
   * Keyed by ROLE SLUG, so a pin for a role the target's cast doesn't have is
   * inert rather than wrong: the submit seam reads `castLook[key]` only where
   * `cast[key]` exists, so a stale key never resolves to anything.
   */
  readonly castLook?: CastLookMap
}

/**
 * What a copy asks for. The SCOPE is set by where it was started from — the
 * scene's own menu takes everything, the Frame and Motion entry points take
 * their stage only. `stillIndex` / `clipIndex` name a specific option or take
 * inside the source scene; absent means the one that scene currently reads as.
 */
export interface CopySettingsRequest {
  readonly scope: "scene" | "frame" | "motion" | "shot"
  readonly fromShotId: string
  readonly stillIndex?: number
  readonly clipIndex?: number
  /** `shot` scope: which shot of the source scene, and which shot it lands on. */
  readonly beatIndex?: number
  readonly toBeatId?: string
}

const nonEmpty = <T,>(a: ReadonlyArray<T> | undefined): ReadonlyArray<T> | undefined =>
  a && a.length > 0 ? [...a] : undefined

/** True when nothing would actually be applied — the caller offers no copy. */
export function isEmptySettings(s: SceneSettings | undefined): boolean {
  if (!s) return true
  return (
    Object.keys(s.frame ?? {}).length === 0 &&
    Object.keys(s.motion ?? {}).length === 0 &&
    Object.keys(s.look ?? {}).length === 0 &&
    Object.keys(s.castLook ?? {}).length === 0
  )
}

/**
 * ONE generated image → the settings that made it. This is the granularity the
 * user asked for ("from a specific frame"): each option in a scene's Frame
 * records its own model, levers and references, so they can differ within one
 * scene and a copy can name which one it means.
 */
export function frameSettingsFromResult(
  result: ShotStillResult | undefined,
): FrameSettings | undefined {
  if (!result) return undefined
  const s: FrameSettings = {
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.aspectRatio ? { aspectRatio: result.aspectRatio } : {}),
    ...(result.resolution ? { resolution: result.resolution } : {}),
    ...(result.count !== undefined ? { count: result.count } : {}),
    ...(result.negativePrompt ? { negativePrompt: result.negativePrompt } : {}),
    ...(nonEmpty(result.references) ? { references: [...result.references!] } : {}),
    ...(nonEmpty(result.referenceImageUrls)
      ? { referenceImageUrls: [...result.referenceImageUrls!] }
      : {}),
    // The ids this option was made with — an EXPLICIT field, like every other
    // one here: this file does not spread the result, so a new field it forgets
    // is simply not copied.
    ...(result.look && Object.keys(result.look).length
      ? { look: { ...result.look } }
      : {}),
    ...(result.promptFormat !== undefined
      ? { promptFormat: result.promptFormat }
      : {}),
    // …and the layer split behind them (D-A1) — its own explicit pair for the
    // same reason as `look` above.
    ...(result.filmLook && Object.keys(result.filmLook).length
      ? { filmLook: { ...result.filmLook } }
      : {}),
    ...(result.sceneLook && Object.keys(result.sceneLook).length
      ? { sceneLook: { ...result.sceneLook } }
      : {}),
    // The Subject ids, gated on the SAME format marker the exporter's own
    // subject rung uses: a legacy option never carried this channel, so its
    // absence there means "never recorded", not "was empty".
    ...(result.promptFormat === 2 && result.subject
      ? { subject: subjectSelection(result.subject) }
      : {}),
  }
  return Object.keys(s).length > 0 ? s : undefined
}

/**
 * The shot breakdown's SKELETON: how many shots, how long each runs, and the
 * picks attached to them — the structure that is tedious to rebuild. The prose
 * is deliberately dropped; copying another scene's writing would be copying the
 * work, and the ids are re-minted by the caller so the copy is a new list.
 */
export function beatSkeleton(
  beats: ReadonlyArray<ShotBeat> | undefined,
  mintId: (index: number) => string,
): ReadonlyArray<ShotBeat> | undefined {
  if (!beats || beats.length === 0) return undefined
  return beats.map((b, i) => ({
    id: mintId(i),
    seconds: b.seconds,
    text: "",
    ...(b.picks && Object.keys(b.picks).length > 0 ? { picks: { ...b.picks } } : {}),
    ...(b.transition ? { transition: { ...b.transition } } : {}),
    ...(b.characterFx ? { characterFx: { ...b.characterFx } } : {}),
  }))
}

/** ONE take → the settings it was rendered with, plus the scene's own reference
 *  channels (a take records the references it USED; the channels themselves
 *  belong to the scene, and an un-rendered scene still has them). */
export function motionSettingsFromResult(
  result: ShotClipResult | undefined,
  shot: Shot | undefined,
  mintBeatId: (index: number) => string,
): MotionSettings | undefined {
  const beats = beatSkeleton(result?.beats ?? shot?.beats, mintBeatId)
  const s: MotionSettings = {
    ...(result?.provider ? { provider: result.provider } : {}),
    ...(result?.aspectRatio ? { aspectRatio: result.aspectRatio } : {}),
    ...(result?.resolution ? { resolution: result.resolution } : {}),
    ...(result?.duration !== undefined ? { duration: result.duration } : {}),
    ...(result?.negativePrompt ? { negativePrompt: result.negativePrompt } : {}),
    ...(nonEmpty(result?.references) ? { references: [...result!.references!] } : {}),
    ...(nonEmpty(result?.directions) ? { directions: [...result!.directions!] } : {}),
    ...(beats ? { beats } : {}),
    // The channels: the take's own if it recorded them, else the scene's live
    // ones — a scene that has never rendered still has references worth taking.
    ...(nonEmpty(result?.referenceImageUrls ?? shot?.directingReferenceUrls)
      ? {
          referenceImageUrls: [
            ...(result?.referenceImageUrls ?? shot!.directingReferenceUrls!),
          ],
        }
      : {}),
    ...(nonEmpty(result?.referenceVideoUrls ?? shot?.directingReferenceVideoUrls)
      ? {
          referenceVideoUrls: [
            ...(result?.referenceVideoUrls ?? shot!.directingReferenceVideoUrls!),
          ],
        }
      : {}),
    ...(nonEmpty(result?.referenceAudioUrls ?? shot?.directingReferenceAudioUrls)
      ? {
          referenceAudioUrls: [
            ...(result?.referenceAudioUrls ?? shot!.directingReferenceAudioUrls!),
          ],
        }
      : {}),
    // The scene's way OUT, on the channels' own rung: the take's own when it
    // recorded one, else the scene's live pick (an un-rendered scene still has
    // one worth taking).
    ...(result?.endTransition ?? shot?.endTransition
      ? { endTransition: { ...(result?.endTransition ?? shot!.endTransition!) } }
      : {}),
    ...(result?.look && Object.keys(result.look).length
      ? { look: { ...result.look } }
      : {}),
    ...(result?.promptFormat !== undefined
      ? { promptFormat: result.promptFormat }
      : {}),
    // …and the take's layer split (D-A1), explicit like everything else here.
    ...(result?.filmLook && Object.keys(result.filmLook).length
      ? { filmLook: { ...result.filmLook } }
      : {}),
    ...(result?.sceneLook && Object.keys(result.sceneLook).length
      ? { sceneLook: { ...result.sceneLook } }
      : {}),
  }
  return Object.keys(s).length > 0 ? s : undefined
}

/**
 * A whole scene's settings — its ACTIVE option and ACTIVE take (what the scene
 * currently reads as) plus the scene look that spans both. Indexes let a caller
 * name a specific option/take instead ("scene 3, image 2").
 *
 * A scene that has rendered NOTHING still answers, from its PLAN: an imported
 * scene is worth copying before it is rendered, and the plan is its authored
 * intent (`lib/scene-plan`). The result always wins — what the scene actually
 * rendered with beats what it was planned with — and the plan's prose never
 * travels, because `planToSceneSettings` strips it first.
 */
export function sceneSettings(
  shot: Shot,
  mintBeatId: (index: number) => string,
  at?: { readonly stillIndex?: number; readonly clipIndex?: number },
): SceneSettings {
  const stills = shot.still ? stillResults(shot.still) : []
  const clips = shot.clip ? clipResults(shot.clip) : []
  const still = stills[at?.stillIndex ?? shot.still?.activeIndex ?? 0]
  const clip = clips[at?.clipIndex ?? shot.clip?.activeIndex ?? 0]
  const planned = shot.plan ? planToSceneSettings(shot.plan) : undefined
  const frame = frameSettingsFromResult(still) ?? planned?.frame
  const fromTake = motionSettingsFromResult(clip, shot, mintBeatId)
  // Motion is rarely wholly absent — the scene's own shots and reference
  // channels ride it even with no take — so the plan fills the LEVERS UNDER
  // what the scene already has, and only until a take records its own.
  const motion = clip ? fromTake : { ...planned?.motion, ...fromTake }
  // The scene look a copy carries is the one that PRODUCED the named option —
  // not the live `shot.look`, which the user may have re-picked since. Copying
  // "the settings of scene 3" after changing its look would otherwise hand over
  // ids that never made that image. Falls back to the live scene look for a
  // legacy option (and for a scene with no option at all) — and a PLAN never
  // competes here: a plan carries no look (`planToSceneSettings`), because a
  // scene's look lives on the scene itself for planned and rendered alike.
  const source = still?.look ?? shot.look
  const look =
    source && Object.keys(source).length > 0 ? { ...source } : undefined
  // The cast pins are the SCENE's, not an option's: a pin is a standing
  // decision about the scene ("in this scene she wears the coat"), the way the
  // start frame is, and no generated result records one.
  const castLook =
    shot.castLook && Object.keys(shot.castLook).length > 0
      ? { ...shot.castLook }
      : undefined
  return {
    ...(frame ? { frame } : {}),
    ...(motion && Object.keys(motion).length > 0 ? { motion } : {}),
    ...(look ? { look } : {}),
    ...(castLook ? { castLook } : {}),
  }
}

/**
 * Fit a copied shot breakdown into the budget of the model it will render on.
 * Scene 3's 30-second plan copied onto a 10-second model must not arrive as an
 * impossible total: shots are kept in order, each trimmed to the room its
 * siblings leave, and any that no longer fit at all are dropped rather than
 * kept at zero seconds. Returns the input untouched when it already fits, so
 * the common case copies exactly what was there.
 */
export function clampBeatsToBudget<T extends { seconds: number }>(
  beats: ReadonlyArray<T>,
  capSeconds: number,
  minSeconds: number,
): ReadonlyArray<T> {
  if (beatsTotalSeconds(beats) <= capSeconds) return beats
  const out: T[] = []
  let used = 0
  for (const b of beats) {
    const room = roundSeconds(capSeconds - used)
    if (room < minSeconds) break
    const seconds = Math.min(b.seconds, room)
    out.push({ ...b, seconds })
    used = roundSeconds(used + seconds)
  }
  return out
}

/**
 * Land ONE shot's copied settings on ONE shot of this scene.
 *
 * The window is bounded by the room its SIBLINGS leave, never by trimming the
 * scene: a 30-second shot copied onto the first of three takes the largest
 * window that still fits and leaves the other two exactly as they are. Running
 * the whole list through the budget instead would DROP the shots that no longer
 * fit — with their writing, and with no bin to recover it.
 *
 * Returns the new list and the window actually used, so the caller can say when
 * it had to be shortened.
 */
export function applyBeatSettings(
  beats: ReadonlyArray<ShotBeat>,
  toBeatId: string | undefined,
  settings: BeatSettings,
  durations: ReadonlyArray<number>,
): { readonly beats: ReadonlyArray<ShotBeat>; readonly seconds: number } {
  const id = toBeatId ?? beats[0]?.id
  const target = beats.find((b) => b.id === id)
  if (!target) return { beats, seconds: settings.seconds }
  // The copied length, made legal for THIS shot: as typed when it fits, else the
  // exact room its siblings leave (windows are tenths, so a 10.5s room lands
  // 10.5s — not the 10s a whole-second ladder would settle for).
  const seconds = clampBeatSeconds(settings.seconds, target, beats, durations)
  return {
    beats: beats.map((b) =>
      b.id === id
        ? {
            ...b,
            seconds,
            ...(settings.picks ? { picks: { ...settings.picks } } : {}),
            ...(settings.transition ? { transition: { ...settings.transition } } : {}),
            ...(settings.characterFx ? { characterFx: { ...settings.characterFx } } : {}),
          }
        : b,
    ),
    seconds,
  }
}

/** ONE shot's settings (the Motion granularity below a scene). */
export function beatSettings(beat: ShotBeat | undefined): BeatSettings | undefined {
  if (!beat) return undefined
  return {
    seconds: beat.seconds,
    ...(beat.picks && Object.keys(beat.picks).length > 0
      ? { picks: { ...beat.picks } }
      : {}),
    ...(beat.transition ? { transition: { ...beat.transition } } : {}),
    ...(beat.characterFx ? { characterFx: { ...beat.characterFx } } : {}),
  }
}

/**
 * A plain-language list of what a copy would actually bring — shown before it
 * happens, because "copy settings" is otherwise a promise with no receipt. The
 * `modelLabel` resolver turns a provider id into its menu name; unresolvable
 * ids fall back to the id so a copy is never described as nothing.
 */
export function describeSettings(
  s: SceneSettings,
  modelLabel: (id: string) => string,
): ReadonlyArray<string> {
  const out: string[] = []
  const stage = (
    label: string,
    v: FrameSettings | MotionSettings | undefined,
  ) => {
    if (!v) return
    const bits: string[] = []
    if (v.provider) bits.push(modelLabel(v.provider))
    if (v.aspectRatio) bits.push(v.aspectRatio)
    if (v.resolution) bits.push(v.resolution)
    if ("count" in v && v.count !== undefined && v.count > 1) {
      bits.push(`${v.count} options`)
    }
    if ("duration" in v && v.duration !== undefined) bits.push(`${v.duration}s`)
    if (bits.length > 0) out.push(`${label}: ${bits.join(" · ")}`)
    const refs =
      (v.references?.length ?? 0) +
      (v.referenceImageUrls?.length ?? 0) +
      ("referenceVideoUrls" in v ? (v.referenceVideoUrls?.length ?? 0) : 0) +
      ("referenceAudioUrls" in v ? (v.referenceAudioUrls?.length ?? 0) : 0)
    if (refs > 0) out.push(`${label}: ${refs} reference${refs === 1 ? "" : "s"}`)
    if (v.negativePrompt) out.push(`${label}: negative prompt`)
    if ("beats" in v && v.beats?.length) {
      // Transitions and effects travel with the skeleton, so the blurb has to
      // say so — "timing only" would be promising less than the copy brings.
      const withTransition = v.beats.filter((b) => b.transition).length
      const withFx = v.beats.filter((b) => b.characterFx).length
      const extras = [
        withTransition > 0
          ? `${withTransition} transition${withTransition === 1 ? "" : "s"}`
          : "",
        withFx > 0 ? `${withFx} effect${withFx === 1 ? "" : "s"}` : "",
      ].filter(Boolean)
      out.push(
        `Motion: ${v.beats.length} shot${v.beats.length === 1 ? "" : "s"}` +
          (extras.length > 0 ? ` (timing + ${extras.join(" + ")})` : " (timing only)"),
      )
    }
    if ("directions" in v && v.directions?.length) {
      out.push(`Motion: ${v.directions.length} direction chips`)
    }
    // The way OUT travels with the rest of the setup, so the receipt says so —
    // the rule the per-beat transitions above are named under.
    if ("endTransition" in v && v.endTransition) out.push(`${label}: end transition`)
  }
  stage("Frame", s.frame)
  stage("Motion", s.motion)
  const look = Object.keys(s.look ?? {}).length
  if (look > 0) out.push(`Scene look: ${look} pick${look === 1 ? "" : "s"}`)
  const pins = Object.keys(s.castLook ?? {}).length
  if (pins > 0) out.push(`Cast: ${pins} pinned look${pins === 1 ? "" : "s"}`)
  // Say when a stage brings its OWN ids — the scene-look line above describes
  // the scene, and a per-option look can differ from it.
  for (const [label, v] of [
    ["Frame", s.frame],
    ["Motion", s.motion],
  ] as const) {
    const n = Object.keys(v?.look ?? {}).length
    if (n > 0) out.push(`${label}: ${n} look pick${n === 1 ? "" : "s"}`)
  }
  return out
}
