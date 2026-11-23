/**
 * The downloadable copy a view link offers: the workflow as the owner's
 * export would write it (`GET /v1/workflows/:id/export`, the same
 * `WorkflowExport` shape, so the import route takes it as it is), FROZEN when
 * the owner saves it. Viewers download this copy, never the live workflow,
 * until the owner saves it again (decided 2026-11-23).
 *
 * Built from the PUBLIC projection (project.ts), never the owner's raw graph:
 * a copy handed to strangers carries nothing the canvas would hide. As the
 * export button does, the owner chooses whether it carries the characters,
 * locations, objects and creatures the workflow uses (`includeAssets`); with
 * them it keeps the canvas's results, without them it is a clean template
 * (`stripExportContent`). Of the settings it carries only what the canvas's
 * nodes read (`publicSettings`), and it bundles only the entities the shown
 * nodes and those settings name; the entities go through the same scrub.
 */
import { stripExportContent, type WorkflowExport } from "@nodaro/shared/workflow"
import { collectAssetIds, fetchExportAssets, workflowExportSchema } from "../workflow-assets.js"
import { projectWorkflowView, scrubPublicValue } from "./project.js"
import type { ViewedWorkflow } from "./store.js"

/** The most a saved copy may weigh (its JSON): a copy beyond it is refused, never cut. */
export const VIEW_EXPORT_MAX_BYTES = 8 * 1024 * 1024

export type ViewExportResult =
  | { readonly ok: true; readonly snapshot: WorkflowExport }
  | { readonly ok: false; readonly reason: "too_large" }

export async function buildViewExport(workflow: ViewedWorkflow, includeAssets: boolean, now: Date = new Date()): Promise<ViewExportResult> {
  const projection = await projectWorkflowView({
    nodes: workflow.nodes,
    edges: workflow.edges,
    settings: workflow.settings,
    ownerId: workflow.user_id,
  })
  type Nodes = WorkflowExport["nodes"]
  const shownNodes = projection.nodes as unknown as Nodes
  const nodes = includeAssets ? shownNodes : (stripExportContent(shownNodes) as Nodes)
  // Only the settings the canvas reads (project.ts `publicSettings`), scrubbed like the nodes.
  const settings = projection.settings
  const base: WorkflowExport = {
    version: 1,
    exportedAt: now.toISOString(),
    name: workflow.name.slice(0, 200) || "Workflow",
    nodes,
    edges: projection.edges as unknown as WorkflowExport["edges"],
    settings,
  }
  let snapshot = base
  if (includeAssets) {
    const ids = collectAssetIds(projection.nodes as unknown as Record<string, unknown>[], settings)
    // The OWNER's entities, as the owner's own export bundles them.
    const assets = await fetchExportAssets(ids, workflow.user_id)
    if ("error" in assets) throw new Error(`Failed to read the workflow's entities: ${assets.error}`)
    snapshot = { ...base, assets: scrubPublicValue(assets) }
  }
  // The import route's own schema: a copy it would refuse is a bug here, never a file handed out.
  const parsed = workflowExportSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error(`The saved copy does not match the export shape: ${parsed.error.issues[0]?.message ?? "invalid"}`)
  if (Buffer.byteLength(JSON.stringify(snapshot)) > VIEW_EXPORT_MAX_BYTES) return { ok: false, reason: "too_large" }
  return { ok: true, snapshot }
}
