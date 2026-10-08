/**
 * The region editor's state (U4): the edit's cameras and pairs, the boxes and
 * their undo, what is selected, and what each camera's frame is known to be.
 * The dialog only lays it out.
 *
 * A box that was never set shows its default (D20, "Default regions"): on a
 * camera shared by several speakers, the k-th of n gets the slot-aspect strip
 * centred at (2k+1)/2n — computable once the camera's shape is known; a camera
 * showing one speaker is full frame. Save writes every box shown, so what was
 * on screen is what renders. Until Save, a node renders as before (never-saved
 * framing is full frame), so a default on screen counts as unsaved.
 */
import { useCallback, useMemo, useReducer, useState } from "react"
import { defaultSpeakerRegions, speakerViewAspectOf, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speakerViewContextOf, speakerViewEdits, speakerViewEdlProducer, speakerViewTranscript } from "@/lib/speaker-view-context"
import type { WorkflowNode } from "@/types/nodes"
import { FULL_FRAME, coverCropRect, layoutSlotRects, speakerViewCanvas, tidyRegion, type Region, type Size, type SpeakerViewAspect } from "./region-geometry"
import { cameraIsShared, framingModel, pairKey, regionsToSave, storedRegionOf, type FramingCamera, type FramingModel, type FramingShowAs } from "./region-model"
import { initialHistory, isDirty, regionHistoryReducer, withBox, type Boxes } from "./region-history"

export interface CameraFrame {
  readonly size?: Size
  readonly durationMs?: number
  /** The browser could not play it (SV9: fall back to the thumbnail). */
  readonly failed?: boolean
}

/** The upload node a camera's URL came from: its thumbnail and shape (SV9 d). */
export function cameraUpload(url: string, nodes: readonly WorkflowNode[]): { thumbnailUrl?: string; size?: Size; durationMs?: number } {
  for (const n of nodes) {
    const d = n.data as Record<string, unknown>
    const urls = [d.url, d.r2Url, d.externalUrl]
    if (!urls.includes(url)) continue
    const meta = (d.metadata ?? {}) as { width?: unknown; height?: unknown; durationSeconds?: unknown }
    const w = typeof meta.width === "number" ? meta.width : 0
    const h = typeof meta.height === "number" ? meta.height : 0
    return {
      ...(typeof d.thumbnailUrl === "string" && d.thumbnailUrl ? { thumbnailUrl: d.thumbnailUrl } : {}),
      ...(w > 0 && h > 0 ? { size: { width: w, height: h } } : {}),
      ...(typeof meta.durationSeconds === "number" && meta.durationSeconds > 0 ? { durationMs: meta.durationSeconds * 1000 } : {}),
    }
  }
  return {}
}

function initialBoxes(model: FramingModel, stored: unknown): Boxes {
  const boxes = new Map<string, Region | null>()
  for (const camera of model.cameras) {
    for (const pair of camera.pairs) {
      const region = storedRegionOf(stored, pair.source, pair.speaker)
      if (region) boxes.set(pairKey(pair.source, pair.speaker), region)
    }
  }
  return boxes
}

