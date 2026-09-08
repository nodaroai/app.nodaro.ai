import { useCallback } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { overlayRenderOrder } from "@/lib/image-overlay-geometry"
import { DEFAULT_OVERLAY_LAYER, OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYERS, type ImageOverlayData, type OverlayLayerConfig } from "@/types/nodes"
import { DEFAULT_OVERLAY_QR, DEFAULT_OVERLAY_SHAPE, DEFAULT_OVERLAY_TEXT, type OverlayLayerKind } from "@nodaro/shared"

/**
 * The ONE place that writes an Image Overlay node's `layers[]` — shared by the
 * node's live preview and the full-screen editor so the two can never drift
 * (they did: the node's reorder sized its stack from the STORED layers and was
 * a silent no-op on a fresh node whose second layer had no settings yet).
 *
 * `handleCount` is the number of layer slots the node currently shows; every
 * write fills the array up to the slot it touches so a later handle's layer
 * never shifts index.
 */
export function useImageOverlayLayers(nodeId: string, handleCount: number) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const setLayer = useCallback(
    (index: number, patch: Partial<OverlayLayerConfig>) => {
      const list = readLayers(nodeId)
      const next = fill(list, Math.max(list.length, index + 1))
      updateNodeData(nodeId, { layers: next.map((l, k) => (k === index ? { ...l, ...patch } : l)) })
    },
    [nodeId, updateNodeData],
  )

  const reorder = useCallback(
    (index: number, direction: "up" | "down") => {
      const list = readLayers(nodeId)
      const filled = fill(list, Math.min(OVERLAY_MAX_LAYERS, Math.max(list.length, handleCount, index + 1)))
      const next = reorderLayers(filled, index, direction)
      if (next) updateNodeData(nodeId, { layers: next })
    },
    [handleCount, nodeId, updateNodeData],
  )

  /**
   * Add a generated layer (text / qr / shape) in the first free slot — one
   * with no wire and no kind of its own — growing the shown handle count to
   * cover it. Returns the slot, or null when every slot is taken.
   */
  const addGenerated = useCallback(
    (kind: Exclude<OverlayLayerKind, "image">, wiredSlots: ReadonlyArray<boolean>) => {
      const list = readLayers(nodeId)
      const slot = freeOverlaySlot(list, wiredSlots)
      if (slot === null) return null
      const next = fill(list, Math.max(list.length, slot + 1))
      const shown = readLayerCount(nodeId)
      updateNodeData(nodeId, {
        layers: next.map((l, k) => (k === slot ? generatedLayer(kind) : l)),
        layerCount: Math.max(handleCount, shown, slot + 1),
      })
      return slot
    },
    [handleCount, nodeId, updateNodeData],
  )

  /**
   * Delete a layer: unwire whatever feeds its handle (the source node stays on
   * the canvas), turn the slot back into an empty image slot, and shrink the
   * shown handle count to the last slot that still carries something (never
   * below the default four). The stored array is trimmed the same way so the
   * empty tail does not keep the handles alive.
   */
  const removeLayer = useCallback(
    (index: number) => {
      const store = useWorkflowStore.getState()
      const handle = OVERLAY_HANDLE_IDS[index]
      for (const e of store.edges.filter((e) => e.target === nodeId && e.targetHandle === handle)) store.deleteEdge(e.id)
      const wired = new Set(
        useWorkflowStore
          .getState()
          .edges.filter((e) => e.target === nodeId)
          .map((e) => (OVERLAY_HANDLE_IDS as readonly string[]).indexOf(e.targetHandle ?? ""))
          .filter((k) => k >= 0),
      )
      const cleared = readLayers(nodeId).map((l, k) => (k === index ? DEFAULT_OVERLAY_LAYER : l))
      const occupied = (l: OverlayLayerConfig | undefined, k: number) => wired.has(k) || (!!l && l.kind !== undefined && l.kind !== "image")
      const isDefault = (l: OverlayLayerConfig) => JSON.stringify(l) === DEFAULT_LAYER_JSON
      let keep = 0
      cleared.forEach((l, k) => { if (occupied(l, k) || !isDefault(l)) keep = k + 1 })
      const layers = cleared.slice(0, keep)
      let highest = -1
      for (let k = 0; k < OVERLAY_MAX_LAYERS; k++) if (occupied(layers[k], k)) highest = k
      updateNodeData(nodeId, { layers, layerCount: Math.max(4, highest + 1) })
    },
    [nodeId, updateNodeData],
  )

  return { setLayer, reorder, addGenerated, removeLayer }
}

/** First slot that is neither wired nor already a generated layer. */
export function freeOverlaySlot(layers: ReadonlyArray<OverlayLayerConfig>, wiredSlots: ReadonlyArray<boolean>): number | null {
  for (let i = 0; i < OVERLAY_MAX_LAYERS; i++) {
    if (wiredSlots[i]) continue
    const l = layers[i]
    if (!l || l.kind === undefined || l.kind === "image") return i
  }
  return null
}

/** A fresh generated layer with a sensible size for its kind. */
export function generatedLayer(kind: Exclude<OverlayLayerKind, "image">): OverlayLayerConfig {
  switch (kind) {
    case "text":
      return { ...DEFAULT_OVERLAY_LAYER, kind, text: { ...DEFAULT_OVERLAY_TEXT } }
    case "qr":
      return { ...DEFAULT_OVERLAY_LAYER, kind, anchor: "bottom-right", x: -3, y: -4, width: 14, qr: { ...DEFAULT_OVERLAY_QR } }
    default:
      return { ...DEFAULT_OVERLAY_LAYER, kind, width: 30, height: 8, shape: { ...DEFAULT_OVERLAY_SHAPE } }
  }
}

const DEFAULT_LAYER_JSON = JSON.stringify(DEFAULT_OVERLAY_LAYER)

function readLayers(nodeId: string): ReadonlyArray<OverlayLayerConfig> {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as ImageOverlayData | undefined
  return Array.isArray(data?.layers) ? data!.layers : []
}

function readLayerCount(nodeId: string): number {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as ImageOverlayData | undefined
  return typeof data?.layerCount === "number" && Number.isFinite(data.layerCount) ? data.layerCount : 0
}

function fill(list: ReadonlyArray<OverlayLayerConfig>, length: number): OverlayLayerConfig[] {
  return Array.from({ length }, (_, k) => list[k] ?? DEFAULT_OVERLAY_LAYER)
}

/**
 * Pure: move layer `index` one step up (towards the front) or down in the
 * render order and re-stamp every layer's zIndex from its new position so the
 * values stay 0..n-1. Returns null when the move is impossible (already at
 * the end), so a caller can skip the write.
 */
export function reorderLayers(
  layers: ReadonlyArray<OverlayLayerConfig>,
  index: number,
  direction: "up" | "down",
): OverlayLayerConfig[] | null {
  const order = overlayRenderOrder(layers)
  const pos = order.indexOf(index)
  const swapWith = direction === "up" ? pos + 1 : pos - 1
  if (pos < 0 || swapWith < 0 || swapWith >= order.length) return null
  const nextOrder = order.map((v, i) => (i === pos ? order[swapWith] : i === swapWith ? index : v))
  const zOf = new Map(nextOrder.map((layerIndex, z) => [layerIndex, z]))
  return layers.map((l, k) => ({ ...l, zIndex: zOf.get(k) ?? k }))
}
