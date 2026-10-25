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
    /** One of this session's items to lead its previews; null = automatic. */
    coverJobId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.title !== undefined || d.archived !== undefined || d.coverJobId !== undefined, {
    message: "At least one field must be provided",
  })

/** `projectId=none`: the sessions that have no project. */
export const NO_PROJECT = "none"

export const listSessionsQuery = z.object({
  projectId: z
    .union([z.literal(NO_PROJECT), z.string().uuid()])
    .optional()
    .describe("A project's id: its sessions. `none`: the sessions with no project. Absent: all of them."),
  tool: z.string().regex(TOOL_RE).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
})

export const listItemsQuery = z.object({
  /** `true`: the session's removed items (its part of the Trash), newest removal first. */
  removed: z
    .enum(["true", "false"])
    .optional()
    .describe("`true`: the items removed from the session (its part of the Trash), newest removal first."),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
})

export const removeItemQuery = z.object({
  forever: z
    .enum(["true", "false"])
    .optional()
    .describe("`true`: delete the link for good — only an item already removed (409 `not_in_trash` otherwise). The job stays."),
})

export const importItemsBody = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(100),
})

export const moveItemsBody = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(100).describe("Items of `fromSessionId` to move, up to 100."),
  fromSessionId: z.string().uuid().describe("The session they are in now; it keeps them as removed items, so the move can be undone from its Trash."),
})
