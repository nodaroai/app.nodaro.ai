/** Request schemas of the share links — shared by the routes and their OpenAPI entries. */
import { z } from "zod"
import { SHARE_KINDS } from "./types.js"

const kind = z.enum(SHARE_KINDS).describe("What is shared: one result (`job`), a generation session, or a project.")
const targetId = z.string().uuid().describe("The id of your job, session or project.")

export const getShareQuery = z.object({ kind, targetId })

export const setShareBody = z.object({
  kind,
  targetId,
  shared: z.boolean().describe("`true` turns the link on (the same token as before, if it was on once); `false` turns it off (the link answers 404)."),
  allowCopy: z
    .boolean()
    .optional()
    .describe("Also give the viewer the reference files the result was made from. Omitted: the link keeps its current value (`false` on a new link)."),
})

export const publicShareParams = z.object({
  token: z.string().min(1).max(200).describe("The share's token (43 characters, base64url)."),
})

export const publicItemsQuery = z.object({
  sessionId: z
    .string()
    .uuid()
    .optional()
    .describe("Required for a shared project: one of the sessions `GET /v1/public/shares/{token}` lists. A shared session needs none."),
  cursor: z.string().max(200).optional().describe("The previous page's `nextCursor`."),
  limit: z.coerce.number().int().min(1).max(100).optional().describe("Page size, 1–100 (default 50)."),
})
