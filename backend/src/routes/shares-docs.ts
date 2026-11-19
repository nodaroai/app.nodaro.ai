/** OpenAPI entries for the share links (routes in `shares.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { getShareQuery, publicItemsQuery, publicShareParams, setShareBody } from "../lib/share-links/schemas.js"
import { SHARE_KINDS } from "../lib/share-links/types.js"

const Share = z.object({
  token: z.string().describe("The share's token, 43 characters, base64url; the share page is built from it. Never derived from an id."),
  kind: z.enum(SHARE_KINDS),
  targetId: z.string().uuid(),
  shared: z.boolean().describe("False once turned off: the link answers 404 until it is turned on again, with the same token."),
  allowCopy: z.boolean().describe("The viewer also gets the reference files the result was made from."),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const SharedJob = z.object({
  id: z.string().uuid(),
  type: z.string().describe("The job's type, e.g. `generate-image`."),
  mediaKind: z.enum(["image", "video", "audio"]),
  outputUrl: z.string(),
  outputUrls: z.array(z.string()).optional().describe("Every file of that kind, when the job made several."),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  title: z.string().nullable().describe("The owner's name for the result."),
  createdAt: z.string(),
  prompt: z.string().nullable().describe("The prompt as it was written; null for a trend run."),
  negativePrompt: z.string().nullable().optional(),
  model: z.object({ id: z.string(), name: z.string() }).nullable().describe("The public model id and its name."),
  settings: z.record(z.string(), z.unknown()).describe("The settings the result was made with — never an address or an id."),
  references: z
    .array(z.object({ url: z.string(), kind: z.enum(["image", "video", "audio"]) }))
    .optional()
    .describe("Only on a link that allows copying: the files the result was made from."),
  trend: z.object({ slug: z.string(), name: z.string() }).optional().describe("A trend run: its trend, with no prompt or settings."),
})

const PublicShare = z.object({
  kind: z.enum(SHARE_KINDS),
  allowCopy: z.boolean(),
  job: SharedJob.optional(),
  session: z.object({ title: z.string().nullable(), tool: z.string().nullable(), createdAt: z.string(), itemCount: z.number().int() }).optional(),
  project: z
    .object({
      name: z.string(),
      sessions: z.array(
        z.object({ id: z.string().uuid(), title: z.string().nullable(), tool: z.string().nullable(), itemCount: z.number().int(), coverUrl: z.string().nullable() }),
      ),
    })
    .optional(),
})

const security = [{ bearerAuth: [] }]
const notFound = { description: "Not found (or not yours)" }
const linkNotFound = { description: "Unknown, turned off, or its item is gone or may not be shown" }

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/shares",
  description: "The link of one of your items (a job, a generation session or a project), or `null` when it was never shared.",
  security,
  request: { query: getShareQuery },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: z.object({ data: Share.nullable() }) } } },
    401: { description: "Unauthorized" },
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "put",
  path: "/v1/shares",
  description:
    "Turn the link of one of your items on or off. The first call makes the link; turning it on again later brings back the same token. `allowCopy` omitted keeps its current value.",
  security,
  request: { body: { content: { "application/json": { schema: setShareBody } } } },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: z.object({ data: Share }) } } },
    401: { description: "Unauthorized" },
    404: notFound,
    422: {
      description:
        "`share_not_allowed`: the item cannot be shared now. `reason`: `not_completed`, `no_media`, `private_output`, `content_filtered`, `restricted`, `workspace` or `sharing_disabled`.",
    },
    503: { description: "`not_available`: share links are not on this server yet" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/public/shares/{token}",
  description: "What a share link shows: one result, a session's summary or a project's sessions. Takes no credential.",
  request: { params: publicShareParams },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: z.object({ data: PublicShare }) } } },
    404: linkNotFound,
    429: { description: "Too many requests from this network" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/public/shares/{token}/items",
  description:
    "A shared session's results, newest first (a shared project: one of its sessions, by `sessionId`). A page may hold fewer than `limit`; follow `nextCursor` until it is null. Takes no credential.",
  request: { params: publicShareParams, query: publicItemsQuery },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: z.object({ data: z.array(SharedJob), nextCursor: z.string().nullable() }) } },
    },
    400: { description: "`validation_error`: no `sessionId` for a shared project, or a bad cursor" },
    404: linkNotFound,
    429: { description: "Too many requests from this network" },
  },
})
