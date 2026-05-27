import type { SceneNodeType, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { classifyUpstreamForGenerateImage } from "./generate-image-handles"

export interface VideoMigrationResult {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
}

const TARGET_TYPES = new Set(["image-to-video", "text-to-video"])

const HANDLE_RENAMES: Record<string, string> = {
  "references": "imageReferences",
  "reference-images": "imageReferences",
  "reference-videos": "videoReferences",
  "reference-audio": "audioReferences",
  "in": "prompt",
}

/**
 * One-way migration: rewrite image-to-video AND text-to-video nodes to
 * generate-video. Migrates handle ids and normalizes legacy data fields
 * (connectedRefImageOrder, seedance2InputMode, kling3Mode/Sound). Idempotent.
 */
export function migrateGenerateVideoNodes(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): VideoMigrationResult {
  const targetIds = new Set<string>()
  for (const n of nodes) if (n.type && TARGET_TYPES.has(n.type)) targetIds.add(n.id)
  if (targetIds.size === 0) return { nodes: [...nodes], edges: [...edges] }

  const nodeTypeById = new Map<string, string>(nodes.map((n) => [n.id, n.type ?? ""]))

  // Migrate node types + data fields
  const migratedNodes = nodes.map((n) => {
    if (!targetIds.has(n.id)) return n
    const data = { ...(n.data as Record<string, unknown> ?? {}) }
    if (data.connectedRefImageOrder != null && data.referenceImageOrder == null) {
      data.referenceImageOrder = data.connectedRefImageOrder
    }
    delete data.connectedRefImageOrder
    delete data.seedance2InputMode
    if (data.kling3Mode != null && data.mode == null) data.mode = data.kling3Mode
    if (data.kling3Sound != null && data.sound == null) data.sound = data.kling3Sound
    delete data.kling3Mode
    delete data.kling3Sound
    return { ...n, type: "generate-video" as SceneNodeType, data }
  })

  // Migrate edges
  const migratedEdges = edges.map((e) => {
    if (!targetIds.has(e.target)) return e
    const handle = e.targetHandle
    if (!handle) return e
    if (handle === "cinematography" || handle === "style") {
      const srcType = nodeTypeById.get(e.source) ?? ""
      const classified = classifyUpstreamForGenerateImage(srcType)
      const newHandle = classified === "look" || classified === "elements" ? classified : "look"
      return { ...e, targetHandle: newHandle }
    }
    const renamed = HANDLE_RENAMES[handle]
    if (renamed) return { ...e, targetHandle: renamed }
    return e
  })

  return { nodes: migratedNodes, edges: migratedEdges }
}
