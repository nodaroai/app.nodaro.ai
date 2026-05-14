/**
 * Character Studio → workflow canvas helpers.
 *
 * Two small effects shared by the asset-grid tabs (Expressions / Poses /
 * Motions / Appearance sub-sections):
 *  - `injectAssetAsCanvasNode` creates a new `upload-image` (or
 *    `upload-video`) node next to the source character node, pre-filled
 *    with the asset's URL + name. The studio modal stays open after the
 *    call so users can inject multiple assets in one session.
 *  - `setCharacterNodeDefaultAsset` toggles which asset is the character
 *    node's canvas thumbnail (per-canvas-node, NOT per-character-DB-row).
 *
 * Both are pure imperative ops on the workflow store — kept here so tabs
 * don't grow another local dependency on `useWorkflowStore.getState()`.
 */

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CharacterNodeData } from "@/types/nodes"
import type { AssetCardItem } from "./asset-card"

interface InjectOpts {
  /** Source character node id — drives placement of the new upload node. */
  sourceCharacterNodeId: string
  item: AssetCardItem
  /** When true the new node is `upload-video`; otherwise `upload-image`. */
  isVideo: boolean
}

export function injectAssetAsCanvasNode({ sourceCharacterNodeId, item, isVideo }: InjectOpts): void {
  const store = useWorkflowStore.getState()
  const source = store.nodes.find((n) => n.id === sourceCharacterNodeId)
  // Drop the new node 320px to the right of the character node by default;
  // fall back to a sensible canvas-origin offset if we can't locate the
  // source (unexpected — the modal can't open without it).
  const position = source
    ? { x: source.position.x + 320, y: source.position.y }
    : { x: 100, y: 100 }
  // Pre-fill the relevant URL field — the rest of the upload-image /
  // upload-video data shape is initialized from the node's factory
  // defaults via `addNode(type, position, initialData)`.
  const nodeType = isVideo ? "upload-video" : "upload-image"
  const initialData: Record<string, unknown> = {
    label: item.name || (isVideo ? "Imported motion" : "Imported asset"),
    url: item.url,
    externalUrl: item.url,
  }
  const id = store.addNode(nodeType, position, initialData)
  if (!id) {
    toast.error("Could not add node — workflow store rejected the create.")
    return
  }
  toast.success("Added to canvas")
}

/**
 * Toggle the character node's default asset URL / name. Clicking the active
 * default clears it back to `sourceImageUrl`; clicking a different card swaps
 * to that one. The studio's `patch()` mirrors the change to the workflow
 * store (canvas-side) AND tracks dirty fields for the debounced save — but
 * `defaultAssetUrl` is intentionally NOT in `DIRTY_TRACKED_FIELDS` since it's
 * a frontend-only field. The mirror to the workflow store is enough for it
 * to persist with the workflow JSON.
 */
export function setCharacterNodeDefaultAsset(
  staged: CharacterNodeData,
  patch: (p: Partial<CharacterNodeData>) => void,
  item: AssetCardItem,
): void {
  const isUnsetting = staged.defaultAssetUrl === item.url
  patch(
    isUnsetting
      ? { defaultAssetUrl: undefined, defaultAssetName: undefined }
      : { defaultAssetUrl: item.url, defaultAssetName: item.name },
  )
}
