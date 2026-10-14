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
 * framing is full frame), so a default on screen counts as unsaved — unless
 * "Split the camera by speaker" (`autoRegions`) already renders that very box.
 *
 * Save also marks which saved rows are untouched defaults (`defaultRegionKeys`,
 * P3.9): default thirds frame, but never label a face track (P3-4 rung 2) —
 * only a box the person set does. A stored default stays a default until the
 * person moves it.
 */
import { useCallback, useMemo, useReducer, useState } from "react"
import { defaultSpeakerRegions, isWholeClipEdl, speakerViewAspectOf, speakerViewTrackedOn, speakerViewWireSettings, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speakerViewContextOf, speakerViewEdits, speakerViewEdlProducer, speakerViewTranscript, speakerViewVideoFed } from "@/lib/speaker-view-context"
import type { SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
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

/**
 * `stagedTracks`: the face tracks with the corrections staged in the dialog
 * (`useRegionTracks().labelled`), so a face picked for a speaker ("Which face
 * is …?") makes them tracked at once — their default box goes before Save,
 * and Save never writes one in the same action as the correction. Without
 * it, the tracks as saved (what the run sends).
 */
export function useRegionEditor(nodeId: string, stagedTracks?: Pick<SpeakerTrackSetDescriptor, "sources">) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const readOnly = useWorkflowStore((s) => s.isReadOnly)
  const data = (nodes.find((n) => n.id === nodeId)?.data ?? {}) as SpeakerViewNodeSettings & { speakerRegions?: unknown; defaultRegionKeys?: unknown }

  const edits = useMemo(() => speakerViewEdits(nodeId, nodes, edges), [nodeId, nodes, edges])
  const transcript = useMemo(() => speakerViewTranscript(nodeId, nodes, edges), [nodeId, nodes, edges])
  /** A video is fed in place of an edit (wired, whether or not it has an address yet). */
  const videoFed = useMemo(() => speakerViewVideoFed(nodeId, nodes, edges), [nodeId, nodes, edges])
  /** The framing as saved on the node (what the badge reads). */
  const saved = useMemo(() => ({ speakerRegions: data.speakerRegions, defaultRegionKeys: data.defaultRegionKeys }), [data.speakerRegions, data.defaultRegionKeys])
  /** The edit read is that video's whole-clip edit. */
  const wholeClip = edits.length === 1 && isWholeClipEdl(edits[0])
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

  /**
   * Whether a face track on camera `c` names `speaker` (the shared test,
   * `speakerViewTrackedOn`, over the tracks the run sends). While tracks are
   * wired a tracked speaker is followed by their face (decided 2026-10-13:
   * faces win), so the editor deals them no default box: it opens clean and
   * Save never writes one for them.
   */
  const trackedOn = useCallback(
    (c: FramingCamera, speaker: string): boolean => {
      const labels = stagedTracks ?? ctx?.tracks
      return !!labels && speakerViewTrackedOn(labels, c.id, transcript)(speaker)
    },
    [stagedTracks, ctx, transcript],
  )

  /** The pairs the node saved as untouched defaults (`defaultRegionKeys`). */
  const storedDefaults = useMemo(
    () => new Set(Array.isArray(data.defaultRegionKeys) ? (data.defaultRegionKeys as unknown[]).filter((k): k is string => typeof k === "string") : []),
    [data.defaultRegionKeys],
  )

  /** The box a pair shows: set, else its default; null = full frame, no box. */
  const regionOf = useCallback(
    (c: FramingCamera, speaker: string): Region | null => {
      const key = pairKey(c.id, speaker)
      const set = history.present.get(key)
      if (set !== undefined) {
        // A row saved earlier as an untouched default, for a speaker a track
        // now names: no box (faces win) — so Save drops it. A box the person
        // drew or moved is kept.
        const then = history.initial.get(key)
        const untouchedDefault = !!set && !!then && storedDefaults.has(key) && set.x === then.x && set.y === then.y && set.w === then.w && set.h === then.h
        return untouchedDefault && trackedOn(c, speaker) ? null : set
      }
      const size = frameOf(c).size
      if (!cameraIsShared(c) || !size) return null
      // Dealt over every speaker on the camera first, so a speaker no track
      // names keeps the very third the run sends them; then a tracked one gets none.
      if (trackedOn(c, speaker)) return null
      const slot = speakerViewCanvas(aspect)
      const def = defaultSpeakerRegions(c.pairs.map((p) => p.speaker), slot.width / slot.height, size.width / size.height)
      return def.find((d) => d.speaker === speaker)?.region ?? null
    },
    [history.present, history.initial, storedDefaults, frameOf, aspect, trackedOn],
  )

  /**
   * The boxes the run would send now, unsaved changes aside: the saved rows,
   * else — with "Split the camera by speaker" on (`autoRegions`) — the very
   * defaults this editor deals, on the assumed 16:9 camera.
   */
  const runRows = useMemo(() => speakerViewWireSettings(data, ctx).speakerRegions ?? [], [data, ctx])

  /**
   * A default box is on screen for a pair no one has set. Until Save writes it
   * the run draws that speaker full frame (never-saved framing renders as it
   * always did) — unless the automatic boxes already draw exactly that box —
   * so a drawn default is an unsaved change: closing asks first (decided
   * 2026-10-08).
   */
  const defaultsDrawn = useMemo(
    () => model.cameras.some((c) => c.pairs.some((p) => {
      if (history.present.has(pairKey(p.source, p.speaker))) return false
      const shown = regionOf(c, p.speaker)
      if (shown === null) return false
      const sent = runRows.find((r) => r.source === p.source && r.speaker === p.speaker)?.region
      return !(sent && sent.x === shown.x && sent.y === shown.y && sent.w === shown.w && sent.h === shown.h)
    })),
    [model, history.present, regionOf, runRows],
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

  /** "⇄ Swap" is offered on a two-speaker camera where no speaker is tracked:
   *  a tracked speaker has no box to trade (it is followed), and taking the
   *  other's would leave that one with none. */
  const canSwap = !!camera && camera.pairs.length === 2 && !camera.pairs.some((p) => trackedOn(camera, p.speaker))

  /** "⇄ Swap": the two speakers of a two-speaker camera trade boxes. */
  const swap = useCallback(() => {
    if (!camera || !canSwap) return
    const [a, b] = camera.pairs
    const ka = pairKey(a!.source, a!.speaker)
    const kb = pairKey(b!.source, b!.speaker)
    dispatch({ type: "commit", boxes: withBox(withBox(history.present, ka, regionOf(camera, b!.speaker)), kb, regionOf(camera, a!.speaker)) })
  }, [camera, canSwap, history.present, regionOf])

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

  /** The saved rows that are untouched defaults: shown as a default (never
   *  set), or loaded as a stored default and not moved since. */
  const defaultKeys = useMemo(() => {
    const stored = new Set(Array.isArray(data.defaultRegionKeys) ? (data.defaultRegionKeys as unknown[]).filter((k): k is string => typeof k === "string") : [])
    const shown = new Set(model.cameras.flatMap((c) => c.pairs.map((p) => pairKey(p.source, p.speaker))))
    return rows.flatMap((row) => {
      const key = pairKey(row.source, row.speaker)
      if (!shown.has(key)) return stored.has(key) ? [key] : []
      if (!history.present.has(key)) return [key]
      const now = history.present.get(key)
      const then = history.initial.get(key)
      const untouched = !!now && !!then && now.x === then.x && now.y === then.y && now.w === then.w && now.h === then.h
      return stored.has(key) && untouched ? [key] : []
    })
  }, [data.defaultRegionKeys, model, rows, history.present, history.initial])

  const save = useCallback(() => {
    updateNodeData(nodeId, {
      speakerRegions: rows.length > 0 ? rows : undefined,
      defaultRegionKeys: defaultKeys.length > 0 ? defaultKeys : undefined,
    })
  }, [rows, defaultKeys, updateNodeData, nodeId])

  const noteFrame = useCallback((id: string, patch: CameraFrame) => setFrames((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })), [])

  return {
    model, aspect, transcript, names, videoFed, wholeClip, saved, camera, pair, frame, upload, frameOf, regionOf, readOnly,
    selectedKey, select, showAs, showAsIndex, setShowAsIndex, slot, crop,
    history, dispatch, dirty: isDirty(history) || defaultsDrawn, setBox, resetToThirds, fullFrame, canSwap, swap, rows, save, noteFrame,
  }
}

export type RegionEditorState = ReturnType<typeof useRegionEditor>
