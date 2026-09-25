import { clearWiredVideoOverlayImageUrls, videoOverlaySlotOfHandle, type VideoOverlayLayerInput } from "@nodaro/shared"

/**
 * D3 — the node-data patch a new wire into a Video Overlay layer handle
 * implies: that slot's own `imageUrl` is cleared (the wire replaces it), so a
 * stored layer never carries both and disconnecting empties the slot. Called
 * by the workflow store's `onConnect`, the interactive connection path — not
 * a panel effect, which would miss a node whose panel is closed. (Programmatic
 * edge writers — `batchAddNodesAndEdges`, `loadWorkflow`, remote reconcile —
 * do not call it; none targets a Video Overlay layer today, and the run-time
 * merge `wired ?? imageUrl` still makes a wire win there.) `null` when the
 * handle is not a layer handle or nothing changes.
 */
export function videoOverlayConnectPatch(
  data: { readonly layers?: unknown },
  targetHandle: string | null | undefined,
): { layers: Array<VideoOverlayLayerInput | null> } | null {
  const slot = videoOverlaySlotOfHandle(targetHandle)
  if (slot === 0 || !Array.isArray(data.layers)) return null
  const layers = data.layers as Array<VideoOverlayLayerInput | null>
  const next = clearWiredVideoOverlayImageUrls(layers, new Set([slot]))
  return next === layers ? null : { layers: [...next] }
}
