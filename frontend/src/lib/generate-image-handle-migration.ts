import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import {
  classifyUpstreamForGenerateImage,
  TEXT_PRODUCER_TYPES,
  IMAGE_PRODUCER_TYPES,
  IDENTITY_TYPES,
} from "./generate-image-handles"

export interface MigrationResult {
  readonly edges: WorkflowEdge[]
  readonly pickerEdgesMigrated: number
}

/**
 * One-way migration: re-route edges targeting `generate-image` nodes from the
 * legacy `in` / `cinematography` / `null` handles to the new typed handles.
 *
 * Goal: zero runtime behavior change. The backend resolver
 * (payload-builder.ts case "generate-image") classifies by source node type
 * regardless of which target handle the edge uses, so re-labeling is purely
 * cosmetic at execution time.
 *
 * Idempotent: re-running on already-migrated edges is a no-op.
 */
export function migrateGenerateImageHandles(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): MigrationResult {
  const genImageIds = new Set(nodes.filter((n) => n.type === "generate-image").map((n) => n.id))
  if (genImageIds.size === 0) return { edges: [...edges], pickerEdgesMigrated: 0 }

  const nodeTypeById = new Map<string, string>(nodes.map((n) => [n.id, (n.type ?? "") as string]))
  let pickerEdgesMigrated = 0

  const migrated = edges.map((e) => {
    if (!genImageIds.has(e.target)) return e
    const sourceType = nodeTypeById.get(e.source)
    if (!sourceType) return e

    // v2.1: split the legacy `cinematography` / `style` handle into `look`
    // and `elements`, classifying by picker family. Non-picker sources
    // (rare on this handle) fall back to "look".
    if (e.targetHandle === "cinematography" || e.targetHandle === "style") {
      const classified = classifyUpstreamForGenerateImage(sourceType)
      const newHandle = classified === "look" || classified === "elements" ? classified : "look"
      return { ...e, targetHandle: newHandle }
    }

    // v2.1: rename `subjects` → `assets` for identity refs.
    if (e.targetHandle === "subjects") {
      return { ...e, targetHandle: "assets" }
    }

    if (e.targetHandle === "in" || e.targetHandle == null) {
      const newHandle = classifyUpstreamForGenerateImage(sourceType)
      const isPicker =
        !TEXT_PRODUCER_TYPES.has(sourceType) &&
        !IMAGE_PRODUCER_TYPES.has(sourceType) &&
        !IDENTITY_TYPES.has(sourceType)
      if (isPicker) pickerEdgesMigrated++
      return { ...e, targetHandle: newHandle }
    }

    return e
  })

  return { edges: migrated, pickerEdgesMigrated }
}
