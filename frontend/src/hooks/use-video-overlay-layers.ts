import { useCallback } from "react"
import {
  VIDEO_OVERLAY_HANDLE_IDS,
  applyVideoOverlayPreset,
  expandVideoOverlayLayer,
  toCustomVideoOverlayLayer,
  videoOverlayRenderOrder,
  type VideoOverlayCorner,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayPresetId,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DEFAULT_OVERLAY_LAYER_COUNT, type VideoOverlayData } from "@/types/nodes"

type StoredLayers = ReadonlyArray<VideoOverlayLayerInput | null | undefined>

/**
 * Pure: `layers` with slot `index` replaced by `next`, holes up to it filled
 * with `null` ("no settings" — the default corner badge once wired), so a
 * later handle's layer never shifts index.
 */
export function writeVideoOverlaySlot(
  layers: StoredLayers,
  index: number,
  next: VideoOverlayLayerInput | null,
): Array<VideoOverlayLayerInput | null> {
  const out = Array.from({ length: Math.max(layers.length, index + 1) }, (_, k) => layers[k] ?? null)
  out[index] = next
  return out
}

/**
 * Pure: a slot after an edit. The stored layer (or the default badge for an
 * untouched slot) is expanded, the patch applied, and the result expanded
 * again — so a timing or look edit keeps a preset tag, while any box field
 * that leaves the preset's box clears it (a drag turns a card into Custom
 * silently, UX-7).
 */
export function patchVideoOverlayLayer(current: VideoOverlayLayerInput | null | undefined, patch: VideoOverlayLayerInput): VideoOverlayLayer {
  return expandVideoOverlayLayer({ ...expandVideoOverlayLayer(current), ...patch })
}

/**
 * Pure: move layer `index` one step up (towards the front) or down in the
 * render order, re-stamping the zIndex of every slot that can render — a
 * stored layer, a WIRED slot (`wired`, 0-based; drawn as the default badge,
 * so it materialises as a real layer here) and `index` itself — from its new
 * position. Every other slot is empty and STAYS `null`: it renders nothing,
 * so it takes no part in the order and gets no default layer (the tail trim
 * of `removeLayer` can still shrink it away). null when the move is impossible.
 */
export function reorderVideoOverlayLayers(
  layers: StoredLayers,
  slots: number,
  index: number,
  direction: "up" | "down",
  wired: ReadonlySet<number> = new Set(),
): Array<VideoOverlayLayerInput | null> | null {
  const filled: Array<VideoOverlayLayerInput | null> = Array.from({ length: Math.max(slots, layers.length, index + 1) }, (_, k) => layers[k] ?? null)
  const renders = (k: number) => k === index || filled[k] !== null || wired.has(k)
  // Each slot at its own position (slot = k + 1), as the stage and both engine assemblies order it.
  const order = videoOverlayRenderOrder(filled.map((l, k) => ({ zIndex: l?.zIndex, slot: k + 1 }))).filter(renders)
  const pos = order.indexOf(index)
  const swapWith = direction === "up" ? pos + 1 : pos - 1
  if (pos < 0 || swapWith < 0 || swapWith >= order.length) return null
  const nextOrder = order.map((v, i) => (i === pos ? order[swapWith]! : i === swapWith ? index : v))
  const zOf = new Map(nextOrder.map((layerIndex, z) => [layerIndex, z]))
  return filled.map((l, k) => {
    const z = zOf.get(k)
    return z === undefined ? l : { ...expandVideoOverlayLayer(l), zIndex: z }
  })
}

function readData(nodeId: string): VideoOverlayData | undefined {
  return useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as VideoOverlayData | undefined
}

function readLayers(nodeId: string): StoredLayers {
  const layers = readData(nodeId)?.layers
  return Array.isArray(layers) ? layers : []
}

/** 0-based slots whose layer handle currently has an edge. */
function wiredSlots(nodeId: string): Set<number> {
  return new Set(
    useWorkflowStore
      .getState()
      .edges.filter((e) => e.target === nodeId)
      .map((e) => (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).indexOf(e.targetHandle ?? ""))
      .filter((k) => k >= 0),
  )
}

/**
 * The ONE place the canvas writes a Video Overlay node's `layers[]` — the
 * stage, the layer cards and the timeline all go through it, so a preset tag,
 * a filled hole or a trimmed tail can never mean two different things. (The
 * store's `onConnect` is the only other writer: it clears a slot's imageUrl
 * when its handle is wired — D3.)
 */
export function useVideoOverlayLayers(nodeId: string) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const writeSlot = useCallback(
    (index: number, next: (current: VideoOverlayLayerInput | null | undefined) => VideoOverlayLayerInput) => {
      const list = readLayers(nodeId)
      updateNodeData(nodeId, { layers: writeVideoOverlaySlot(list, index, next(list[index])) })
    },
    [nodeId, updateNodeData],
  )

  /** Timing, look or box edit — keeps the preset tag unless the box leaves the preset's. */
  const setLayer = useCallback(
    (index: number, patch: VideoOverlayLayerInput) => writeSlot(index, (current) => patchVideoOverlayLayer(current, patch)),
    [writeSlot],
  )

  /** A preset click: the preset's box REPLACES the six box fields, the tag is set. */
  const applyPreset = useCallback(
    (index: number, preset: VideoOverlayPresetId, corner?: VideoOverlayCorner) =>
      writeSlot(index, (current) => applyVideoOverlayPreset(current, preset, corner)),
    [writeSlot],
  )

  /** "Custom": the tag is cleared, the box kept. */
  const setCustom = useCallback((index: number) => writeSlot(index, (current) => toCustomVideoOverlayLayer(current)), [writeSlot])

  const reorder = useCallback(
    (index: number, direction: "up" | "down", slots: number) => {
      const next = reorderVideoOverlayLayers(readLayers(nodeId), slots, index, direction, wiredSlots(nodeId))
      if (next) updateNodeData(nodeId, { layers: next })
    },
    [nodeId, updateNodeData],
  )

  /**
   * Delete a layer: unwire its handle (the source node stays), empty the slot,
   * trim the empty tail, and shrink the shown handle count to the last slot
   * still in use (never below the default four).
   */
  const removeLayer = useCallback(
    (index: number) => {
      const store = useWorkflowStore.getState()
      const handle = VIDEO_OVERLAY_HANDLE_IDS[index]
      if (handle) {
        for (const e of store.edges.filter((e) => e.target === nodeId && e.targetHandle === handle)) store.deleteEdge(e.id)
      }
      const wired = wiredSlots(nodeId)
      const cleared = writeVideoOverlaySlot(readLayers(nodeId), index, null)
      let keep = 0
      cleared.forEach((l, k) => { if (l !== null || wired.has(k)) keep = k + 1 })
      const layers = cleared.slice(0, keep)
      let highest = -1
      for (let k = 0; k < VIDEO_OVERLAY_HANDLE_IDS.length; k++) if (wired.has(k) || (layers[k] ?? null) !== null) highest = k
      updateNodeData(nodeId, { layers, layerCount: Math.max(DEFAULT_OVERLAY_LAYER_COUNT, highest + 1) })
    },
    [nodeId, updateNodeData],
  )

  return { setLayer, applyPreset, setCustom, reorder, removeLayer }
}
