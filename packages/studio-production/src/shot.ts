/**
 * The Shot domain type — a production is an ordered `Shot[]`.
 *
 * A Shot owns a framed still (a `generate-image` node + its result) and an
 * optional animated clip (a `generate-video` node, wired AFTER the still). The
 * still/clip mirror the old single-`ActiveShot` semantics (nodeId + url) but are
 * split into structured sub-objects that ALSO carry `provider`/`prompt` so the
 * graph can be re-emitted into the Nodaro canvas on every save (single source of
 * truth) and so the timeline card can label the shot (model + duration).
 *
 * This file is the frozen contract every Studio cluster imports — keep it stable.
 * All fields are `readonly`: shots are copied, never mutated (store idiom).
 */
import type { ConnectedReference, TtsProvider } from "@nodaro/shared"
import type { SubjectFields } from "@nodaro/prompts"

import type { CastLookMap } from "./cast"
import type { VideoReferenceKind } from "./model-menu"
import type { MusicSelections } from "./music-options"
import type { ScenePlan } from "./scene-plan"
import type { VoiceDeliverySettings } from "./voice-delivery-settings"
import type { VoiceDirection } from "./voice-direction"

import type { ShotStill } from "./shot-still"
import type { ShotClip, ShotPendingClip } from "./shot-clip"

/**
 * The per-generation RESULT rows live in their own module; re-exported here so
 * `shot` stays the one import path for the Shot domain contract.
 */
export type { ShotStillResult, ShotClipResult } from "./shot-results"

/**
 * The framed STILL — its shape and the pure readers over it — lives in
 * `shot-still.ts`; re-exported here so `shot` stays the one import path.
 */
export type { ShotStill } from "./shot-still"
export {
  buildStill,
  productionImageRefs,
  productionStills,
  safeFileName,
  shotDisplayName,
  shotFileName,
  stillDisplayName,
  stillResults,
} from "./shot-still"

/**
 * The animated CLIP — its shape, its pure readers and the in-flight resume
 * marker — lives in `shot-clip.ts`; re-exported here so `shot` stays the
 * one import path.
 */
export type { ShotClip, ShotPendingClip } from "./shot-clip"
export {
  buildClip,
  clipResults,
  clipTakeDisplayName,
  EDITED_CLIP_PROVIDER,
  productionClips,
  productionVideoRefs,
} from "./shot-clip"

/**
 * The FRAMING half of a shot recipe — the inputs that would re-generate a still,
 * without any media. See {@link ShotRecipe}.
 */
export interface ShotRecipeFraming {
  readonly prompt: string
  readonly provider?: string
  readonly negativePrompt?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  /**
   * The prompt-format marker + the look ids this recipe regenerates from. A
   * recipe carries no urls and no references — ids are exactly what it IS for,
   * and they let a re-generate pick up today's catalog wording instead of the
   * phrasing frozen into an old prompt. Read from the ACTIVE result and gated on
   * THAT result's own marker (a sibling may be a different format). A recipe
   * with no marker is LEGACY by definition, so it suppresses on seed (D4).
   */
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  /**
   * …and the Structured Subject ids the same result was made with (R48). Under
   * the same `promptFormat` gate and there for the same reason as `look`: a
   * subject is ids, not media and not a binding, which is exactly what a recipe
   * is made of. Without it a recipe-only export of a framed scene dropped who
   * was in it, while the linked export of the same scene kept them. Held in the
   * PLATFORM's wire shape, like every other `subject` in this file.
   */
  readonly subject?: SubjectFields
}

/** The DIRECTING half of a shot recipe — re-animate inputs, no media. */
export interface ShotRecipeDirecting {
  readonly prompt: string
  readonly provider?: string
  readonly duration?: number
  readonly negativePrompt?: string
  readonly directions?: ReadonlyArray<VoiceDirection>
  /**
   * The prompt-format marker + the look ids this recipe regenerates from. A
   * recipe carries no urls and no references — ids are exactly what it IS for,
   * and they let a re-generate pick up today's catalog wording instead of the
   * phrasing frozen into an old prompt. Read from the ACTIVE result and gated on
   * THAT result's own marker (a sibling may be a different format). A recipe
   * with no marker is LEGACY by definition, so it suppresses on seed (D4).
   */
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
}

