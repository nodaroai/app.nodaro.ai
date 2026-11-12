import { useCallback } from "react"
import { toast } from "sonner"
import {
  VIDEO_OVERLAY_BOX_FIELDS,
  VIDEO_OVERLAY_HANDLE_IDS,
  applyVideoOverlayPreset,
  expandVideoOverlayLayer,
  firstVideoLayerIndex,
  hasDrawableVideoOverlayBox,
  isVideoOverlayLayoutId,
  isVideoOverlayOutputAspect,
  toCustomVideoOverlayLayer,
  videoOverlayLayoutNeedsAspect,
  videoOverlayLayoutNeedsVideoLayer,
  videoOverlayRenderOrder,
  withoutImpliedVideoOverlayAnimate,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
  type VideoOverlayCorner,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayLayoutId,
  type VideoOverlayPresetId,
} from "@nodaro/shared/video"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT, type MessageKey } from "@/lib/i18n"
import { readVideoOverlayUpstream } from "@/hooks/use-video-overlay-upstream"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { resolveVideoOverlayView, videoOverlayViewMedia } from "@/lib/video-overlay-view"
import { videoOverlayLayoutAsCustom, type VideoOverlayLayoutCustom } from "@/lib/video-overlay-layout-custom"
import { videoOverlayBaseBoxAfter, videoOverlayEffectiveBaseBox } from "@/lib/video-overlay-base-box"
import { DEFAULT_OVERLAY_LAYER_COUNT, type VideoOverlayData } from "@/types/nodes"

/** The output aspect a layout that needs one gets when the node has none (a stack or an edge layout is a portrait use). */
export const VIDEO_OVERLAY_LAYOUT_DEFAULT_ASPECT = "9:16" as const

/**
 * An edit to any of these, on any layer, is a box edit: it makes a layout
 * Custom, since the boxes, not the layout tag, are what renders. Not
 * `corner`: under pip it is the layout's own input (which corner the inset
 * sits in), and a card changes a badge's corner with a preset click, which is
 * a box edit.
 */
const BOX_EDIT_KEYS: ReadonlySet<string> = new Set([...VIDEO_OVERLAY_BOX_FIELDS, "preset"])

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
 * so it materialises as a real layer here, with no fade setting of its own:
 * that default follows its wire's kind) and `index` itself — from its new
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
    if (z === undefined) return l
    const next = { ...expandVideoOverlayLayer(l), zIndex: z }
    return wired.has(k) ? withoutImpliedVideoOverlayAnimate(next, l) : next
  })
}

function readData(nodeId: string): VideoOverlayData | undefined {
  return useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as VideoOverlayData | undefined
}

function readLayers(nodeId: string): StoredLayers {
  const layers = readData(nodeId)?.layers
  return Array.isArray(layers) ? layers : []
}

/**
 * The patch that turns the node's layout Custom with nothing moving, read from
 * the canvas as the stage draws it (its wires, the probed base, the shapes the
 * stage read); null when it has no layout or the edit leaves the layout as it
 * is; `"shapes-pending"` while a stack-whole's shapes are unread (the edit
 * waits). `slot` (0-based), when given, limits a fade edit to the layout's
 * first video layer: a layout holds that layer's fade off, so an edit to it
 * would otherwise be inert.
 */
function layoutAsCustom(nodeId: string, edit?: { readonly slot: number; readonly patch: VideoOverlayLayerInput }): VideoOverlayLayoutCustom | null {
  const data = readData(nodeId)
  if (!data || typeof data.layout !== "string" || data.layout === "") return null
  const keys = edit ? Object.keys(edit.patch) : []
  const boxEdit = !edit || keys.some((k) => BOX_EDIT_KEYS.has(k))
  // A timing, look or sound edit never moves what a layout placed; only a fade edit on its first video layer is read further.
  const placesFirstVideo = isVideoOverlayLayoutId(data.layout) && videoOverlayLayoutNeedsVideoLayer(data.layout)
  if (!boxEdit && !(keys.includes("animate") && placesFirstVideo)) return null
  const { nodes, edges } = useWorkflowStore.getState()
  const upstream = readVideoOverlayUpstream(nodes, edges, nodeId)
  const view = resolveVideoOverlayView(data, upstream, videoOverlayViewMedia(data.probedVideo, upstream.base, useVideoOverlayAspectStore.getState().aspects))
  if (!boxEdit) {
    const first = firstVideoLayerIndex(view.request.layers)
    if (first < 0 || view.request.layers[first]!.slot !== edit!.slot + 1) return null
  }
  return videoOverlayLayoutAsCustom(data, view, wiredSlots(nodeId))
}

