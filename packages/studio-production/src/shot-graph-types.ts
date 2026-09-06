/**
 * The persisted SHAPES of a production — `settings.studio` (the timeline index)
 * and what `serializeProduction` emits. Types only: the writers live in
 * `shot-graph-write.ts`, the narrowers in the `shot-graph-read*` modules, and
 * `shot-graph.ts` re-exports every name here so `shot-graph` stays the one
 * import path for the graph <-> shots contract.
 */
import type { GenericNode, GenericEdge } from "@nodaro/shared"

import type { Cast, CastLookMap } from "./cast"
import type { ScenePlan } from "./scene-plan"
import type { TrashedItem } from "./trash"
import type {
  LookSelectionMap,
  PlanMusic,
  ProductionCut,
  ProductionFilmLook,
  ProductionFolder,
  ProductionMusic,
  ShotBeat,
  ShotPendingClip,
  ShotRecipe,
  ShotTransition,
  ShotVoice,
} from "./shot"

// ── settings.studio shapes ──────────────────────────────────────────────────

/**
 * Persisted per-shot index entry. Node ids point INTO `workflow.nodes[]`.
 * `voice` is an inline studio-layer object (NOT a node ref) — audio has no
 * canvas node, so the per-shot voiceover is persisted directly in the index.
 */
export interface StudioShotEntryV2 {
  readonly id: string
  /** User-given shot name (⋯ → Rename); absent until renamed. */
  readonly name?: string
  /** Folder this shot belongs to (⋯ → Move to Folder); absent = default group. */
  readonly folderId?: string
  readonly imageNodeId?: string
  readonly videoNodeId?: string
  /** Denormalized labels for the timeline card (model + duration), cheap to read. */
  readonly stillProvider?: string
  readonly clipProvider?: string
  readonly clipDuration?: number
  /** Per-shot voiceover (studio-layer; muxed onto the clip at export). */
  readonly voice?: ShotVoice
  /**
   * Start / end-frame interpolation keyframe URLs — studio-layer INPUTS (no
   * canvas node), threaded onto `generate-video` when animating. Persisted here
   * (like `voice`) so the keyframes survive reload; absent until set.
   */
  readonly startFrameUrl?: string
  readonly endFrameUrl?: string
  /**
   * Directing reference URLs (reference-media video models, e.g. Seedance 2) —
   * studio-layer per-shot inputs, persisted like the frame keyframes. Absent when
   * the shot uses none, so keyframe-only shots stay byte-identical.
   */
  readonly directingReferenceUrls?: ReadonlyArray<string>
  readonly directingReferenceVideoUrls?: ReadonlyArray<string>
  readonly directingReferenceAudioUrls?: ReadonlyArray<string>
  /**
   * The in-flight animate jobs (studio-layer markers, no node; one per
   * concurrent render) — persisted so long renders resume on reload. Absent
   * when no animate is pending. (Pre-concurrent-markers saves carried a single
   * `pendingClip` instead — deliberately NOT on this type, so serialize can't
   * write it; {@link readPendingClips} migrates it on parse.)
   */
  readonly pendingClips?: ReadonlyArray<ShotPendingClip>
  /**
   * The scene's timed motion beats (editor-v2 authoring state; folded into ONE
   * plain prompt at animate — see Shot.beats). Absent when unused, so
   * beat-less saves stay byte-identical.
   */
  readonly beats?: ReadonlyArray<ShotBeat>
  /** The scene's GENERIC PROMPT (see Shot.scenePrompt) — prepended to the
   *  directing body at animate. Absent when empty, so a scene without one
   *  stays byte-identical. */
  readonly scenePrompt?: string
  /** How this scene GOES OUT (see Shot.endTransition) — the transition its last
   *  frames run. Absent when nothing is chosen, so a scene without one stays
   *  byte-identical. */
  readonly endTransition?: ShotTransition
  /** This scene's SCENE LOOK selection (see Shot.look). Absent when unset,
   *  so a look-less scene stays byte-identical. */
  readonly look?: LookSelectionMap
  /** This scene's CAST LOOK OVERLAY (see Shot.castLook) — role slug → the view
   *  this scene pins. Absent when the scene pins nothing, so an un-pinned scene
   *  round-trips byte-identically. */
  readonly castLook?: CastLookMap
  /** This scene's authored PLAN (see Shot.plan) — its pre-result framing /
   *  motion setup. Absent when empty, for the same byte-identity reason. */
  readonly plan?: ScenePlan
  /**
   * The shot's regeneration RECIPE (recipe-only imports — see Shot.recipe).
   * Present ONLY on a node-less placeholder entry: a recipe shot has no
   * still/clip, so serialize writes no node ids for it (a claimed-but-missing
   * node id would drop the entry on parse). Absent everywhere else, so
   * ordinary saves stay byte-identical.
   */
  readonly recipe?: ShotRecipe
}

/**
 * Storyboard authoring state — persisted so the Storyboard tab survives a reload:
 * the film brief + length, whether the tab is open, and the per-shot summaries /
 * detailed breakdowns / lengths (keyed by shot id; an orphaned key from a deleted
 * shot is harmless). All fields optional — absent for productions that never used
 * the storyboard, keeping the common shape minimal.
 */
