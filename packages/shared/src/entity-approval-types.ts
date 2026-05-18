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
] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]

export const ENTITY_TYPES = ["character", "object", "location", "scene"] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
