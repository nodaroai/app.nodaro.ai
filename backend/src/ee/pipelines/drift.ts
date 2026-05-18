import type { SupabaseClient } from "@supabase/supabase-js"
import { pipelineEvents } from "./events.js"

/**
 * Phase 1B.4 — drift detection at stage boundaries.
 *
 * Called by the engine at stage-start. Validates that every entity the
 * upcoming stage will reference is still present on the canvas, not
 * forked, and not orphaned (a pipeline_entity_nodes row marked
 * `pipeline_orphaned`). When drift is detected the engine pauses the
 * stage at `awaiting_approval` with `awaiting_reason='canvas_drift'`
 * and the panel renders the DriftBanner.
 *
 * Drift sources:
 *   - missing       — entity row deleted off the canvas (user removed it)
 *   - forked        — entity flagged is_forked (user took manual control)
 *   - disconnected  — node row exists but pipeline_state='pipeline_orphaned'
 *                     (parent pipeline was force-stopped / forked; node
 *                     survives but the pipeline doesn't own it anymore)
 *
 * The rich `DriftReport` is returned for the engine's pause decision; a
 * canonical-shape `pipeline:drift` SSE event is published so the panel /
 * banner can react. The SSE schema (PipelineDriftSummarySchema in
 * `@nodaro/shared`) is intentionally narrower than `DriftReport` — it
 * carries the union of drifted IDs + a one-line summary the UI renders.
 */

export interface DriftedEntity {
  entityId: string
  entityKey: string
  entityType?: string
}

export interface DriftReport {
  ok: boolean
  missing: DriftedEntity[]
  disconnected: DriftedEntity[]
  forked: DriftedEntity[]
  recommendedAction:
    | "regenerate_missing"
    | "fork_pipeline"
    | "abandon_pipeline"
    | "none"
}

/**
 * @param expectedEntityIds  The `pipeline_entities.id` values the upcoming
 *                           stage is about to consume. The engine knows this
 *                           (e.g. for Stage 6 it's every scene entity).
 * @param stageName          Stage we're about to run — only used to label
 *                           the SSE event.
 */
export async function validateCanvasAgainstPlan(
  supabase: SupabaseClient,
  pipelineId: string,
  expectedEntityIds: ReadonlyArray<string>,
  stageName: string,
): Promise<DriftReport> {
  if (expectedEntityIds.length === 0) {
    return {
      ok: true,
      missing: [],
      disconnected: [],
      forked: [],
      recommendedAction: "none",
    }
  }

  // Both reads filter on the same expected-id set and have no causal
  // dependency — fan them out in parallel.
  const [entitiesRes, nodesRes] = await Promise.all([
    supabase
      .from("pipeline_entities")
      .select("id, entity_key, entity_type, is_forked")
      .in("id", [...expectedEntityIds]),
    supabase
      .from("pipeline_entity_nodes")
      .select("entity_id, pipeline_state")
      .in("entity_id", [...expectedEntityIds]),
  ])
  const { data: entities } = entitiesRes
  const { data: nodes } = nodesRes

  // Coerce to a stable typed view to keep the rest of this function readable.
  type EntityRow = {
    id: string
    entity_key: string
    entity_type: string
    is_forked: boolean
  }
  const entityRows = (entities ?? []) as EntityRow[]
  const presentIds = new Set(entityRows.map((e) => e.id))

  const missing: DriftedEntity[] = [...expectedEntityIds]
    .filter((id) => !presentIds.has(id))
    .map((id) => ({ entityId: id, entityKey: "(deleted)", entityType: "unknown" }))

  const forked: DriftedEntity[] = entityRows
    .filter((e) => e.is_forked === true)
    .map((e) => ({
      entityId: e.id,
      entityKey: e.entity_key,
      entityType: e.entity_type,
    }))

  // Disconnected = node row exists with pipeline_state='pipeline_orphaned'.
  // Orphaned-only entities (not also forked) — fork already covers the
  // "user took manual control" case; orphaning is the cancel/force-stop
  // bucket and surfaces a distinct banner.
  const forkedIds = new Set(forked.map((f) => f.entityId))
  type NodeRow = { entity_id: string; pipeline_state: string }
  const orphanedSet = new Set(
    ((nodes ?? []) as NodeRow[])
      .filter((n) => n.pipeline_state === "pipeline_orphaned")
      .map((n) => n.entity_id),
  )
  const disconnected: DriftedEntity[] = entityRows
    .filter((e) => orphanedSet.has(e.id) && !forkedIds.has(e.id))
    .map((e) => ({
      entityId: e.id,
      entityKey: e.entity_key,
      entityType: e.entity_type,
    }))

  const ok = missing.length === 0 && disconnected.length === 0 && forked.length === 0

  // Decision: ok → none. Otherwise: missing entities can always be
  // regenerated, so they take precedence; with NO missing but forked
  // entities present the user is the only one who can recover (fork the
  // pipeline). Pure-disconnected falls back to the regenerate path.
  // (Pre-simplification this was a three-arm if/else where the third arm
  // returned the same value as the first — collapsed into a single ternary.)
  const recommendedAction: DriftReport["recommendedAction"] = ok
    ? "none"
    : missing.length > 0
      ? "regenerate_missing"
      : forked.length > 0
        ? "fork_pipeline"
        : "regenerate_missing"

  const report: DriftReport = { ok, missing, disconnected, forked, recommendedAction }

  if (!ok) {
    const allIds = [
      ...missing.map((d) => d.entityId),
      ...disconnected.map((d) => d.entityId),
      ...forked.map((d) => d.entityId),
    ]
    const summary = formatDriftSummary(report)
    pipelineEvents.publish({
      type: "pipeline:drift",
      pipelineId,
      stageName,
      driftedEntityIds: allIds,
      summary,
    })
  }

  return report
}

function formatDriftSummary(report: DriftReport): string {
  const parts: string[] = []
  if (report.missing.length > 0) parts.push(`${report.missing.length} missing`)
  if (report.disconnected.length > 0) parts.push(`${report.disconnected.length} disconnected`)
  if (report.forked.length > 0) parts.push(`${report.forked.length} forked`)
  return `Canvas drift: ${parts.join(", ")} → recommended: ${report.recommendedAction}`
}

/**
 * Collects the entity IDs an upcoming stage will reference. Phase 1B.4 v1:
 * the union of every entity produced by completed stages (every approved
 * stage's entities are fair game for the new stage to consume). Future
 * refinement (Phase 1D) can scope this per-stage so e.g. Stage 6 only
 * checks scene-relevant entities.
 */
export async function getStageExpectedEntityIds(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<string[]> {
  const { data: completedStages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("status", "approved")
  type StageRow = { id: string }
  const stageIds = ((completedStages ?? []) as StageRow[]).map((s) => s.id)
  if (stageIds.length === 0) return []

  const { data } = await supabase
    .from("pipeline_entities")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .in("stage_id", stageIds)
  type EntityRow = { id: string }
  return ((data ?? []) as EntityRow[]).map((e) => e.id)
}
