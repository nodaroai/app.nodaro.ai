/** Request schemas of `/v1/sessions` — shared by the routes and their OpenAPI entries. */
import { z } from "zod"
import { TOOL_RE } from "./generation-sessions.js"

export const idParams = z.object({ id: z.string().uuid() })
export const itemParams = z.object({ id: z.string().uuid(), jobId: z.string().uuid() })

export const createSessionBody = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  tool: z.string().regex(TOOL_RE, "tool: lowercase letters, digits and dashes, at most 40"),
})

export const updateSessionBody = z
  .object({
    title: z.string().trim().min(1).max(200).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((d) => d.title !== undefined || d.archived !== undefined, {
    message: "At least one field must be provided",
  })

export const listSessionsQuery = z.object({
  projectId: z.string().uuid().optional(),
  tool: z.string().regex(TOOL_RE).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
})

export const listItemsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
})

export const importItemsBody = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(100),
})