export interface StoryboardSettings {
  readonly on?: boolean
  readonly brief?: string
  readonly filmLength?: number
  readonly scripts?: Record<string, string>
  readonly breakdowns?: Record<string, string>
  readonly seconds?: Record<string, number>
}

/**
 * settings.studio v3 — the timeline index. `version` gates migration.
 *
 * v3 adds the audio layer (per-entry `voice` + production-level `music`). Audio
 * lives HERE, not in `workflow.nodes[]`, because the canvas graph stays minimal
 * (image/video only — CLAUDE.md allowlist) and audio is a studio-export concern.
 * The reader accepts v2 (no audio) OR v3; serialize always writes v3.
 */
export interface StudioSettingsV3 {
  readonly version: 3
  readonly shots: ReadonlyArray<StudioShotEntryV2>
  readonly selectedShotId?: string
  /**
   * Back-compat / canvas-consumer convenience: flattened node ids in shot order
   * (still then its clip, per shot). Mirrors today's `shotOrder` semantics so any
   * existing reader keeps working. DERIVED on serialize; never the source of truth.
   */
  readonly shotOrder: ReadonlyArray<string>
  /** Production-level soundtrack (muxed OVER the export). Absent until added. */
  readonly music?: ProductionMusic
  /**
   * The soundtrack PLAN — prompt + pickers before a track exists; kept after
   * one does, like `ScenePlan` is kept beside a shot's own results
   * (plan-import-v2 D5). Seeds `SoundPanel` (the switch, the prompt, the
   * pickers) so a landed plan is visible before the user ever presses
   * Generate; `useMusic`'s `generate` never reads it.
   *
   * "Kept after one does" earns its keep at EXPORT (R44): a rendered
   * `ProductionMusic` has no `selections` field, so the plan beside it is the
   * only place the genre/mood/instruments still exist — `toMusicDocument`
   * merges the two rather than letting a Generate silently cost the exported
   * file its own pickers.
   */
  readonly musicPlan?: PlanMusic
  /**
   * Opt-in public share flag. When `true`, the production is readable by anyone
   * with the link via the unauthenticated `GET /v1/public/workflows/:id` (the
   * studio's `/example/:id` viewer). Set by "Copy share link"; absent = private.
   */
  readonly shared?: boolean
  /**
   * SOFT-HIDE flag (`archiveProduction`) — the dashboard filters the row out.
   * Absent = visible; there is no "unarchive", so an archived production is
   * reachable by URL alone, which is why every write has to carry it.
   *
   * It lives HERE, in the index the serializer owns, because a full-graph save
   * REPLACES `settings.studio` whole: a flag the serializer doesn't know is
   * erased by the first edit after archiving (the editor's autosave, a Library
   * import). It is a DASHBOARD-LOCAL fact, not a portable one — nothing that
   * creates a NEW production carries it (see production-bundle-import.test.ts's
   * `PortableProductionFields` omit list, and `cloneProduction`'s strip).
   */
  readonly archived?: boolean
  /**
   * Named timeline folders (the shot folders), in render order. Shots
   * reference one by `folderId`; the default unfiled group has no entry here.
   * Absent until the first folder is created (keeps the no-folder shape minimal).
   */
  readonly folders?: ReadonlyArray<ProductionFolder>
  /** Storyboard authoring state (the Storyboard tab) — persisted across reloads. */
  readonly storyboard?: StoryboardSettings
  /**
   * The saved whole-production FreeCut CUT VERSIONS, append order (newest
   * LAST); absent until the first production export. Replaces the short-lived
   * single `finalCut` field (still read for migration — see parse).
   */
  readonly cuts?: ReadonlyArray<ProductionCut>
  /**
   * The whole-production editor's Save & Exit draft: the url of the FreeCut
   * project JSON saved when the user left the editor WITHOUT exporting a cut.
   * "Edit in FreeCut" prefers it over the last cut's project so the draft
   * resumes; a successful cut export clears it (the cut carries its own JSON).
   */
  readonly freecutDraftUrl?: string
  /**
   * DELETED clips — the recycle bin behind `Ctrl+Z` and the Trash panel (see
   * lib/trash). Persisted so the bin outlives a reload; absent until the first
   * clip is deleted, so an untouched production stays byte-identical.
   */
  readonly trash?: ReadonlyArray<TrashedItem>
  /**
   * The production-wide FILM look (camera / colour / art style / period) —
   * the layer above each scene's own look. Persisted so a picked film
   * setting survives a reload instead of resetting to Default.
   */
  readonly film?: ProductionFilmLook
  /**
   * The PROJECT CAST — the role→actor registry every prompt in this production
   * addresses by name (spec 2026-08-31-project-cast-registry). Absent until the
   * first enrollment, so a cast-less production stays byte-identical (and an
   * absent cast reads as exactly today's chip-addressed behavior).
   */
  readonly cast?: Cast
}

/** v1 (today): single shot, `shotOrder` = [imageNodeId, videoNodeId?]. */
export interface StudioSettingsV1 {
  readonly shotOrder?: ReadonlyArray<string>
  readonly perShot?: Record<string, { jobId?: string }>
}

/** What `serializeProduction` produces — drop straight into `persistProduction`. */
export interface SerializedProduction {
  readonly nodes: GenericNode[]
  readonly edges: GenericEdge[]
  readonly settings: { studio: StudioSettingsV3 }
}
