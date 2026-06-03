import type { SupabaseClient } from "@supabase/supabase-js"
import {
  VIDEO_MODEL_CAPS,
  type SceneNodeData,
  type ShotSpec,
  type VideoCriticFrameMode,
} from "@nodaro/shared"
import { pipelineExtractFrame } from "./services/pipeline-extract-frame.js"
import { pipelineEvents } from "./events.js"

/**
 * Offset (in seconds) before EOF when extracting the "last meaningful frame"
 * of a clip. Used by both {@link extractLastFrame} (continuity-chain anchor)
 * and {@link extractFramesForCritic} (Video Critic samples) so the same
 * canonical timestamp is sampled — keeps the critic's last-frame URL
 * comparable to the continuity-chain last-frame URL when downstream tooling
 * compares them. 0.1s is far enough past any trailing dissolve and ahead of
 * EOF rounding error in ffmpeg.
 */
const LAST_FRAME_OFFSET_SEC = 0.1

/**
 * Origin tag for an allocated reference slot. Used for telemetry +
 * the unified Injected References UI (1B.4 wiring) so users can see
 * which slot came from where.
 */
export type ReferenceSlotKind =
  | "continuity_anchor" // prior shot's last_frame
  | "primary_character"
  | "location_main"
  | "additional_character"
  | "additional_object"

export interface ReferenceSlot {
  readonly kind: ReferenceSlotKind
  readonly url: string
  /** When kind=continuity_anchor, the assetId from `pipeline_entities.last_frame_asset_id`.
   *  When kind=primary_character / location_main / additional_*, the
   *  `pipeline_entities.id` of the upstream entity. */
  readonly sourceId?: string
  /** Human-readable tag for diagnostics + the InjectedReferenceList UI. */
  readonly label: string
}

export interface ExtractLastFrameArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** SceneNode entity owning the shot. */
  sceneEntityId: string
  userId: string
  /** Source clip URL (the just-animated shot). */
  videoUrl: string
  /** Total duration of the clip in seconds. We extract at duration - 0.1s
   *  so we get the "last meaningful frame" before any trailing dissolve. */
  durationSec: number
}

export interface ExtractLastFrameResult {
  /** Asset id of the persisted PNG. Null in the rare race window where the
   *  extract-frame job completed before the asset row landed — the URL is
   *  still good in that case (we just can't write `last_frame_asset_id`). */
  assetId: string | null
  url: string
}

/**
 * Extracts the last frame of a just-animated clip, persists the resulting
 * asset, writes its id to `pipeline_entities.last_frame_asset_id`, emits an
 * entity:state_change event when the field changed. Returns the asset
 * id + URL so the caller (scene-internal-pipeline) can chain it into the
 * next shot's `startFrameUrl` via `applyContinuityToStartFrame`.
 */
export async function extractLastFrame(
  args: ExtractLastFrameArgs,
): Promise<ExtractLastFrameResult> {
  const { supabase, pipelineId, sceneEntityId, userId, videoUrl, durationSec } = args
  // Canonical "last meaningful frame" timestamp — see {@link LAST_FRAME_OFFSET_SEC}.
  const timestamp = Math.max(0, durationSec - LAST_FRAME_OFFSET_SEC)
  const result = await pipelineExtractFrame({
    supabase,
    pipelineId,
    pipelineEntityId: sceneEntityId,
    userId,
    videoUrl,
    mode: "timestamp",
    timestamp,
  })
  // Salvage the URL when present even if the asset row hasn't landed yet —
  // the continuity chain only needs the URL for the next shot's startFrame.
  // We just can't write `last_frame_asset_id` without the id. Throw only
  // when the URL itself is missing (the extract job failed outright).
  if (!result.assetUrl) {
    throw new Error(
      `extractLastFrame: extract-frame job completed without output URL (jobId=${result.jobId})`,
    )
  }

  if (result.assetId) {
    await supabase
      .from("pipeline_entities")
      .update({ last_frame_asset_id: result.assetId })
      .eq("id", sceneEntityId)
  }

  // No entity:state_change emit here — that event is for the
  // pipeline_entity_nodes canvas state machine (running → awaiting_approval
  // → approved). Stamping `last_frame_asset_id` is a data field update,
  // not a lifecycle transition.

  return { assetId: result.assetId, url: result.assetUrl }
}

