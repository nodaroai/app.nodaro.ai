/**
 * The wire contract of `/v1/studio/productions` — TYPES ONLY.
 *
 * A studio production is a Nodaro workflow whose `settings.studio` holds the
 * shots. Its CODE — the codec that reads and writes that document, the plan
 * format, the catalogs and the reducers — lives in `@nodaro/studio-production`,
 * which is FSL-licensed. What lives here is the ENVELOPE the routes return and
 * the bodies they take, because the SDK is typed against this package and an
 * SDK caller has to know the shape of a reply.
 *
 * The document's own sub-objects (the cast, the looks, the scene plan, the
 * cuts) are therefore named JSON aliases rather than re-declared shapes. That
 * is deliberate on both counts:
 *
 * - **Named**, not one anonymous `unknown`, so a `.d.ts` reader can still see
 *   which field is which and the SDK's surface documents itself.
 * - **Not re-declared**, because a second definition of the document is exactly
 *   the disagreement this contract exists to end — and publishing the studio's
 *   domain types under Apache would be an irrevocable grant of code that was
 *   deliberately placed one tier down.
 *
 * `@nodaro/studio-production` narrows every one of them to its real type and
 * pins the narrowed view against this one at build time, so the two cannot
 * drift apart in silence. A consumer that wants the narrow types depends on
 * that package; a consumer that only reads the wire uses these.
 */

/**
 * How a result is ADDRESSED: its job id when it has one, its url otherwise.
 *
 * Never a position. An index is meaningless the moment another writer inserts
 * a result — and two writers is the normal case here, since an agent and the
 * editor hold the same production open. Uploaded and hand-attached media have
 * no job, which is why the url is the fallback rather than the key.
 */
export type ResultKey = string

// ── the document's own vocabulary, as JSON ──────────────────────────────────
// Each alias names the `@nodaro/studio-production` type that defines it.

/** `LookSelectionMap` — cinematic picks by dimension key. */
export type StudioLookMapJson = Record<string, unknown>
/** `Cast` — the production's roles, keyed by role slug. */
export type StudioCastJson = Record<string, unknown>
/** `CastLookMap` — which view of each actor a scene pins. */
export type StudioCastLookMapJson = Record<string, unknown>
/** `ProductionFolder` — a named timeline folder. */
export type StudioFolderJson = Record<string, unknown>
/** `StoryboardSettings` — the Storyboard tab's persisted state (`brief` lives here). */
export type StudioStoryboardJson = Record<string, unknown>
/** `ProductionMusic` — the rendered soundtrack muxed over the export. */
export type StudioMusicJson = Record<string, unknown>
/** `PlanMusic` — the soundtrack PLAN (prompt + pickers), kept beside the track. */
export type StudioMusicPlanJson = Record<string, unknown>
/** `ProductionCut` — one exported cut of the film. */
export type StudioCutJson = Record<string, unknown>
/** `ScenePlan` — a scene's authored framing / motion / voice, before it renders. */
export type StudioPlanJson = Record<string, unknown>
/** `ShotBeat` — one timed motion window inside a scene. */
export type StudioBeatJson = Record<string, unknown>
/** `ShotTransition` — how a scene's last frames go out. */
export type StudioTransitionJson = Record<string, unknown>
/** `ShotVoice` — the scene's generated voiceover. */
export type StudioVoiceJson = Record<string, unknown>
/** `DirectionFields` / `SubjectFields` — platform catalog ids carried on a result. */
export type StudioIdFieldsJson = Record<string, unknown>
/** `ConnectedReference` — a bound `@`-entity chip. */
export type StudioReferenceJson = Record<string, unknown>
/** `TrashedItem` — one deleted shot, still or clip, restorable by id. */
export type StudioTrashItemJson = Record<string, unknown>

// ── results ────────────────────────────────────────────────────────────────