/**
 * A shot's RECIPE — its regeneration inputs without any generated media. This is
 * what a "recipe only" export carries (spec 2026-08-31 §3): the still/clip/voice
 * URLs are stripped, but the prompts, models, levers and voice line survive so an
 * import can regenerate the production. A recipe-only shot has NO `still`/`clip`
 * (it round-trips as a node-less placeholder entry — see shot-graph); the shell
 * seeds the composer from the active still's result, then the scene PLAN, then
 * this recipe — the same three rungs, in the same order, that `frame.subject`
 * uses on the way out (R48/R71): `prompt` and `promptFormat` are taken together
 * so D4 judges the prose it actually seeded. `look` and `provider` are NOT
 * seeded from here yet — they are store writes on selection rather than props,
 * and the provider would fight the app-sticky one; a landing
 * result CONSUMES its part (the store clears `framing` when a still lands,
 * `directing` when a clip lands, `voice` when a voiceover is set) so a stale
 * recipe never shadows real work. `voice` is a {@link ShotVoice} minus its
 * result `url`. No `references` here — an entity chip without its `url` is
 * rejected server-side, so recipe exports drop bindings entirely.
 */
export interface ShotRecipe {
  readonly framing?: ShotRecipeFraming
  readonly directing?: ShotRecipeDirecting
  readonly voice?: Omit<ShotVoice, "url">
}

/**
 * One shot in the production. `still` is undefined for a freshly-added empty
 * shot (a placeholder card until Framing completes). `clip` requires a `still`
 * (except a references-only clip — see {@link directingReferenceUrls}). `id` is a stable
 * client id (`crypto.randomUUID()`) that survives still/clip re-generation — it
 * is the timeline identity, NOT a node id.
 */
