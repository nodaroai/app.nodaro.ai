/**
 * Putting one of the user's files onto a node.
 *
 * Lifted out of `edit-workflow.ts` so the writer stays a pipeline: what a
 * file is allowed to do to a node is one concern, and the order of the write
 * is another. Everything here is called FROM `prepare()` — see the comments
 * there for why each step sits where it does.
 */
import type { GenericNode } from "@nodaro/shared"
import { EditRejected } from "./edit-rejected.js"
import type { ResolvedAsset } from "./asset-refs.js"
import {
  ASSET_SLOT_KIND,
  assetStamp,
  carryStoredMedia,
  changedAssetId,
  isAssetSlot,
  unresolvedMessage,
  wrongKindMessage,
  wrongSpellingMessage,
} from "./asset-slots.js"
// Type-only, so the cycle back to the writer is erased at compile time.
import type { EditWorkflowArgs, StoredGraph, WiredAsset } from "./edit-workflow.js"
/**
 * Refuse any spelling of "use this file" other than the one that works.
 *
 * A model that invents its own — an object in `data.url`, a `$asset` wrapper —
 * would otherwise have it persisted and read by nobody, and the node would sit
 * empty with no error anywhere. The same silence `assetId` was chosen to end,
 * arriving through the back door.
 */
export function rejectInventedFileSyntax(
  nodeType: string | undefined,
  nodeId: string,
  data: Record<string, unknown>,
): void {
  for (const key of ["url", "r2Url", "externalUrl", "thumbnailUrl"]) {
    const value = data[key]
    if (value === undefined || typeof value === "string") continue
    throw new EditRejected(wrongSpellingMessage(String(nodeType ?? nodeId), `"${key}"`))
  }
  if (data.assetId !== undefined && typeof data.assetId !== "string") {
    throw new EditRejected(wrongSpellingMessage(String(nodeType ?? nodeId), '"assetId"'))
  }
  if (typeof data.assetId === "string" && data.assetId.length > 0 && !isAssetSlot(nodeType)) {
    throw new EditRejected(
      `A "${nodeType}" node does not take a file. Add an upload-image / upload-video / upload-audio node with the assetId and wire an edge from it.`,
    )
  }
}

/**
 * Every file id this call would newly point at, in call order.
 *
 * Read from the ARGS and from the STORED graph, both of which are fixed for the
 * whole tool call — so this is resolved ONCE, before the CAS loop, and a retry
 * does not pay for it again.
 */
export function collectAssetIds(args: EditWorkflowArgs, stored: StoredGraph): string[] {
  const byId = new Map(stored.nodes.map((n) => [n.id, n.data as Record<string, unknown> | undefined]))
  const ids: string[] = []
  for (const input of args.upsertNodes ?? []) {
    if (!isAssetSlot(input.type)) continue
    const id = changedAssetId(byId.get(input.id), (input.data ?? {}) as Record<string, unknown>)
    if (id) ids.push(id)
  }
  for (const patch of args.patchNodes ?? []) {
    const stored_ = byId.get(patch.id)
    if (!stored_) continue
    const merged = { ...stored_, ...((patch.data ?? {}) as Record<string, unknown>) }
    const id = changedAssetId(stored_, merged)
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

/**
 * Write each resolved file onto its node.
 *
 * Runs per CAS attempt, against THIS attempt's stored graph, because whether an
 * assetId is a CHANGE — and whether the node is still a type that takes one —
 * are both questions about the graph, and a concurrent writer can move either
 * between attempts. Only the id→file lookup is hoisted out of the loop; it
 * reads the args, which cannot move.
 */
export function stampAssetRefs(
  upserts: GenericNode[],
  existingById: Map<string, GenericNode>,
  assets: ReadonlyMap<string, ResolvedAsset>,
): { nodes: GenericNode[]; wiredNodeIds: Set<string>; wiredAssets: WiredAsset[] } {
  const wiredNodeIds = new Set<string>()
  const wiredAssets: WiredAsset[] = []
  const unresolved: string[] = []
  const nodes = upserts.map((node) => {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (!isAssetSlot(node.type)) return node
    const storedData = existingById.get(node.id)?.data as Record<string, unknown> | undefined
    const id = changedAssetId(storedData, data)
    if (!id) {
      // Not a change — but an upsert replaces the node whole, so the file it
      // already has has to be carried across or this edit destroys it.
      const carried = carryStoredMedia(storedData, data)
      return carried === data ? node : ({ ...node, data: carried } as GenericNode)
    }

    const asset = assets.get(id)
    if (!asset) {
      unresolved.push(id)
      return node
    }
    const want = ASSET_SLOT_KIND[String(node.type)]
    if (asset.kind !== want) throw new EditRejected(wrongKindMessage(id, asset.kind, String(node.type)))

    wiredNodeIds.add(node.id)
    wiredAssets.push({ id: asset.id, kind: asset.kind, filename: asset.filename, nodeId: node.id })
    return { ...node, data: { ...data, ...assetStamp(asset) } } as GenericNode
  })
  if (unresolved.length > 0) throw new EditRejected(unresolvedMessage([...new Set(unresolved)]))
  return { nodes, wiredNodeIds, wiredAssets }
}