/**
 * Cached result of the two DB queries that `allocateReferenceSlots` used to
 * run on every shot. Hoisting this to ONCE per scene (via
 * `prepareSceneRefContext`) reduces DB calls from 2×N_shots → 2 for the
 * whole scene.
 *
 * Phase 1C.3 §J2a: for an 8-shot scene the reduction is 16 → 2 queries.
 * For a 5-scene × 8-shot pipeline it's 80 → 10.
 */
export interface SceneRefContext {
  /**
   * Map of `"<entity_type>:<entity_key>"` → entity metadata.
   * Pre-built from `pipeline_entities` + `assets` once per scene.
   */
  entitiesByTypeKey: Map<string, { id: string; main_asset_url: string | null }>
}

/**
 * Executes the two DB queries for `allocateReferenceSlots` ONCE per scene.
 * Returns a `SceneRefContext` that can be passed into every
 * `allocateReferenceSlots` call for shots within the same scene.
 *
 * Call this at the top of `animateSequential` / `animateParallel` (one call
 * per scene runner invocation) and pass the result as `sceneContext` to
 * `safelyAllocateRefs` / `allocateReferenceSlots`.
 */
export async function prepareSceneRefContext(
  supabase: SupabaseClient,
  pipelineId: string,
  sceneNodeData: SceneNodeData,
): Promise<SceneRefContext> {
  const wantedKeys: Array<{ type: string; key: string }> = []
  for (const k of sceneNodeData.cast_keys) wantedKeys.push({ type: "character", key: k })
  if (sceneNodeData.location_key) wantedKeys.push({ type: "location", key: sceneNodeData.location_key })
  for (const k of sceneNodeData.object_keys) wantedKeys.push({ type: "object", key: k })

  const entitiesByTypeKey = new Map<string, { id: string; main_asset_url: string | null }>()
  if (wantedKeys.length > 0) {
    const types = Array.from(new Set(wantedKeys.map((k) => k.type)))
    const { data: entityRows } = await supabase
      .from("pipeline_entities")
      .select("id, entity_type, entity_key, main_asset_id")
      .eq("pipeline_id", pipelineId)
      .in("entity_type", types)
    const entities = (entityRows ?? []) as Array<{
      id: string
      entity_type: string
      entity_key: string
      main_asset_id: string | null
    }>
    const assetIds = entities.map((e) => e.main_asset_id).filter((id): id is string => !!id)
    const urlByAssetId = new Map<string, string>()
    if (assetIds.length > 0) {
      const { data: assetRows } = await supabase
        .from("assets")
        .select("id, r2_url")
        .in("id", assetIds)
      for (const a of (assetRows ?? []) as Array<{ id: string; r2_url: string | null }>) {
        if (a.r2_url) urlByAssetId.set(a.id, a.r2_url)
      }
    }
    for (const e of entities) {
      const url = e.main_asset_id ? urlByAssetId.get(e.main_asset_id) ?? null : null
      entitiesByTypeKey.set(`${e.entity_type}:${e.entity_key}`, {
        id: e.id,
        main_asset_url: url,
      })
    }
  }

  return { entitiesByTypeKey }
}

export interface AllocateReferenceSlotsArgs {
  supabase: SupabaseClient
  pipelineId: string
  scene: { id: string }
  shot: ShotSpec
  sceneNodeData: SceneNodeData
  /** Prior shot's last_frame_asset_id when the run is in sequential mode AND
   *  we're past shot 1. Null in parallel mode, on shot 1, or whenever the
   *  prior shot has no last frame yet. */
  priorLastFrame?: { assetId: string; url: string } | null
  /**
   * Pre-fetched scene-level entity context from `prepareSceneRefContext`.
   * When provided the two DB round-trips (pipeline_entities + assets) are
   * skipped — the cached map is used directly. Callers that process multiple
   * shots from the same scene SHOULD supply this to avoid N×2 DB queries.
   */
  sceneContext?: SceneRefContext
  /**
   * Override the reference budget. The default is the VIDEO model's
   * `maxReferenceImages` (correct for Stage 7 animate). Stage 6 keyframe gen is
   * an IMAGE gen, so it passes the image model's higher capability here — being
   * limited to the video model's 1-ref ceiling was dropping the character
   * reference views that keep identity consistent.
   */
  maxReferences?: number
}