export interface Shot {
  readonly id: string
  /**
   * User-given shot name (the ⋯ → Rename action). Absent until renamed; the
   * timeline card then falls back to a derived label ("Shot N" / model · Ns).
   */
  readonly name?: string
  /**
   * The folder this shot belongs to ({@link ProductionFolder} id), or absent for
   * the default "Untitled folder" group. Set via the ⋯ → Move to Folder action.
   */
  readonly folderId?: string
  readonly still?: ShotStill
  readonly clip?: ShotClip
  readonly voice?: ShotVoice
  /**
   * Start/end-frame keyframes for the Directing interpolation (the editor's two
   * frame slots, shown below the preview, each settable + clearable). Both are
   * OPTIONAL studio-layer overrides: the animate runs from `startFrame ?? the
   * active still` toward `endFrame`. They survive a still re-frame (like
   * {@link ShotVoice}) and persist in the `settings.studio` index, NOT as canvas
   * nodes. `endFrame` is forwarded only when the video model supports end-frame.
   */
  readonly startFrame?: string
  readonly endFrame?: string
  /**
   * Reference image URLs for reference-media-capable video models (Seedance 2,
   * Veo, …), up to the model's catalog cap. Sent ALONGSIDE the start frame (they
   * guide the gen) and drop only the `endFrame` — the platform constraint.
   * Survives a still re-frame like {@link startFrame}; persisted in the
   * `settings.studio` index, NOT as canvas nodes.
   */
  readonly directingReferenceUrls?: ReadonlyArray<string>
  /**
   * Reference VIDEO URLs for references mode (video-reference-capable models —
   * `videoReferenceLimits(provider).videos`). Sibling of
   * {@link directingReferenceUrls}; same persistence + re-frame survival. Read by
   * media kind via {@link directingRefField}.
   */
  readonly directingReferenceVideoUrls?: ReadonlyArray<string>
  /**
   * Reference AUDIO URLs for references mode (audio-reference-capable models —
   * `videoReferenceLimits(provider).audio`). Sibling of
   * {@link directingReferenceUrls}; same persistence + re-frame survival.
   */
  readonly directingReferenceAudioUrls?: ReadonlyArray<string>
  /**
   * The IN-FLIGHT animate jobs (one marker per concurrent render), persisted so
   * the (minutes-long) renders survive a page reload — see
   * {@link ShotPendingClip}. A marker is appended at submit and removed (by
   * jobId) on its completion/failure. Absent when no animate is pending.
   */
  readonly pendingClips?: ReadonlyArray<ShotPendingClip>
  /**
   * The scene's timed MOTION BEATS (editor-v2 "Scene → Shots", spec §5): the
   * one directing prompt split into ordered time windows, each with its own
   * prose + optional label + per-beat cinematic picks. AUTHORING state only —
   * at animate the beats fold into ONE plain prompt (`0-2s — …`), the model
   * sees a normal prompt, and the generated clip stores that folded string
   * like any prompt. Clip-restore restores the folded STRING; it never
   * rebuilds beats. Persisted in the `settings.studio` entry (no canvas node).
   */
  readonly beats?: ReadonlyArray<ShotBeat>
  /**
   * The scene's GENERIC PROMPT — what the whole clip is about (story, mood,
   * things to avoid), authored above shot 1 and standing over every shot in
   * it. AUTHORING state only, like {@link beats}: at animate it is PREPENDED
   * to the directing body as its own paragraph (`<scenePrompt>\n\n<body>`) and
   * the model sees one plain prompt. ABSENT when empty (never `""`), so a
   * scene without one persists byte-identically. Persisted in the
   * `settings.studio` entry (no canvas node).
   */
  readonly scenePrompt?: string
  /**
   * How this scene GOES OUT — the transition its last frames run, so the clip
   * ends ready to meet the next scene's own opening.
   *
   * SCENE-LEVEL, not on the last beat: it is a property of the rendered clip's
   * final frames, and a split / merge / reorder changes which shot is last —
   * a per-shot seat would silently move the choice to another boundary. It is
   * NOT the next scene's opening seen from the other side either: the
   * platform's catalog has a `position: end` row of its own, so scene N fading
   * out and scene N+1 fading in are two real, independent renders.
   *
   * Same shape and same rules as a beat's own {@link ShotBeat.transition} — a
   * catalog ID plus the three lever ids, absent when nothing is chosen.
   * AUTHORING state like {@link beats}: it folds into the directing prompt at
   * animate (`lib/beats`' `withEndTransition`) and is persisted in the
   * `settings.studio` entry (no canvas node).
   */
  readonly endTransition?: ShotTransition
  /**
   * This scene's SCENE LOOK — the cinematic dimensions that apply to every
   * shot in it (lighting, atmosphere, time of day, weather, mood…). The
   * FILM layer above it is production-level ({@link ProductionFilmLook});
   * a beat's own `picks` are the layer below. Persisted in the
   * `settings.studio` entry, like {@link beats} — a picked look must
   * survive a reload, not reset to Default.
   */
  readonly look?: LookSelectionMap
  /**
   * This scene's authored PLAN — its framing / motion prose and levers BEFORE
   * it has rendered anything (see lib/scene-plan). An imported scene lands
   * here; a rendered one KEEPS it, because a result records what it was made
   * with and the plan records what the scene was set up to be. Persisted in
   * the `settings.studio` entry like {@link beats}; absent when unused.
   */
  readonly plan?: ScenePlan
  /**
   * The shot's regeneration RECIPE — present only on shots imported from a
   * "recipe only" bundle (no media yet). Consumed as results land; see
   * {@link ShotRecipe}. Persisted in the `settings.studio` entry like
   * {@link beats}/{@link look}.
   *
   * Sibling of {@link plan}, not a replacement: a recipe re-renders a shot the
   * bundle stripped of media, a plan records what the scene was authored to be.
   */
  readonly recipe?: ShotRecipe
  /**
   * This scene's CAST LOOK OVERLAY — which view/outfit of the one true actor
   * THIS scene uses, keyed by role slug (spec 2026-08-31-project-cast-registry,
   * D6f). The start-frame mental model: sticky per scene, shown on the chip as
   * a pinned-look badge, and falling back to the cast row's `defaultLook` when
   * absent — so changing a cast default moves only the UN-pinned scenes.
   *
   * Identity is NOT overridable here (D6a): the overlay picks the look, never
   * who the name means. A recast drops every pin (they are views of the actor
   * that left) and says how many.
   *
   * Persisted in the `settings.studio` entry like {@link look}; absent when the
   * scene pins nothing.
   */
  readonly castLook?: CastLookMap
}

