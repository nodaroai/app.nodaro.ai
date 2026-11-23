/** The response shapes of a workflow view link, for the OpenAPI entries (workflow-view-links-docs.ts, workflow-views-docs.ts). */
import { z } from "zod"

const ViewExportState = z
  .object({
    exportedAt: z.string().describe("When the copy was saved. Viewers download this copy until it is saved again."),
    includesAssets: z.boolean(),
  })
  .nullable()

export const ViewLinkStateSchema = z.union([
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    token: z.string().describe("The link's token, 43 characters, base64url; the view page and its embed are built from it."),
    indexable: z.boolean(),
    export: ViewExportState.describe("The downloadable copy of the workflow, or null when none is offered."),
    createdAt: z.string(),
  }),
])

export const PublicWorkflowViewSchema = z.object({
  name: z.string(),
  nodes: z.array(z.record(z.string(), z.unknown())).describe("The canvas's nodes, as the public may see them: no secrets, no destinations, no restricted media."),
  edges: z.array(z.record(z.string(), z.unknown())),
  indexable: z.boolean(),
  export: ViewExportState,
})
