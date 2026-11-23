/** OpenAPI entries for a workflow's view link, the owner's side (routes in `workflow-view-links.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { enableViewLinkBody, saveViewExportBody, updateViewLinkBody, viewWorkflowParams } from "../lib/workflow-view/schemas.js"
import { ViewLinkStateSchema } from "./workflow-view-link-schemas-docs.js"

const security = [{ bearerAuth: [] }]
const ok = { description: "OK", content: { "application/json": { schema: ViewLinkStateSchema } } }
const common = {
  401: { description: "Unauthorized" },
  404: { description: "Not found, or not a workflow you created" },
  503: { description: "`not_available`: view links are not on this server yet" },
}
const refused = {
  description: "`share_not_allowed`: `reason` is `workspace` (work in a workspace cannot be shared by link) or `sharing_disabled` (this server does not allow public work).",
}

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/workflows/{id}/view-link",
  description: "The state of the workflow's view link: a read-only page of its canvas that anyone holding the link can open without signing in. Creator only.",
  security,
  request: { params: viewWorkflowParams },
  responses: { 200: ok, ...common },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/view-link",
  description:
    "Turn the view link on (idempotent: calling it again returns the same link). The view is `/view/<token>`; the embed, for an iframe on another site, is `/embed/view/<token>`. `locale` (optional) is the interface language: the link's preview card is written in it. Separate from the presentation link, which lets a viewer run the workflow. Creator only.",
  security,
  request: { params: viewWorkflowParams, body: { content: { "application/json": { schema: enableViewLinkBody } } } },
  responses: { 200: ok, 422: refused, ...common },
})

openApiRegistry.registerPath({
  method: "patch",
  path: "/v1/workflows/{id}/view-link",
  description: "Whether search engines may index the view (on by default). Creator only.",
  security,
  request: { params: viewWorkflowParams, body: { content: { "application/json": { schema: updateViewLinkBody } } } },
  responses: { 200: ok, ...common },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/view-link/export",
  description:
    "Save a copy of the workflow for viewers to download and import into their own account. The copy is frozen: viewers get this copy, not later edits, until it is saved again. It carries what the view shows (no secrets, no destinations). Creator only.",
  security,
  request: { params: viewWorkflowParams, body: { content: { "application/json": { schema: saveViewExportBody } } } },
  responses: {
    200: ok,
    413: { description: "`export_too_large`: the workflow is too large to offer as a download" },
    422: refused,
    ...common,
  },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/workflows/{id}/view-link/export",
  description: "Stop offering the downloadable copy. Creator only.",
  security,
  request: { params: viewWorkflowParams },
  responses: { 200: ok, ...common },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/workflows/{id}/view-link",
  description: "Turn the view link off: the link, its embed and its download stop answering. Turning it on again makes a new link. Creator only.",
  security,
  request: { params: viewWorkflowParams },
  responses: { 200: { description: "OK", content: { "application/json": { schema: z.object({ enabled: z.literal(false) }) } } }, ...common },
})