/** A cinematic selection: `pickerKey → catalog id(s)`. Structural on purpose
 *  so `lib/shot` stays free of the picker registry. */
export type LookSelectionMap = Readonly<
  Record<string, string | ReadonlyArray<string>>
>

/** The production-wide FILM look (camera / colour / art style / period). */
export type ProductionFilmLook = LookSelectionMap

/** One timed motion beat of a scene (editor-v2; see {@link Shot.beats}). */
export interface ShotBeat {
  readonly id: string
  /** Window length in seconds (the spec's 2s–10s selector). */
  readonly seconds: number
  /** Optional beat label (the pink chip: "Beginning of the suction"). */
  readonly label?: string
  /** The beat's motion prose. */
  readonly text: string
  /**
   * Per-beat cinematic picks (`pickerKey → catalog id`) — folded as hint
   * clauses into THIS beat's window at animate (see the composer fold).
   */
  readonly picks?: Readonly<Record<string, string>>
  /**
   * The `@`-entity chips bound in THIS beat's prose. Owned by the beat (not
   * a shadow map beside it) so deleting the beat drops them, a reload
   * rebuilds the chips instead of degrading to flat text, and the scene's
   * submitted reference set is simply their union.
   */
  readonly references?: ReadonlyArray<ConnectedReference>
  /**
   * How this shot COMES IN — the transition node that sits above it.
   *
   * On the beat rather than beside it, for the same reason its references are:
   * deleting the shot drops its transition, reordering carries it along, and
   * the persisted graph needs no second map to keep in step.
   *
   * `id` is a `transitionId` catalog ID, never a label: the catalog carries a
   * separate prompt TERM for 25 of its 82 rows ("Iris" renders as "iris wipe",
   * "Roll" as "camera roll transition"), so storing what the tile said would
   * send the model a different instruction than the scene-level picker does for
   * the very same choice — and would break the stored pick on any label rename.
   * See `lib/transition.ts` for the three levers and why they are app-owned.
   */
  readonly transition?: ShotTransition
  /**
   * The CHARACTER FX node on this shot — an effect on the subject with the
   * platform node's three timing levers. On the beat for the same reasons its
   * transition is: deleting the shot drops it, reordering carries it, copying
   * a shot's settings brings it. `id` is a `character-fx` catalog id; the
   * levers are the ids of the catalog's own timing DIMENSIONS (`start`,
   * `short`, `crazy`), never labels — see `lib/character-fx.ts`.
   */
  readonly characterFx?: ShotCharacterFx
  /**
   * The `/` audio cues placed in THIS shot's prose — a speech line, a sound
   * effect, ambience, music (plan-import-v2 D5). On the beat for the same
   * reasons its references are: deleting the shot drops them, reordering
   * carries them, and the persisted graph needs no second map. The neutral
   * `[text]` tokens stay in `text`; the submit renders them per model.
   */
  readonly directions?: ReadonlyArray<VoiceDirection>
}

/** A shot's Character FX node. Absent — or the catalog's own `auto` row —
 *  means no effect; a lever without an effect is nothing (dropped at load). */
export interface ShotCharacterFx {
  /** The chosen effect's catalog id, e.g. `werewolf`. */
  readonly id?: string
  /** Timing scale ids, from the catalog's `dimensions` rows. */
  readonly position?: string
  readonly duration?: string
  readonly intensity?: string
}

