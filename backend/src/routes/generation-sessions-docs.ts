/** OpenAPI entries for `/v1/sessions` (routes in `generation-sessions.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import {
  createSessionBody,
  idParams,
  importItemsBody,
  itemParams,
  listItemsQuery,
  listSessionsQuery,
  updateSessionBody,
} from "../lib/generation-sessions-schemas.js"

const Session = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable().describe("Fixed at creation. Null when the session has no project, or its project was deleted."),
  title: z.string().nullable().describe("Null = untitled; a UI may fall back to the first prompt."),
  tool: z.string().describe("The creation tool that owns the session, e.g. `create-image`."),
  createdAt: z.string(),
  updatedAt: z.string().describe("The session's latest activity: an item added, or an edit."),
  archivedAt: z.string().nullable(),
  itemCount: z.number().int(),
  previewUrls: z.array(z.string()).describe("Up to four image links of the newest completed items."),
})

const SessionItem = z.object({
  jobId: z.string().uuid(),
  addedAt: z.string(),
  imported: z.boolean().describe("True when the item was imported from elsewhere rather than born in this session."),
  importedFrom: z.object({ sessionId: z.string().uuid(), title: z.string().nullable() }).nullable(),
  job: z.unknown().describe("The job, in the same shape `GET /v1/jobs/{id}` returns."),
})

const security = [{ bearerAuth: [] }]
const notFound = { description: "Not found (or not yours)" }
const unauthorized = { description: "Unauthorized" }

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/sessions",
  description:
    "Create a generation session, optionally inside one of your projects. Send its id as `sessionId` on a generation request (generate-image, generate-video, text-to-speech, music, …) and the job is born in it.",
  security,
  request: { body: { content: { "application/json": { schema: createSessionBody } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.object({ data: Session }) } } },
    401: unauthorized,
    404: { description: "Project not found" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/sessions",
  description: "List your sessions, newest first. Archived ones are left out unless `includeArchived=true`.",
  security,
  request: { query: listSessionsQuery },
  responses: {
    200: {
      description: "A page of sessions",
      content: { "application/json": { schema: z.object({ data: z.array(Session), next: z.string().nullable() }) } },
    },
    401: unauthorized,
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/sessions/{id}",
  description: "Get one session.",
  security,
  request: { params: idParams },
  responses: {
    200: { description: "The session", content: { "application/json": { schema: z.object({ data: Session }) } } },
    401: unauthorized,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "patch",
  path: "/v1/sessions/{id}",
  description: "Rename (or untitle with null) or archive a session. Its project cannot change.",
  security,
  request: { params: idParams, body: { content: { "application/json": { schema: updateSessionBody } } } },
  responses: {
    200: { description: "The session", content: { "application/json": { schema: z.object({ data: Session }) } } },
    401: unauthorized,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/sessions/{id}",
  description: "Delete a session and its links. Its jobs are kept, and stay in every other session that holds them.",
  security,
  request: { params: idParams },
  responses: { 200: { description: "Deleted" }, 401: unauthorized, 404: notFound },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/sessions/{id}/items",
  description: "The session's items, born-in and imported, newest first.",
  security,
  request: { params: idParams, query: listItemsQuery },
  responses: {
    200: {
      description: "A page of items",
      content: { "application/json": { schema: z.object({ data: z.array(SessionItem), next: z.string().nullable() }) } },
    },
    401: unauthorized,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/sessions/{id}/items",
  description:
    "Import some of your own jobs into the session — a link, not a copy. All-or-nothing: if any id is not one of your jobs, nothing is imported (404). Items already in the session are left as they are.",
  security,
  request: { params: idParams, body: { content: { "application/json": { schema: importItemsBody } } } },
  responses: {
    201: {
      description: "Imported",
      content: { "application/json": { schema: z.object({ data: z.object({ imported: z.number().int(), requested: z.number().int() }) }) } },
    },
    401: unauthorized,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/sessions/{id}/items/{jobId}",
  description: "Remove one item from the session. Only the link is removed: the job, and every other session holding it, are untouched.",
  security,
  request: { params: itemParams },
  responses: { 200: { description: "Removed" }, 401: unauthorized, 404: notFound },
})
