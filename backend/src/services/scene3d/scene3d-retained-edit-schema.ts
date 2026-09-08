import { scene3DV2EditOperationsSchema } from "@nodaro/shared"
import { z } from "zod"

/** Shared validation for route and job-owned retained edits. */
export const retainedScene3DEditBodySchema = z.object({
  newRevisionId: z.uuid(), expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  operations: scene3DV2EditOperationsSchema,
  lockedObjectIds: z.array(z.string().min(1).max(64)).max(100).optional(),
}).strict()