/** A shot's incoming transition. Absent — or `Auto` throughout — means the
 *  model decides, which is why every field is optional rather than defaulted. */
export interface ShotTransition {
  /** The chosen transition's catalog id, e.g. `cross-dissolve`. */
  readonly id?: string
  /** Lever ids from the catalog's `dimensions` rows (`transitionDimensions()`):
   *  position `auto` · `start` · `middle` · `end` · `full`. */
  readonly position?: string
  /** duration `auto` · `instant` · `short` · `medium` · `long`. */
  readonly duration?: string
  /** intensity `auto` · `subtle` · `natural` · `dynamic` · `crazy`. */
  readonly intensity?: string
}

/** The directing-reference media kinds, in display order (images, videos, audio). */
export const VIDEO_REFERENCE_KINDS = ["images", "videos", "audio"] as const satisfies
  readonly VideoReferenceKind[]

/**
 * The {@link Shot} field that stores a given reference media kind's URLs — the
 * SINGLE mapping from a catalog {@link VideoReferenceKind} to its sibling field,
 * so the store + Studio never hardcode the per-kind field name (and can't drift).
 */
export function directingRefField(
  kind: VideoReferenceKind,
): "directingReferenceUrls" | "directingReferenceVideoUrls" | "directingReferenceAudioUrls" {
  switch (kind) {
    case "videos":
      return "directingReferenceVideoUrls"
    case "audio":
      return "directingReferenceAudioUrls"
    default:
      return "directingReferenceUrls"
  }
}

/**
 * Whether a shot carries directing references of ANY media kind (the
 * references-mode "has visual input" predicate). The shared check behind the
 * Animate gate, the submit's references-mode branch, and the clip-result capture
 * — so a video-/audio-only references clip is treated identically to an image one.
 */
export function hasDirectingReferences(shot: Shot | undefined): boolean {
  if (!shot) return false
  return (
    (shot.directingReferenceUrls?.length ?? 0) > 0 ||
    (shot.directingReferenceVideoUrls?.length ?? 0) > 0 ||
    (shot.directingReferenceAudioUrls?.length ?? 0) > 0
  )
}

/**
 * A named timeline folder for grouping shots (the timeline's shot folders). A
 * production-level list in `settings.studio`; shots reference it by `folderId`.
 * Order in the list is the render order; the default unfiled group has no entry.
 */
export interface ProductionFolder {
  readonly id: string
  readonly name: string
}

/**
 * A per-shot voiceover — a `text-to-speech` (ElevenLabs) result. Audio is a
 * studio-LAYER concern, NOT a canvas graph node (see shot-graph.ts: audio lives
 * in `settings.studio`, not in `workflow.nodes[]`), so a voice carries only its
 * result url + the inputs that made it — no `nodeId`. Muxed onto the shot's clip
 * at export via `merge-video-audio`. Independent of the frame: a spoken line
 * survives a still re-generation.
 */
export interface ShotVoice {
  /** Result audio URL (R2) from `text-to-speech`. */
  readonly url: string
  /** The spoken line (drives the editor field + the card's voiceover badge). */
  readonly text: string
  /** Selected voice id (undefined = the TTS default voice). */
  readonly voiceId?: string
  /**
   * The voice's KIND — premade voices are addressed by name, library/custom
   * voices by id at text-to-speech time. Optional/absent for premade or legacy
   * voices predating the field; persisted so TTS can later resolve the voice.
   * (Mirrors {@link EntityVoice.voiceType} on the character side.)
   */
  readonly voiceType?: "premade" | "library" | "custom"
  /**
   * The TTS provider the voice is verified on (the Voice Library's
   * `recommendedProvider`, captured at selection). Sent as the `provider` on
   * generate/regenerate so the voice renders on a model it's verified for
   * (preview fidelity). Absent ⇒ the provider default.
   */
  readonly ttsProvider?: TtsProvider
  /** TTS model id used (`eleven_v3` / `eleven_turbo_v2_5` / `eleven_multilingual_v2`). */
  readonly model?: string
  /**
   * Tuned delivery levers this voiceover was generated with (PRUNED — absent
   * when everything sat at defaults), so a regenerate restores the same
   * speed/stability/style the user dialed in. Serialized whole via the
   * `{ ...shot.voice }` spread in shot-graph.
   */
  readonly delivery?: VoiceDeliverySettings
}