/**
 * Allocates ordered reference slots for one shot per §5.13.3 v3.9.
 * Returns slots in this priority order, then truncates to the model's budget:
 *
 *   Slot 1: continuity anchor (priorLastFrame) — when present.
 *   Slot 2: primary character — the first cast_key whose entity has a
 *           main_asset_id (or its emotional-beat variant when the shot's
 *           emotional_beat tag matches a known expression variant).
 *   Slot 3: location — the entity matching sceneNodeData.location_key, with
 *           variant override when time_of_day metadata matches.
 *   Slots 4+: additional cast (cast_keys[1..]) + objects (object_keys[*]).
 *
 * The provider's `VIDEO_MODEL_CAPS[video_model].maxReferenceImages` (default 1)
 * is the hard ceiling. When the budget is 1, the continuity anchor wins
 * unconditionally and `needs_multishot_reference` is silently dropped — we
 * emit a `pipeline:warning` so the user knows the picks were degraded.
 *
 * Pass `sceneContext` (from `prepareSceneRefContext`) when processing multiple
 * shots in the same scene to skip the per-shot DB queries (J2a optimisation).
 */
export async function allocateReferenceSlots(
  args: AllocateReferenceSlotsArgs,
): Promise<ReferenceSlot[]> {
  const { supabase, pipelineId, shot, sceneNodeData, priorLastFrame, sceneContext } = args
  const slots: ReferenceSlot[] = []

  // Slot 1: continuity anchor
  if (priorLastFrame) {
    slots.push({
      kind: "continuity_anchor",
      url: priorLastFrame.url,
      sourceId: priorLastFrame.assetId,
      label: "Prior shot last frame",
    })
  }

  // Resolve cast + location + object entities from pipeline_entities.
  // When a pre-fetched `sceneContext` is supplied, reuse its cached map
  // (2 DB queries have already been paid once for the whole scene).
  // Otherwise fall back to querying per-call.
  let entitiesByTypeKey: Map<string, { id: string; main_asset_url: string | null }>

  if (sceneContext) {
    // Cached path — no DB round-trips.
    entitiesByTypeKey = sceneContext.entitiesByTypeKey
  } else {
    // Legacy fallback path — 2 DB queries (same logic as before J2a).
    const wantedKeys: Array<{ type: string; key: string }> = []
    for (const k of sceneNodeData.cast_keys) wantedKeys.push({ type: "character", key: k })
    if (sceneNodeData.location_key) wantedKeys.push({ type: "location", key: sceneNodeData.location_key })
    for (const k of sceneNodeData.object_keys) wantedKeys.push({ type: "object", key: k })

    entitiesByTypeKey = new Map<string, { id: string; main_asset_url: string | null }>()
    if (wantedKeys.length > 0) {
      // Fetch entities first (no nested join — supabase-js returns nested rows
      // as arrays which forces ugly destructuring), then resolve URLs from
      // the assets table in a single follow-up query. The cardinality is
      // small (a single scene rarely references >10 entities).
      const types = Array.from(new Set(wantedKeys.map((k) => k.type)))
      const { data: entityRows } = await supabase
        .from("pipeline_entities")
        .select("id, entity_type, entity_key, main_asset_id")
        .eq("pipeline_id", pipelineId)
        .in("entity_type", types)
      const entities = (entityRows ?? []) as Array<{
        id: string
        entity_type: string
        entity_key: string
        main_asset_id: string | null
      }>
      const assetIds = entities.map((e) => e.main_asset_id).filter((id): id is string => !!id)
      const urlByAssetId = new Map<string, string>()
      if (assetIds.length > 0) {
        const { data: assetRows } = await supabase
          .from("assets")
          .select("id, r2_url")
          .in("id", assetIds)
        for (const a of (assetRows ?? []) as Array<{ id: string; r2_url: string | null }>) {
          if (a.r2_url) urlByAssetId.set(a.id, a.r2_url)
        }
      }
      for (const e of entities) {
        const url = e.main_asset_id ? urlByAssetId.get(e.main_asset_id) ?? null : null
        entitiesByTypeKey.set(`${e.entity_type}:${e.entity_key}`, {
          id: e.id,
          main_asset_url: url,
        })
      }
    }
  }

  // Slot 2: primary character (cast_keys[0])
  const primaryCastKey = sceneNodeData.cast_keys[0]
  if (primaryCastKey) {
    const e = entitiesByTypeKey.get(`character:${primaryCastKey}`)
    if (e?.main_asset_url) {
      slots.push({
        kind: "primary_character",
        url: e.main_asset_url,
        sourceId: e.id,
        label: `Character: ${primaryCastKey}`,
      })
    }
  }

  // Slot 3: location
  if (sceneNodeData.location_key) {
    const e = entitiesByTypeKey.get(`location:${sceneNodeData.location_key}`)
    if (e?.main_asset_url) {
      slots.push({
        kind: "location_main",
        url: e.main_asset_url,
        sourceId: e.id,
        label: `Location: ${sceneNodeData.location_key}`,
      })
    }
  }

  // Slots 4+: additional cast + objects
  for (let i = 1; i < sceneNodeData.cast_keys.length; i++) {
    const k = sceneNodeData.cast_keys[i]
    if (!k) continue
    const e = entitiesByTypeKey.get(`character:${k}`)
    if (e?.main_asset_url) {
      slots.push({
        kind: "additional_character",
        url: e.main_asset_url,
        sourceId: e.id,
        label: `Character: ${k}`,
      })
    }
  }
  for (const k of sceneNodeData.object_keys) {
    const e = entitiesByTypeKey.get(`object:${k}`)
    if (e?.main_asset_url) {
      slots.push({
        kind: "additional_object",
        url: e.main_asset_url,
        sourceId: e.id,
        label: `Object: ${k}`,
      })
    }
  }

  // Cap to the reference budget. Callers may override (Stage 6 keyframe gen
  // passes the image model's higher cap); otherwise default to the VIDEO
  // model's maxReferenceImages (Stage 7 animate), or 1 when unknown.
  const budget =
    args.maxReferences ?? VIDEO_MODEL_CAPS[sceneNodeData.video_model]?.maxReferenceImages ?? 1

  if (budget === 1 && slots.length > 1) {
    // 1-ref provider degradation. Continuity anchor wins, others dropped.
    // needs_multishot_reference silently ignored — warn via the pipeline:warning
    // event so the user knows.
    pipelineEvents.publish({
      type: "pipeline:warning",
      pipelineId,
      code: "ref_slots_degraded_to_one",
      message: `Provider ${sceneNodeData.video_model} accepts 1 reference image; dropping ${slots.length - 1} additional ref(s). needs_multishot_reference=${shot.shot_intent.needs_multishot_reference} ignored.`,
    })
    return [slots[0]!]
  }

  if (slots.length <= budget) return slots
  return slots.slice(0, budget)
}

