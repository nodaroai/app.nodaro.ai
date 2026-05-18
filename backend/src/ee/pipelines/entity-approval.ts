import type { SupabaseClient } from "@supabase/supabase-js"
import { pipelineEvents } from "./events.js"

/**
 * Approves a single pipeline_entity row, optimistic-concurrency-guarded against
 * status='awaiting_approval'. Mirrors Section I's stage-level approve pattern.
 *
 * On success, also materializes the entity as a Character/Object/Location node
 * on the parent workflow's canvas via `materializeEntityOnCanvas` (idempotent).
 *
 * NOTE: this function does NOT re-enqueue the engine; the route handler in
 * `routes/pipelines.ts` enqueues `enqueuePipelineRun({ reason: "stage_advance" })`
 * after a successful approve. Adding an enqueue here would double-fire.
 */
export async function approveEntity(
  supabase: SupabaseClient,
  pipelineId: string,
  entityId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from("pipeline_entities")
    .update({ status: "approved" })
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .eq("status", "awaiting_approval")
    .select("id, entity_type, entity_key")
  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "entity_already_advanced" }
  const row = data[0]
  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    status: "approved",
  })

  // Materialize the approved entity as a canvas node (Phase 1B.1: static
  // create, no animations). Idempotent and a no-op when the pipeline has no
  // bound workflow (programmatic activation mode). Failures here MUST NOT
  // unwind the approve — the DB row is already approved and the route will
  // still re-enqueue the engine; missing canvas reflection is a UX gap, not
  // a correctness issue. Phase 1B.4 will add ELK auto-layout + reconciliation.
  const entityType = row.entity_type as string
  if (entityType === "character" || entityType === "object" || entityType === "location") {
    try {
      await materializeForApprovedEntity(supabase, pipelineId, entityId, entityType)
    } catch (err) {
      console.error("[pipelines/entity-approval] Failed to materialize entity on canvas:", err)
    }
  }

  return { ok: true }
}

/**
 * Loads the full entity + its main asset's r2_url, then calls
 * `materializeEntityOnCanvas` with a Phase 1B.1 grid position.
 *
 * Split out so the entity-load + asset-load failure modes are unified in one
 * try/catch in `approveEntity` and the orchestration logic stays readable.
 */
async function materializeForApprovedEntity(
  supabase: SupabaseClient,
  pipelineId: string,
  entityId: string,
  entityType: "character" | "object" | "location",
): Promise<void> {
  const { data: full } = await supabase
    .from("pipeline_entities")
    .select("id, entity_type, entity_key, metadata, main_asset_id")
    .eq("id", entityId)
    .single()
  if (!full?.main_asset_id) return

  const { data: asset } = await supabase
    .from("assets")
    .select("r2_url")
    .eq("id", full.main_asset_id)
    .single()
  const assetUrl = (asset?.r2_url as string | undefined) ?? ""

  const meta = (full.metadata ?? {}) as Record<string, unknown>
  const entityName = String(meta.name ?? full.entity_key)
  const visualDescription = String(meta.visual_description ?? "")

  const { materializeEntityOnCanvas } = await import("./services/canvas-materializer.js")
  await materializeEntityOnCanvas({
    supabase,
    pipelineId,
    pipelineEntityId: entityId,
    entityType,
    entityKey: full.entity_key as string,
    entityName,
    visualDescription,
    mainAssetId: full.main_asset_id as string,
    mainAssetUrl: assetUrl,
    position: computeCanvasPosition(entityType),
  })
}

/**
 * Phase 1B.1 grid layout. Each entity_type gets its own y-band; x increments
 * by 250px per entity in that type. The counter lives in-process so it resets
 * on worker restart — acceptable for 1B.1 (users can rearrange manually).
 *
 * Phase 1B.4 replaces this with ELK auto-layout that respects existing
 * positions and animates insertions.
 */
const _gridPositionCounts: Map<string, number> = new Map()

function computeCanvasPosition(
  entityType: "character" | "object" | "location",
): { x: number; y: number } {
  const key = entityType
  const count = (_gridPositionCounts.get(key) ?? 0) + 1
  _gridPositionCounts.set(key, count)
  const yBand = entityType === "character" ? 200 : entityType === "object" ? 450 : 700
  return { x: 200 + count * 250, y: yBand }
}

/**
 * Rejects + records feedback. Caller (engine) re-runs generation.
 *
 * NOTE: rejection bumps a per-entity retry counter to bound flapping.
 * Currently uses pipeline_entities.metadata.reject_count (not a dedicated column —
 * keeps the schema migration count down). Cap at 2.
 */
export async function rejectEntity(
  supabase: SupabaseClient,
  pipelineId: string,
  entityId: string,
  feedback: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Fetch + check cap.
  const { data: current } = await supabase
    .from("pipeline_entities")
    .select("metadata, entity_type, entity_key, status")
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle()
  if (!current) return { ok: false, reason: "entity_not_found" }
  if (current.status !== "awaiting_approval") {
    return { ok: false, reason: "entity_not_awaiting_approval" }
  }
  const metadata = (current.metadata ?? {}) as Record<string, unknown>
  const rejectCount = ((metadata.reject_count as number) ?? 0) + 1
  if (rejectCount > 2) return { ok: false, reason: "reject_cap_reached" }

  const { data, error } = await supabase
    .from("pipeline_entities")
    .update({
      status: "generating",
      metadata: {
        ...metadata,
        reject_count: rejectCount,
        last_reject_feedback: feedback,
      },
    })
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .eq("status", "awaiting_approval")
    .select("id")
  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "entity_already_advanced" }

  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId,
    entityType: current.entity_type,
    entityKey: current.entity_key,
    status: "generating",
  })
  return { ok: true }
}
