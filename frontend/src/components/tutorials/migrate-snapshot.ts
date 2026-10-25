// Bring a stored snapshot up to today's node/handle shape.
//
// The editor runs these migrations every time it loads a workflow, so what it
// shows is always the MIGRATED graph. A read-only canvas that skips them shows
// something subtly different — and the difference is not cosmetic: React Flow
// silently drops an edge whose handle id no longer exists, so a template saved
// against the old `cinematography` handle rendered with no connections at all
// while the editor drew them fine.
//
// Same functions, same order as `use-workflow-store.ts:loadWorkflow`.

import { migrateListLoopNodes } from "@/lib/list-loop-migration"
import { migrateRetiredVideoProviders } from "@/lib/retired-video-provider-migration"
import { migratePersonNodes } from "@/lib/person-value-migration"
import { migrateGenerateImageHandles } from "@/lib/generate-image-handle-migration"
import { migrateGenerateVideoNodes } from "@/lib/generate-video-handle-migration"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export function migrateSnapshot(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const list = migrateListLoopNodes(migrateRetiredVideoProviders(nodes), edges)
  let migratedNodes = migratePersonNodes(list.nodes)
  let migratedEdges = list.edges

  migratedEdges = migrateGenerateImageHandles(migratedNodes, migratedEdges).edges

  const video = migrateGenerateVideoNodes(migratedNodes, migratedEdges)
  migratedNodes = video.nodes
  migratedEdges = video.edges

  return { nodes: migratedNodes, edges: migratedEdges }
}
