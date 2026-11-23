/** OpenAPI entries for a workflow's view link, the public side (routes in `workflow-views.ts`). */
import { openApiRegistry } from "../lib/openapi-registry.js"
import { viewTokenParams } from "../lib/workflow-view/schemas.js"
import { PublicWorkflowViewSchema } from "./workflow-view-link-schemas-docs.js"

const linkNotFound = { description: "Unknown or turned off" }

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/workflow-views/{token}",
  description:
    "The canvas a workflow's view link shows, read-only: its nodes with their results, prompts and notes, and its edges. Secrets, destinations and restricted media are never included. Takes no credential.",
  security: [],
  request: { params: viewTokenParams },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: PublicWorkflowViewSchema } } },
    404: linkNotFound,
    429: { description: "Too many requests from this network" },
    503: { description: "`not_available`: view links are not on this server yet" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/workflow-views/{token}/export",
  description:
    "The copy of the workflow its owner saved for download, as a file in the export format (`POST /v1/workflows/import` takes it). Takes no credential.",
  security: [],
  request: { params: viewTokenParams },
  responses: {
    200: { description: "The workflow file (attachment)" },
    404: { description: "Unknown, turned off, or no copy is offered" },
    429: { description: "Too many requests from this network" },
    503: { description: "`not_available`: view links are not on this server yet" },
  },
})
