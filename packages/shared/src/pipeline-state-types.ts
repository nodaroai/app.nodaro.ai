import { z } from "zod"

/**
 * Phase 1B.4 — pipeline_state lifecycle + drift event types.
 *
 * `pipeline_state` lives on `pipeline_entity_nodes.pipeline_state` (migration
 * 131). Mirrors the four-value CHECK constraint there.
 *
 * `pipeline_owned_running`           — node belongs to the pipeline, work in flight
 * `pipeline_owned_awaiting_approval` — node belongs to the pipeline, user is the gate
 * `pipeline_owned_approved`          — node belongs to the pipeline, work locked in
 * `pipeline_orphaned`                — pipeline released ownership (cancel / fork / fail);
 *                                      node survives so the user keeps the work
 */
export const PipelineStateSchema = z.enum([
  "pipeline_owned_running",
  "pipeline_owned_awaiting_approval",
  "pipeline_owned_approved",
  "pipeline_orphaned",
])
export type PipelineState = z.infer<typeof PipelineStateSchema>

/**
 * Emitted when a pipeline_entity_nodes row transitions to a new
 * `pipeline_state`. Fires on:
 *   - stage transitioning to 'awaiting_approval' (per-entity batch)
 *   - approveEntity success
 *   - rejectEntity regenerate path
 *   - force-stop / fork orphaning (every entity at once)
 *
 * Frontend swaps node visuals (running glow → awaiting frame → approved chip)
 * based on the new state.
 */
export const EntityStateChangeEventSchema = z.object({
  type: z.literal("entity:state_change"),
  pipelineId: z.string(),
  pipelineEntityId: z.string(),
  newState: PipelineStateSchema,
})
export type EntityStateChangeEvent = z.infer<typeof EntityStateChangeEventSchema>

/**
 * Emitted when a `pipeline_entities.is_stale` flag flips to true via the
 * cascade staleness trigger (migration 131). Triggered after a `main_asset_id`
 * update on an upstream entity; the trigger marks every transitive dependent
 * stale, and the engine emits one event per dependent.
 *
 * Frontend overlays a "Stale — needs regenerate" warning on the affected
 * canvas nodes.
 */
export const EntityStaleEventSchema = z.object({
  type: z.literal("entity:stale"),
  pipelineId: z.string(),
  pipelineEntityId: z.string(),
  reason: z.enum(["upstream_changed", "user_edit", "manual"]).optional(),
})
export type EntityStaleEvent = z.infer<typeof EntityStaleEventSchema>

/**
 * Emitted when a pipeline is force-stopped / forked. Carries the prior status
 * (`forked_status`) so the UI can render "Forked from approval" vs "Forked
 * mid-Stage-5" copy. The companion `entity:state_change` flurry that orphans
 * every node lands in the same SSE batch.
 */
export const PipelineForkedEventSchema = z.object({
  type: z.literal("pipeline:forked"),
  pipelineId: z.string(),
  forkedAt: z.string(), // ISO timestamp
  forkedStatus: z.string(),
  forkReason: z.string().optional(),
})
export type PipelineForkedEvent = z.infer<typeof PipelineForkedEventSchema>

/**
 * Section H drift summary — when the engine pauses a stage at
 * 'awaiting_approval' because user edits on the canvas diverged from the
 * pipeline's recorded state, this payload is attached to the
 * `pipeline_stages.awaiting_reason='canvas_drift'` row so the UI can render
 * the DriftBanner with actionable diffs.
 *
 * Carried inside a `stage:status` event (or a future dedicated event); kept
 * as a standalone schema so callers can validate the drift payload
 * independently.
 */
export const PipelineDriftSummarySchema = z.object({
  type: z.literal("pipeline:drift"),
  pipelineId: z.string(),
  stageName: z.string(),
  driftedEntityIds: z.array(z.string()),
  summary: z.string().optional(),
})
export type PipelineDriftSummary = z.infer<typeof PipelineDriftSummarySchema>

/**
 * Phase 1C.1 — emitted by Stage 8 (post_merge) when the pipeline reaches the
 * `completed` terminal state. Carries the final merged-MP4 asset id + URL so
 * the SSE consumer can render the player without an extra round-trip.
 *
 * Distinct from the legacy `pipeline:done` lifecycle event (which carries no
 * payload). SSE forwarders close on either type.
 */
export const PipelineCompletedEventSchema = z.object({
  type: z.literal("pipeline:completed"),
  pipelineId: z.string(),
  finalOutputAssetId: z.string().uuid().nullable(),
  finalOutputUrl: z.string(),
})
export type PipelineCompletedEvent = z.infer<typeof PipelineCompletedEventSchema>

/**
 * Union of the Phase 1B.4 + 1C.1 lifecycle event payloads. The broader
 * `PipelineEvent` union in `pipeline-events.ts` extends this so SSE
 * forwarders accept all of them transparently.
 */
export type PipelineLifecycleEvent =
  | EntityStateChangeEvent
  | EntityStaleEvent
  | PipelineForkedEvent
  | PipelineDriftSummary
  | PipelineCompletedEvent
