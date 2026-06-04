import type { SceneNodeType, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { resolveVideoProviderForMode } from "@nodaro/shared"
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

  // Migrate node types + data fields. Runs for every node whose FINAL type is
  // generate-video — converted i2v/t2v nodes AND pre-existing generate-video
  // nodes — so split-id provider normalization (below) covers both. Cheap:
  // unrelated nodes return unchanged.
  const migratedNodes = nodes.map((n) => {
    const converting = targetIds.has(n.id)
    if (!converting && n.type !== "generate-video") return n
    const data = { ...(n.data as Record<string, unknown> ?? {}) }
    if (converting) {
      if (data.connectedRefImageOrder != null && data.referenceImageOrder == null) {
        data.referenceImageOrder = data.connectedRefImageOrder
      }
      delete data.connectedRefImageOrder
      delete data.seedance2InputMode
      if (data.kling3Mode != null && data.mode == null) data.mode = data.kling3Mode
      if (data.kling3Sound != null && data.sound == null) data.sound = data.kling3Sound
      delete data.kling3Mode
      delete data.kling3Sound
    }
    // Split-id models (Grok Imagine 1, Wan 2.6/2.7) collapse to one unified-picker
    // row keyed by the base (i2v) id; a node may still carry the now-hidden t2v
    // twin (grok/wan/wan-2.7-t2v). Normalize it to the base id so the picker shows
    // the right model. resolveVideoProviderForMode(_, "image-to-video") returns the
    // i2v/base id for aliased providers and is a no-op otherwise; execution stays
    // mode-correct (re-resolved by image presence at run time).
    if (typeof data.provider === "string") {
      const baseProvider = resolveVideoProviderForMode(data.provider, "image-to-video")
      if (baseProvider !== data.provider) data.provider = baseProvider
    }
    return { ...n, type: "generate-video" as SceneNodeType, data }
  })

  if (targetIds.size === 0) return { nodes: migratedNodes, edges: [...edges] }

  const nodeTypeById = new Map<string, string>(nodes.map((n) => [n.id, n.type ?? ""]))

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