// ---------------------------------------------------------------------------
// Phase 1D.2c-b-ii — Video Critic frame extraction
// ---------------------------------------------------------------------------

export interface ExtractFrameAtTimestampArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Optional — attribute the asset to a scene entity for telemetry. */
  pipelineEntityId?: string
  userId: string
  videoUrl: string
  /** Seconds into the clip. Pipeline callers compute this (e.g. duration*0.5). */
  timestamp: number
}

export interface ExtractFrameAtTimestampResult {
  assetId: string | null
  url: string
}

/**
 * Extracts a single frame at the given timestamp from a video URL. A thin
 * wrapper around `pipelineExtractFrame` that ONLY surfaces the
 * `(assetId, url)` shape — does NOT write `pipeline_entities.last_frame_asset_id`
 * (that field is reserved for the continuity-anchor flow in `extractLastFrame`;
 * Video-Critic frames are mid-clip samples, not continuity anchors).
 *
 * Throws when the underlying extract-frame job returns no URL.
 */
export async function extractFrameAtTimestamp(
  args: ExtractFrameAtTimestampArgs,
): Promise<ExtractFrameAtTimestampResult> {
  const { supabase, pipelineId, pipelineEntityId, userId, videoUrl, timestamp } = args
  const result = await pipelineExtractFrame({
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrl,
    mode: "timestamp",
    timestamp,
  })
  if (!result.assetUrl) {
    throw new Error(
      `extractFrameAtTimestamp: extract-frame job completed without output URL (jobId=${result.jobId}, timestamp=${timestamp}s)`,
    )
  }
  return { assetId: result.assetId, url: result.assetUrl }
}

export interface ExtractFramesForCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Scene entity owning the shot, optional (used to tag extracted assets). */
  pipelineEntityId?: string
  userId: string
  videoUrl: string
  /** Shot duration in seconds — drives the timestamp grid. */
  durationSeconds: number
  /** Which frame grid to extract (see `VIDEO_CRITIC_FRAME_MODES`). */
  mode: VideoCriticFrameMode
  /**
   * Caller-supplied first-frame URL (the input keyframe). Reused as the t=0
   * frame so we never re-extract a frame we already have.
   */
  firstFrameUrl: string
}