/**
 * One generated STILL, with the context that regenerates it.
 *
 * Result histories ACCUMULATE — a generate appends, it never replaces — so a
 * shot's stills are every framing candidate it has ever had, and each one
 * carries what it was made with. That is what makes "go back to the second
 * one" a read rather than a re-run.
 */
export interface StudioResultView {
  key: ResultKey
  url: string
  jobId?: string
  name?: string
  prompt?: string
  negativePrompt?: string
  provider?: string
  referenceImageUrls?: string[]
  references?: StudioReferenceJson[]
  aspectRatio?: string
  resolution?: string
  /** The look layers this generation was sent with — film, scene, then the shot's own. */
  filmLook?: StudioLookMapJson
  sceneLook?: StudioLookMapJson
  look?: StudioLookMapJson
  subject?: StudioIdFieldsJson
}

/**
 * One generated CLIP, with the frames it was animated from.
 *
 * The frames matter more here than they look: selecting a past clip restores
 * the start and end frames THAT clip was made from, which is why they are
 * stored per result rather than read off the shot.
 */
export interface StudioClipResultView {
  key: ResultKey
  url: string
  jobId?: string
  name?: string
  prompt?: string
  provider?: string
  negativePrompt?: string
  duration?: number
  /** The frames THIS clip was animated from — restored with it, never derived. */
  startFrameUrl?: string
  endFrameUrl?: string
  referenceImageUrls?: string[]
  references?: StudioReferenceJson[]
  beats?: StudioBeatJson[]
  scenePrompt?: string
  endTransition?: StudioTransitionJson
  filmLook?: StudioLookMapJson
  sceneLook?: StudioLookMapJson
  look?: StudioLookMapJson
  subject?: StudioIdFieldsJson
}

/**
 * A framing batch that is STILL RUNNING, with everything needed to land it.
 *
 * A marker rather than a promise: any client — or none — can finish the job,
 * because the context that turns a finished job into a result is written down
 * on the production instead of living in the browser tab that started it.
 */
export interface PendingStillView {
  jobId: string
  batchId?: string
  provider?: string
  prompt?: string
  count?: number
  startedAt?: string
}

/** An animate that is still running. The clip mirror of {@link PendingStillView}. */
export interface PendingClipView {
  jobId: string
  provider?: string
  prompt?: string
  startedAt?: string
}

// ── the shot ───────────────────────────────────────────────────────────────

/** A shot's framed STILL: the active frame, and (at `detail: "full"`) its history. */
export interface StudioStillView {
  nodeId: string
  provider: string
  prompt: string
  active: ResultKey | null
  activeUrl: string
  count: number
  /** Cinematic direction as PLATFORM catalog ids — never baked hint text. */
  direction?: StudioIdFieldsJson
  subject?: StudioIdFieldsJson
  /** Present only at `detail: "full"` — a list read returns counts, not histories. */
  results?: StudioResultView[]
  pending: PendingStillView[]
}

/** A shot's animated CLIP. Independent of the still: deleting one never touches the other. */
export interface StudioClipView {
  nodeId: string
  provider: string
  prompt: string
  duration?: number
  active: ResultKey | null
  activeUrl: string
  count: number
  direction?: StudioIdFieldsJson
  /** The voice this clip was revoiced into, when it was. */
  revoicedVoiceId?: string
  revoicedVoiceName?: string
  /** Present only at `detail: "full"`. */
  results?: StudioClipResultView[]
  pending: PendingClipView[]
}

/** One shot, in timeline order. */
export interface StudioShotView {
  id: string
  index: number
  name?: string
  folderId?: string
  still?: StudioStillView
  clip?: StudioClipView
  /** Explicit and sticky: selecting a still never moves them. */
  startFrame?: string
  endFrame?: string
  directingReferences?: {
    images?: string[]
    videos?: string[]
    audio?: string[]
  }
  plan?: StudioPlanJson
  scenePrompt?: string
  beats?: StudioBeatJson[]
  endTransition?: StudioTransitionJson
  look?: StudioLookMapJson
  castLook?: StudioCastLookMapJson
  voice?: StudioVoiceJson
}

