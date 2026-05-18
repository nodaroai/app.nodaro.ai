import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineState } from "@nodaro/shared"
import { pipelineEvents } from "./events.js"

/**
 * Resolve entity_keys (logical identifiers like 'hero', 'carrier_deck') into
 * pipeline_entities.id (uuid) values within the same pipeline.
 *
 * Used at scene-creation time to set `depends_on` from the cast/location/object
 * keys the Scene Director emitted.
 */
export async function resolveEntityKeysToIds(
  supabase: SupabaseClient,
  pipelineId: string,
  keys: ReadonlyArray<string>,
): Promise<string[]> {
  if (keys.length === 0) return []
  const { data, error } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key")
    .eq("pipeline_id", pipelineId)
    .in("entity_key", [...keys])
  if (error) throw new Error(`resolveEntityKeysToIds: ${error.message}`)
  return (data ?? []).map((row) => row.id as string)
}

/**
 * Persist the depends_on array on a pipeline_entities row. Replaces any
 * existing dependency list.
 */
export async function setEntityDepends(
  supabase: SupabaseClient,
  entityId: string,
  dependsOn: ReadonlyArray<string>,
): Promise<void> {
  const { error } = await supabase
    .from("pipeline_entities")
    .update({ depends_on: [...dependsOn] })
    .eq("id", entityId)
  if (error) throw new Error(`setEntityDepends ${entityId}: ${error.message}`)
}

/**
 * Transition every pipeline_entity_nodes row tied to a given pipeline_entity
 * into a new pipeline_state. Stamps last_state_change_at so the frontend can
 * animate / debounce on the transition.
 *
 * `pipeline_state` lives on `pipeline_entity_nodes.pipeline_state` (migration
 * 131) with the four values defined by `PipelineState` in `@nodaro/shared`.
 */
export async function markEntityNodeState(
  supabase: SupabaseClient,
  pipelineEntityId: string,
  newState: PipelineState,
): Promise<void> {
  // pipeline_entity_nodes.entity_id (migration 121 line 193) is the FK to
  // pipeline_entities.id. Older drafts referenced this as `pipeline_entity_id`;
  // the actual schema column is `entity_id`.
  const { error } = await supabase
    .from("pipeline_entity_nodes")
    .update({
      pipeline_state: newState,
      last_state_change_at: new Date().toISOString(),
    })
    .eq("entity_id", pipelineEntityId)
  if (error) throw new Error(`markEntityNodeState ${pipelineEntityId}: ${error.message}`)
}

/**
 * Batch transition: mark every pipeline_entity_nodes row that belongs to a
 * given pipeline_stages.id into a new pipeline_state via a single UPDATE.
 * Used at stage emit time (entire batch goes to awaiting_approval at once)
 * and when an in-flight stage is failed/cancelled.
 *
 * PostgREST has no first-class subquery, so we fan out: load entity IDs for
 * the stage, then update `pipeline_entity_nodes` via `.in("entity_id", ...)`.
 * No-op when the stage has no entities or none of them have been materialized
 * to canvas yet — both UPDATEs return 0 rows affected, which is fine.
 */
export async function markStageEntityNodesState(
  supabase: SupabaseClient,
  stageId: string,
  newState: PipelineState,
): Promise<string[]> {
  const entitiesRes = await supabase
    .from("pipeline_entities")
    .select("id")
    .eq("stage_id", stageId)

  if (entitiesRes.error) {
    throw new Error(
      `markStageEntityNodesState ${stageId}: failed to load entity ids: ${entitiesRes.error.message}`,
    )
  }

  const entityIds = (entitiesRes.data ?? []).map((row) => row.id as string)
  if (entityIds.length === 0) return []

  const { error } = await supabase
    .from("pipeline_entity_nodes")
    .update({
      pipeline_state: newState,
      last_state_change_at: new Date().toISOString(),
    })
    .in("entity_id", entityIds)
  if (error) throw new Error(`markStageEntityNodesState ${stageId}: ${error.message}`)
  return entityIds
}

/**
 * Mark every pipeline_entity_nodes row for the pipeline as `pipeline_orphaned`.
 *
 * Used when a pipeline is force-stopped / cancelled / forked — the underlying
 * canvas nodes survive (the user keeps the work), but the pipeline no longer
 * owns them.
 *
 * Implementation note: PostgREST has no first-class subquery support, so we
 * fan out in two queries — load entity IDs, then update nodes via `.in()`.
 * Both queries are error-checked; a failure in the first query throws instead
 * of silently producing an empty `.in()` clause (which would no-op the
 * orphaning step).
 */
export async function orphanAllEntityNodes(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<void> {
  const entitiesRes = await supabase
    .from("pipeline_entities")
    .select("id")
    .eq("pipeline_id", pipelineId)

  if (entitiesRes.error) {
    throw new Error(
      `orphanAllEntityNodes ${pipelineId}: failed to load entity ids: ${entitiesRes.error.message}`,
    )
  }

  const entityIds = (entitiesRes.data ?? []).map((row) => row.id as string)
  if (entityIds.length === 0) return

  const { error } = await supabase
    .from("pipeline_entity_nodes")
    .update({
      pipeline_state: "pipeline_orphaned",
      last_state_change_at: new Date().toISOString(),
    })
    .in("entity_id", entityIds)
  if (error) throw new Error(`orphanAllEntityNodes ${pipelineId}: ${error.message}`)
}

/**
 * Convenience wrapper used at every per-entity lifecycle transition site
 * (stages/{characters,objects,locations,shot-list}.ts + entity-approval.ts):
 * mark the canvas node row, then publish the matching `entity:state_change`
 * SSE event. Failures are logged with `logTag` and swallowed — the DB write is
 * the source of truth and a missing SSE event is a UX miss, not a correctness
 * bug, so we never unwind the calling stage.
 */
export async function transitionEntityNodeAndEmit(
  supabase: SupabaseClient,
  pipelineId: string,
  entityId: string,
  newState: PipelineState,
  logTag: string,
): Promise<void> {
  try {
    await markEntityNodeState(supabase, entityId, newState)
    pipelineEvents.publish({
      type: "entity:state_change",
      pipelineId,
      pipelineEntityId: entityId,
      newState,
    })
  } catch (err) {
    console.error(
      `[${logTag}] transitionEntityNode failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Convenience wrapper used at every batch-stage transition site
 * (stages/{characters,locations}.ts variant-batch flows): batch-update every
 * canvas node row tied to the stage's entities, then publish one
 * `entity:state_change` SSE event per touched entity. Same failure-tolerant
 * behavior as {@link transitionEntityNodeAndEmit}.
 */
export async function transitionStageEntityNodesAndEmit(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  newState: PipelineState,
  logTag: string,
): Promise<void> {
  try {
    const touched = await markStageEntityNodesState(supabase, stageId, newState)
    for (const entityId of touched) {
      pipelineEvents.publish({
        type: "entity:state_change",
        pipelineId,
        pipelineEntityId: entityId,
        newState,
      })
    }
  } catch (err) {
    console.error(
      `[${logTag}] transitionStageEntityNodes failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}
