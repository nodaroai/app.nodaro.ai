import { z } from "zod"

/**
 * Body for POST /v1/pipelines/:id/entities/:entity_id/reject.
 * Approve takes no body (optional `edits` future-deferred).
 */
export const EntityRejectInputSchema = z.object({
  feedback: z.string().min(1).max(2000),
})
export type EntityRejectInput = z.infer<typeof EntityRejectInputSchema>

export const ENTITY_STATUSES = [
  "pending",
  "generating",
  "awaiting_approval",
  "approved",
  "rejected",
  "failed",
  // Phase 3 (granular-pipeline-control) — Stage 2 Character Wizard.
  // `pending_description` is the initial state for character entities in
  // manual/guided mode pipelines; the engine waits for the user's Step A
  // approval before generating the portrait. `skipped` is a terminal state
  // for entities the user explicitly opts out of (no generation, excluded
  // from stage-advance gating). Migration: 154_phase_1d3_character_wizard.sql.
  "pending_description",
  "skipped",
] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]

export const ENTITY_TYPES = ["character", "object", "location", "scene"] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