/** The container a camera's URL names (".mkv"), read from its path so a signed URL's query is ignored. */
export function containerOf(url: string): string | undefined {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split(/[?#]/)[0] ?? ""
  }
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? `.${m[1]!.toLowerCase()}` : undefined
}

export function useRegionEditor(nodeId: string) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const readOnly = useWorkflowStore((s) => s.isReadOnly)
  const data = (nodes.find((n) => n.id === nodeId)?.data ?? {}) as SpeakerViewNodeSettings & { speakerRegions?: unknown }

  const edits = useMemo(() => speakerViewEdits(nodeId, nodes, edges), [nodeId, nodes, edges])
  const transcript = useMemo(() => speakerViewTranscript(nodeId, nodes, edges), [nodeId, nodes, edges])
  const ctx = useMemo(() => speakerViewContextOf(nodeId, nodes, edges), [nodeId, nodes, edges])
  const settings = useMemo(() => ({ layout: data.layout, targetAspect: data.targetAspect }), [data.layout, data.targetAspect])
  const model = useMemo(() => framingModel(edits, transcript, settings, ctx), [edits, transcript, settings, ctx])
  const aspect = speakerViewAspectOf(settings, ctx) as SpeakerViewAspect
  const names = useMemo(() => {
    const producer = speakerViewEdlProducer(nodeId, nodes, edges)
    return producer?.type === "camera-switch" ? ((producer.data as { speakerNames?: Record<string, unknown> }).speakerNames ?? undefined) : undefined
  }, [nodeId, nodes, edges])

  const [history, dispatch] = useReducer(regionHistoryReducer, undefined, () => initialHistory(initialBoxes(model, data.speakerRegions)))
  const [frames, setFrames] = useState<Record<string, CameraFrame>>({})
  const [cameraId, setCameraId] = useState<string>(() => model.cameras[0]?.id ?? "")
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = model.cameras[0]?.pairs[0]
    return first ? pairKey(first.source, first.speaker) : null
  })
  const [showAsIndex, setShowAsIndex] = useState(0)

  const camera: FramingCamera | undefined = model.cameras.find((c) => c.id === cameraId) ?? model.cameras[0]
  const upload = useMemo(() => (camera ? cameraUpload(camera.url, nodes) : {}), [camera, nodes])
  const frameOf = useCallback(
    (c: FramingCamera): CameraFrame => {
      const own = frames[c.id] ?? {}
      const fallback = cameraUpload(c.url, nodes)
      return { ...own, size: own.size ?? fallback.size, durationMs: own.durationMs ?? fallback.durationMs }
    },
    [frames, nodes],
  )
  const frame = camera ? frameOf(camera) : {}

  /** The box a pair shows: set, else its default; null = full frame, no box. */
  const regionOf = useCallback(
    (c: FramingCamera, speaker: string): Region | null => {
      const set = history.present.get(pairKey(c.id, speaker))
      if (set !== undefined) return set
      const size = frameOf(c).size
      if (!cameraIsShared(c) || !size) return null
      const slot = speakerViewCanvas(aspect)
      const def = defaultSpeakerRegions(c.pairs.map((p) => p.speaker), slot.width / slot.height, size.width / size.height)
      return def.find((d) => d.speaker === speaker)?.region ?? null
    },
    [history.present, frameOf, aspect],
  )

  /**
   * A default box is on screen for a pair no one has set. Until Save writes it
   * the run draws that speaker full frame (never-saved framing renders as it
   * always did), so a drawn default is an unsaved change: closing asks first
   * (decided 2026-10-08).
   */
  const defaultsDrawn = useMemo(
    () => model.cameras.some((c) => c.pairs.some((p) => !history.present.has(pairKey(p.source, p.speaker)) && regionOf(c, p.speaker) !== null)),
    [model, history.present, regionOf],
  )

  const pair = camera?.pairs.find((p) => pairKey(p.source, p.speaker) === selectedKey)
  const showAs: readonly FramingShowAs[] = pair?.showAs ?? []
  const chosen = showAs[Math.min(showAsIndex, Math.max(0, showAs.length - 1))]
  const slot: Size | undefined = chosen
    ? (() => {
        const r = layoutSlotRects(chosen.layout, speakerViewCanvas(chosen.aspect), chosen.slots)[chosen.slotIndex]
        return r ? { width: r.w, height: r.h } : undefined
      })()
    : undefined
  const selectedRegion = camera && pair ? regionOf(camera, pair.speaker) : null
  const crop = selectedRegion && frame.size && slot ? coverCropRect(selectedRegion, frame.size, slot) : undefined

  const select = useCallback((nextCamera: string, key: string) => {
    setCameraId(nextCamera)
    setSelectedKey(key)
    setShowAsIndex(0)
  }, [])

  const setBox = useCallback((key: string, region: Region | null) => dispatch({ type: "commit", boxes: withBox(history.present, key, region) }), [history.present])

  /** Every shared camera back to its thirds, every close-up back to full frame (one step). */
  const resetToThirds = useCallback(() => {
    const next = new Map(history.present)
    for (const c of model.cameras) for (const p of c.pairs) next.delete(pairKey(p.source, p.speaker))
    dispatch({ type: "commit", boxes: next })
  }, [history.present, model])

  /** "▢ Full" / F: the selected speaker shown full frame. */
  const fullFrame = useCallback(() => {
    if (!camera || !selectedKey) return
    setBox(selectedKey, cameraIsShared(camera) ? FULL_FRAME : null)
  }, [camera, selectedKey, setBox])

  /** "⇄ Swap": the two speakers of a two-speaker camera trade boxes. */
  const swap = useCallback(() => {
    if (!camera || camera.pairs.length !== 2) return
    const [a, b] = camera.pairs
    const ka = pairKey(a!.source, a!.speaker)
    const kb = pairKey(b!.source, b!.speaker)
    dispatch({ type: "commit", boxes: withBox(withBox(history.present, ka, regionOf(camera, b!.speaker)), kb, regionOf(camera, a!.speaker)) })
  }, [camera, history.present, regionOf])

  /** The `speakerRegions` Save writes: every box shown, tidied (also what the header copies). */
  const rows = useMemo(() => {
    const effective = new Map<string, Region>()
    for (const c of model.cameras) {
      for (const p of c.pairs) {
        const region = regionOf(c, p.speaker)
        if (region) effective.set(pairKey(p.source, p.speaker), tidyRegion(region))
      }
    }
    return regionsToSave(model, effective, data.speakerRegions)
  }, [model, regionOf, data.speakerRegions])

  const save = useCallback(() => {
    updateNodeData(nodeId, { speakerRegions: rows.length > 0 ? rows : undefined })
  }, [rows, updateNodeData, nodeId])

  const noteFrame = useCallback((id: string, patch: CameraFrame) => setFrames((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })), [])

  return {
    model, aspect, transcript, names, camera, pair, frame, upload, frameOf, regionOf, readOnly,
    selectedKey, select, showAs, showAsIndex, setShowAsIndex, slot, crop,
    history, dispatch, dirty: isDirty(history) || defaultsDrawn, setBox, resetToThirds, fullFrame, swap, rows, save, noteFrame,
  }
}

export type RegionEditorState = ReturnType<typeof useRegionEditor>