// ── the production ─────────────────────────────────────────────────────────

/** What is in flight, at a glance — the reason a `get` can reconcile before it reads. */
export interface StudioPendingView {
  stills: number
  clips: number
  music: boolean
  draft: { jobId: string; mode: "replace" | "append" } | null
}

/** The bin: a count always, the items only at `detail: "full"`. */
export interface StudioTrashView {
  count: number
  items?: StudioTrashItemJson[]
}

/** The read shape of every `/v1/studio/productions` route and every studio MCP tool. */
export interface StudioProductionView {
  id: string
  name: string
  version: number
  updatedAt: string
  thumbnailUrl: string | null
  shared: boolean
  archived: boolean
  film?: StudioLookMapJson
  cast?: StudioCastJson
  folders: StudioFolderJson[]
  storyboard?: StudioStoryboardJson
  music?: StudioMusicJson
  musicPlan?: StudioMusicPlanJson
  cuts: StudioCutJson[]
  trash: StudioTrashView
  pending: StudioPendingView
  /** In timeline order. */
  shots: StudioShotView[]
}

/** A dashboard row — what a list returns, with no shot bodies at all. */
export interface StudioProductionSummary {
  id: string
  name: string
  version: number
  updatedAt: string
  thumbnailUrl: string | null
  shared: boolean
  archived: boolean
  shotCount: number
}

// ── request / response bodies ───────────────────────────────────────────────
// Phase 0's five routes. The operation, generation and lifecycle bodies land
// with the routes that take them, so this file never describes a route the
// platform does not serve.

/** `GET …/skill` — the authoring skill, rendered from the package at request time. */
export interface StudioSkillResponse {
  /** SKILL.md — the authoring guide. */
  skill: string
  /** references/catalog.md — every picker, model and enum, in full. */
  catalog: string
  /** schema.json — the strict JSON Schema a plan is validated against. */
  schema: Record<string, unknown>
  /** The operating guide: the tool map, the loops, the rules. */
  operating: string
  /** The catalog versions the three were rendered from. */
  generatedFrom: { prompts: string; shared: string }
}

/** One thing wrong with a plan, addressed at the field that is wrong. */
export interface StudioPlanIssue {
  path: string
  message: string
  hint?: string
}

/** `POST …/validate` — free, persists nothing, and resolves against the caller's library. */
export interface StudioValidatePlanRequest {
  plan: Record<string, unknown>
}

export interface StudioValidatePlanResponse {
  valid: boolean
  errors: StudioPlanIssue[]
  warnings: StudioPlanIssue[]
  summary?: {
    name?: string
    scenes: number
    shots: number
    cast: number
    /** Cast entries that matched a row in the caller's library. */
    bound: number
  }
}

/** `GET …?limit&cursor` — the caller's "Studio" project, archived and hidden filtered. */
export interface StudioListProductionsResponse {
  data: StudioProductionSummary[]
  nextCursor?: string
}

/** `POST …` — a new production, optionally landed from a plan in the same call. */
export interface StudioCreateProductionRequest {
  name?: string
  plan?: Record<string, unknown>
}

/** `POST …/:id/import` — add a plan's scenes to a production that already exists. */
export interface StudioImportPlanRequest {
  plan: Record<string, unknown>
  mode?: "append"
}

/** What an import did, in the words a receipt would use. */
export interface StudioImportSummary {
  shotsAdded: number
  castEnrolled: number
  /** Cast entries that resolved to a row in the caller's library. */
  castBound: number
}

export interface StudioProductionResponse {
  production: StudioProductionView
  warnings?: StudioPlanIssue[]
  summary?: StudioImportSummary
}

/** How much of a production a read returns. */
export type StudioProductionDetail = "summary" | "full"