/**
 * The production-level soundtrack — a `generate-music` (Suno / Minimax) result.
 * Like {@link ShotVoice} it's a studio-layer object stored in `settings.studio`
 * (NOT a graph node); muxed OVER the combined export via `merge-video-audio`.
 * One per production.
 */
export interface ProductionMusic {
  /** Result audio URL (R2) from `generate-music`. */
  readonly url: string
  /** The music prompt (drives the panel + relabel). */
  readonly prompt: string
  /** Requested length in seconds (1–30), if specified. */
  readonly duration?: number
  /** Music provider id used (e.g. `minimax`, `suno-v5`). */
  readonly provider?: string
}

/**
 * The soundtrack PLAN — a landed plan's `music`, seeding {@link SoundPanel}
 * BEFORE the user generates a track (plan-import-v2 D5). Kept beside a
 * generated {@link ProductionMusic}, like {@link import("./scene-plan").ScenePlan}
 * is kept beside a shot's own results: a plan is authoring intent, a result is
 * what rendered, and neither one erases the other on its way in.
 */
export interface PlanMusic {
  readonly prompt: string
  readonly duration?: number
  readonly selections?: MusicSelections
}

/** Deep copy for the serialize path — the persisted blob never aliases state
 *  (mirrors {@link import("./cast").copyCast}'s own no-aliasing rule). */
export function copyMusicPlan(plan: PlanMusic): PlanMusic {
  return {
    prompt: plan.prompt,
    ...(plan.duration !== undefined ? { duration: plan.duration } : {}),
    ...(plan.selections
      ? {
          selections: {
            ...plan.selections,
            instruments: [...plan.selections.instruments],
          },
        }
      : {}),
  }
}

/**
 * ONE saved whole-production FreeCut edit — a CUT VERSION. Every production
 * export from FreeCut APPENDS one (never overwrites), so the user keeps a
 * version history ("Cut A / Cut B / …" — renameable). Like
 * {@link ProductionMusic} they're studio-layer objects (NOT graph nodes),
 * persisted under `settings.studio.cuts` in append order (newest LAST).
 * Exactly one cut may carry `final: true` — a movable TAG, not a fixed slot.
 */
export interface ProductionCut {
  /** Stable client id (`crypto.randomUUID()`). */
  readonly id: string
  /** Display name — auto "Cut A/B/C…" at save; renameable. */
  readonly name: string
  /** The rendered cut's uploaded URL (R2). */
  readonly url: string
  /** The FreeCut project JSON's URL — restores the layers/timeline when this
   *  cut is reopened (absent when the project upload failed; the cut itself
   *  is still saved). */
  readonly freecutProjectUrl?: string
  /** The cut's length in seconds (probed from the exported file), if known. */
  readonly duration?: number
  /** How many shots the production had at export time (display). */
  readonly shotsCount?: number
  /** ISO timestamp of the export (display + provenance). */
  readonly exportedAt: string
  /** The movable FINAL tag — at most one cut carries it. */
  readonly final?: true
}

/** Auto-name for the next cut: "Cut A", "Cut B", … then "Cut 27" past Z. */
export function nextCutName(existingCount: number): string {
  return existingCount < 26
    ? `Cut ${String.fromCharCode(65 + existingCount)}`
    : `Cut ${existingCount + 1}`
}

/** Format a cut duration as FreeCut-style "1m 48s" (plain "48s" under a minute). */
export function formatCutDuration(seconds: number): string {
  const s = Math.round(seconds)
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`
}

/** A new, empty shot (no still yet) — used by `addShot` / the "+ New Shot" card. */
export function createEmptyShot(): Shot {
  return { id: crypto.randomUUID() }
}
