import { canonicalVideoProvider } from "@nodaro/shared/models"

/**
 * Minimal structural shape this helper reads. Intentionally has NO string index
 * signature so concrete node types (e.g. `SimpleNode`) satisfy `T extends RawNode`
 * and flow through with their exact element type preserved (pass-through). The
 * helper only ever reads `type` + `data`; every other field is copied verbatim.
 */
interface RawNode {
  type?: string
  data?: unknown
}

/**
 * A node whose `data.provider` names a retired video model
 * (`RETIRED_VIDEO_PROVIDERS`) carries the model it runs as instead. Copies on
 * rewrite; any other node passes through by reference. Applied at load
 * ({@link migrateLegacyNodeType}) and again in `buildPayload`, which also sees
 * a provider a FieldMapping or an app input wrote at run time.
 */
export function withRunningVideoProvider<T extends RawNode>(node: T): T {
  const data = node.data as Record<string, unknown> | undefined
  const provider = data?.provider
  const runsAs = canonicalVideoProvider(provider)
  return runsAs === provider ? node : ({ ...node, data: { ...data, provider: runsAs } } as T)
}

/**
 * Normalize a SINGLE legacy node type to its canonical form, BEFORE the
 * execution engine reads `node.type`. Idempotent. Single source of truth for the
 * load-time migration — shared by the orchestrator, sub-workflow handler,
 * app-input extraction, and the api-token routes (and re-exported from
 * execution-graph.ts under the same name). Mirrors the frontend load migrations.
 *  - edit-image → modify-image / remove-background / upscale-image (by provider)
 *  - image-to-image → modify-image
 *  - collect (no `order[]`) → reduce   (old fan-in reducer; see migration 151)
 *  - loop → list                       (Table → canonical List; see DB sweep)
 *  - a retired video provider → the model it runs as ({@link withRunningVideoProvider})
 *
 * Non-mutating: copies on rewrite, passes untouched nodes through by reference.
 */
export function migrateLegacyNodeType<T extends RawNode>(rawNode: T): T {
  const node = withRunningVideoProvider(rawNode)
  if (node.type === "edit-image") {
    const provider = (node.data as Record<string, unknown> | undefined)?.provider as string | undefined
    if (provider === "nano-banana-edit") return { ...node, type: "modify-image" } as T
    if (provider === "recraft-remove-bg") return { ...node, type: "remove-background" } as T
    return { ...node, type: "upscale-image" } as T
  }
  if (node.type === "image-to-image") return { ...node, type: "modify-image" } as T
  // Backward-compat shim: dev's old "collect" (fan-in reducer) was renamed
  // to "reduce" on 2026-05-23 to free the "collect" name for the NEW
  // type-aggregator. Discriminate via the NEW shape: NEW Collect always has
  // `order: string[]`. Anything else with type === "collect" is the OLD
  // pre-rename fan-in reducer (see migration 151).
  if (node.type === "collect" && !Array.isArray((node.data as { order?: unknown })?.order)) {
    return { ...node, type: "reduce" } as T
  }
  // The legacy "loop" (Table) node was folded into the canonical "list" node.
  if (node.type === "loop") return { ...node, type: "list" } as T
  return node
}

/**
 * Array form of {@link migrateLegacyNodeType}: maps the per-node migration over
 * every node, preserving each element's exact type (pass-through).
 */
export function normalizeLegacyNodeTypes<T extends RawNode>(nodes: ReadonlyArray<T>): T[] {
  return nodes.map((node) => migrateLegacyNodeType(node))
}