/**
 * Why a stack cannot be turned Custom yet — its clip's (or base's) shape is
 * still being read, or could not be read — for the message a dropped edit
 * shows, the same words the panel shows.
 */
export function videoOverlayShapesPendingKey(unreadable: boolean): MessageKey {
  return unreadable ? "proccfg.videoOverlay.layoutShapesUnreadable" : "proccfg.videoOverlay.layoutShapesPending"
}

/** Whether the shape a stack waits for could not be read (the clip's, or the base's probe failed). */
function shapesUnreadable(nodeId: string): boolean {
  const data = readData(nodeId)
  if (!data) return false
  const { nodes, edges } = useWorkflowStore.getState()
  const upstream = readVideoOverlayUpstream(nodes, edges, nodeId)
  const { aspects, unreadable } = useVideoOverlayAspectStore.getState()
  const view = resolveVideoOverlayView(data, upstream, videoOverlayViewMedia(data.probedVideo, upstream.base, aspects))
  const first = firstVideoLayerIndex(view.request.layers)
  const clip = first >= 0 ? view.request.layers[first]!.videoUrl : undefined
  const baseFailed = !!data.probedVideo?.error && data.probedVideo.url === upstream.base && view.baseAspect === undefined
  return (!!clip && !!unreadable[clip]) || baseFailed
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
 * store's `onConnect` is the only other writer: it clears a slot's own source
 * when its handle is wired — D3 — and drops the other kind's fade setting and
 * sound when the wire changes the slot's kind.) It also writes the layout:
 * a box edit — a drag or resize on the stage, a box field or a preset on a
 * card — makes a layout Custom first, keeping every box it placed
 * (`videoOverlayLayoutAsCustom`), so the edit is not overridden and nothing
 * else moves; while a stack-whole's shapes are unread the edit waits
 * (it is dropped: the stage cannot yet say where the stack sits). And it
 * writes the base's box (`setBaseBox` / `resetBaseBox`): a base edit is a box
 * edit too. A drag writes once per frame and the undo history folds a burst
 * of writes into one step, so a drag is one undo step.
 */
export function useVideoOverlayLayers(nodeId: string) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const t = useT()
  /** An edit dropped while a stack's shapes are unread says so (one toast per node, updated in place — a drag drops many). */
  const notePending = useCallback(
    () => toast.info(t(videoOverlayShapesPendingKey(shapesUnreadable(nodeId))), { id: `video-overlay-shapes-${nodeId}` }),
    [nodeId, t],
  )

  /**
   * Write slot `index`. A WIRED slot's kind is its wire's, read at the run, so
   * its stored layer keeps only a fade setting it already had or the edit sets
   * (`patch`) — never the expansion's default for whichever kind it read as
   * here (`withoutImpliedVideoOverlayAnimate`; the save normaliser stores the
   * same, so the canvas and the saved node give one composition key).
   */
  const writeSlot = useCallback(
    (
      index: number,
      next: (current: VideoOverlayLayerInput | null | undefined) => VideoOverlayLayerInput,
      patch: VideoOverlayLayerInput | undefined,
      custom: VideoOverlayLayoutCustom | null,
    ) => {
      if (custom === "shapes-pending") return void notePending()
      // A layout turned Custom first: the edit applies to the boxes it placed.
      const list = custom?.layers ?? readLayers(nodeId)
      const current = list[index]
      const written = next(current)
      const stored = wiredSlots(nodeId).has(index) ? withoutImpliedVideoOverlayAnimate(written, { ...(current ?? {}), ...(patch ?? {}) }) : written
      updateNodeData(nodeId, { ...(custom ?? {}), layers: writeVideoOverlaySlot(list, index, stored) })
    },
    [nodeId, updateNodeData, notePending],
  )

  /** Timing, look or box edit — keeps the preset tag unless the box leaves the preset's; a box edit makes a layout Custom. */
  const setLayer = useCallback(
    (index: number, patch: VideoOverlayLayerInput) =>
      writeSlot(index, (current) => patchVideoOverlayLayer(current, patch), patch, layoutAsCustom(nodeId, { slot: index, patch })),
    [nodeId, writeSlot],
  )

  /** A preset click: the preset's box REPLACES the six box fields, the tag is set — a box edit, so a layout turns Custom. */
  const applyPreset = useCallback(
    (index: number, preset: VideoOverlayPresetId, corner?: VideoOverlayCorner) =>
      writeSlot(index, (current) => applyVideoOverlayPreset(current, preset, corner), undefined, layoutAsCustom(nodeId)),
    [nodeId, writeSlot],
  )

  /** "Custom": the tag is cleared, the box kept. */
  const setCustom = useCallback((index: number) => writeSlot(index, (current) => toCustomVideoOverlayLayer(current), undefined, null), [writeSlot])

  /**
   * The Layout picker. A layout: its tag, with a 9:16 output when it needs an
   * aspect and the node has none; a stored base box is cleared (a stack refuses
   * one, and one kept by an earlier Custom would win over the layout's own).
   * `null` — Custom: the layout's boxes are kept and the tag cleared (never `""`).
   */
  const setLayout = useCallback(
    (layout: VideoOverlayLayoutId | null) => {
      if (layout === null) {
        const custom = layoutAsCustom(nodeId)
        if (custom === "shapes-pending") notePending()
        else if (custom) updateNodeData(nodeId, { ...custom })
        return
      }
      const aspect = isVideoOverlayOutputAspect(readData(nodeId)?.outputAspect)
      updateNodeData(nodeId, {
        layout,
        baseBox: undefined,
        ...(videoOverlayLayoutNeedsAspect(layout) && !aspect ? { outputAspect: VIDEO_OVERLAY_LAYOUT_DEFAULT_ASPECT } : {}),
      })
    },
    [nodeId, updateNodeData, notePending],
  )

  /**
   * A base box edit — a drag or resize of the base on the stage, a field on
   * the Base video card — after a layout is turned Custom (keeping what it
   * placed — a stack's base rect included). It starts from the base's own
   * whole box (stored, or the one the layout just left), else from `from`:
   * the box the edit began at on the stage or the card (Video fit's drawn
   * rect as a box for a move, a shape-keeping box for a resize), else Video
   * fit's frame. Without an output aspect there is no base box to write
   * (`base_box_needs_aspect`).
   */
  const setBaseBox = useCallback(
    (patch: VideoOverlayBoxInput, from?: VideoOverlayBox) => {
      const data = readData(nodeId)
      if (!data || !isVideoOverlayOutputAspect(data.outputAspect)) return
      const custom = layoutAsCustom(nodeId)
      if (custom === "shapes-pending") return void notePending()
      const after = { ...data, ...(custom ?? {}) }
      const own = hasDrawableVideoOverlayBox(after.baseBox) ? (after.baseBox as VideoOverlayBox) : undefined
      const start = own ?? from ?? videoOverlayEffectiveBaseBox(after)
      if (!start) return
      updateNodeData(nodeId, { ...(custom ?? {}), baseBox: videoOverlayBaseBoxAfter(start, patch) })
    },
    [nodeId, updateNodeData, notePending],
  )

  /** The Base video card's Reset: no base box — Video fit places the base again. */
  const resetBaseBox = useCallback(() => updateNodeData(nodeId, { baseBox: undefined }), [nodeId, updateNodeData])

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

  return { setLayer, applyPreset, setCustom, setLayout, setBaseBox, resetBaseBox, reorder, removeLayer }
}
