import type { SupabaseClient } from "@supabase/supabase-js"
import { VIDEO_MODEL_CAPS, type SceneNodeData, type ShotSpec } from "@nodaro/shared"
import { pipelineExtractFrame } from "./services/pipeline-extract-frame.js"
import { pipelineEvents } from "./events.js"

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
  // 0.1s before the end is the canonical "last meaningful frame" — past any
  // trailing dissolve and before EOF rounding error in ffmpeg.
  const timestamp = Math.max(0, durationSec - 0.1)
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
 */
export async function allocateReferenceSlots(
  args: AllocateReferenceSlotsArgs,
): Promise<ReferenceSlot[]> {
  const { supabase, pipelineId, shot, sceneNodeData, priorLastFrame } = args
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
  // Each cast/location/object row stores its main_asset_id; we coalesce that
  // URL via a single bulk query keyed on (entity_type, entity_key).
  const wantedKeys: Array<{ type: string; key: string }> = []
  for (const k of sceneNodeData.cast_keys) wantedKeys.push({ type: "character", key: k })
  if (sceneNodeData.location_key) wantedKeys.push({ type: "location", key: sceneNodeData.location_key })
  for (const k of sceneNodeData.object_keys) wantedKeys.push({ type: "object", key: k })

  const entitiesByTypeKey = new Map<string, { id: string; main_asset_url: string | null }>()
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

  // Cap to the model's maxReferenceImages budget. Default to 1 when unknown
  // (defensive — every shipped video model declares the field).
  const budget = VIDEO_MODEL_CAPS[sceneNodeData.video_model]?.maxReferenceImages ?? 1

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