export interface FrameExtractionResult {
  /** Frame URLs in chronological order (length 2/3/5 depending on mode). */
  frameUrls: string[]
  /**
   * /simplify pass-2 — asset id of the LAST frame extracted (always the
   * `duration - 0.1s` sample at the end of `frameUrls`). The critic itself
   * doesn't use the id, but the caller (`runSceneInternalPipeline`'s
   * sequential animate loop) can reuse it as the continuity anchor for the
   * next shot — without this, the caller had to fire a SECOND
   * `extractLastFrame` for the SAME timestamp on the SAME video right after
   * the critic finished. Null when `result.assetId` was null in the extract
   * job (the URL is still good — only the persistence write loses).
   */
  lastFrameAssetId: string | null
}

/**
 * Phase 1D.2c-b-ii §3 — Builds the frame-URL array the Video Critic
 * (Stage 7) needs to score a just-animated shot. Mode picks the grid:
 *
 *   - "first_last":         [t=0,  t=last]                                  (length 2)
 *   - "first_middle_last":  [t=0,  t=duration*0.5,  t=last]                 (length 3)
 *   - "five_evenly":        [t=0,  t=d*0.25, t=d*0.5, t=d*0.75, t=last]     (length 5)
 *
 * The t=0 frame is always reused from `firstFrameUrl` (the input keyframe
 * the shot was animated from — no re-extraction). The "last" frame is
 * extracted at `duration - 0.1s` to match the canonical offset the
 * continuity chain uses (past any trailing dissolve, before EOF rounding).
 * All non-t=0 frames go through `extractFrameAtTimestamp`, which does NOT
 * touch `pipeline_entities.last_frame_asset_id` — that field is owned by
 * `extractLastFrame` in the continuity-chain flow and the critic must not
 * race with it.
 *
 * Errors from any single extraction propagate — the Video Critic cannot
 * run on a partial frame grid. Callers should wrap in try/catch and
 * degrade gracefully (skip the critic for this shot) where appropriate.
 */
export async function extractFramesForCritic(
  args: ExtractFramesForCriticArgs,
): Promise<FrameExtractionResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    videoUrl,
    durationSeconds,
    mode,
    firstFrameUrl,
  } = args

  // Canonical "last meaningful frame" offset — see {@link LAST_FRAME_OFFSET_SEC}.
  // Matches extractLastFrame so any downstream tooling that compares the
  // critic's last-frame URL to the continuity-chain last-frame URL gets the
  // same ffmpeg timestamp.
  const lastTimestamp = Math.max(0, durationSeconds - LAST_FRAME_OFFSET_SEC)

  // Pick the non-t=0 timestamps (the t=0 frame is always firstFrameUrl).
  const nonZeroTimestamps: number[] =
    mode === "first_last"
      ? [lastTimestamp]
      : mode === "first_middle_last"
        ? [durationSeconds * 0.5, lastTimestamp]
        : [
            durationSeconds * 0.25,
            durationSeconds * 0.5,
            durationSeconds * 0.75,
            lastTimestamp,
          ]

  // Extractions are independent (each at a different timestamp); run them in
  // parallel. Each call enqueues a BullMQ extract-frame job, reserves credits,
  // and polls — so sequencing them adds 4× round-trips on `five_evenly`.
  // `Promise.all` preserves array order so the t=middle / t=last orderings
  // downstream callers depend on are unchanged.
  const extracted = await Promise.all(
    nonZeroTimestamps.map((ts) =>
      extractFrameAtTimestamp({
        supabase,
        pipelineId,
        pipelineEntityId,
        userId,
        videoUrl,
        timestamp: ts,
      }),
    ),
  )
  const frameUrls: string[] = [firstFrameUrl, ...extracted.map((e) => e.url)]
  // The last non-t=0 extraction is ALWAYS the `lastTimestamp` sample
  // (sequenced last in `nonZeroTimestamps` for every mode). Surface its
  // asset id so the caller can reuse it as the continuity anchor for the
  // next shot — see {@link FrameExtractionResult.lastFrameAssetId}.
  const lastFrameAssetId = extracted[extracted.length - 1]?.assetId ?? null
  return { frameUrls, lastFrameAssetId }
}

