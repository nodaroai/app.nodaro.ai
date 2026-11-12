import { useMemo } from "react"
import { VIDEO_OVERLAY_HANDLE_IDS, VIDEO_OVERLAY_LAYER_PLAN_HANDLE } from "@nodaro/shared/video"
import { bypassTeleports, isTeleportNodeType } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { videoOverlayWireKindOf } from "@/lib/video-overlay-wire-kind"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface VideoOverlayUpstream {
  /** The base video URL (the `video` handle, or the first handle-less wire). */
  readonly base?: string
  /** Wired layer sources by handle: [0] ↔ overlay, [1] ↔ overlay2 … sparse when unwired. */
  readonly layers: ReadonlyArray<string | undefined>
  /** The 1-based layer slots whose wired source is a video (the assembly's `wiredVideoSlots`). */
  readonly wiredVideoSlots: ReadonlySet<number>
  /** The wired layer plan (the `layerPlan` handle's output, a JSON string), when it has one. */
  readonly plan?: string
  /** Every target handle that has a wire (even if its source has no result yet). */
  readonly connected: ReadonlySet<string>
}

/** One wire as the node reads it: its target handle, its file, and — on a layer handle with a file — whether that file is a video. */
type Wire = readonly [handle: string, url: string, video?: 1]

/**
 * The node's wires as ONE string (a JSON array of wires; "" when it has none),
 * so a selector re-renders only when a wire, an upstream result or a wire's
 * kind changes. Read on the graph the canvas run reads (`bypassTeleports`: a
 * wire through a teleport pair reads its origin node and pip).
 */
function videoOverlayWiresKey(nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>, nodeId: string): string {
  const raw = edges.filter((e) => e.target === nodeId)
  if (raw.length === 0) return ""
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const incoming = raw.some((e) => isTeleportNodeType(byId.get(e.source)?.type))
    ? bypassTeleports(nodes, edges).filter((e) => e.target === nodeId)
    : raw
  const wires: Wire[] = []
  for (const edge of incoming) {
    const src = byId.get(edge.source)
    if (!src) continue
    const handle = edge.targetHandle ?? ""
    const url = extractNodeOutput(src, edge.sourceHandle ?? undefined) ?? ""
    const layer = url !== "" && (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).includes(handle)
    wires.push(layer && videoOverlayWireKindOf(src, edge.sourceHandle, url) === "video" ? [handle, url, 1] : [handle, url])
  }
  return JSON.stringify(wires)
}

function upstreamOfKey(key: string): VideoOverlayUpstream {
  const layers: Array<string | undefined> = []
  const videoSlots = new Set<number>()
  const connected = new Set<string>()
  let base: string | undefined
  let plan: string | undefined
  const wires = key ? (JSON.parse(key) as Wire[]) : []
  for (const [handle, rawUrl, video] of wires) {
    const url = rawUrl || undefined
    if (handle) connected.add(handle)
    if (handle === VIDEO_OVERLAY_LAYER_PLAN_HANDLE) {
      plan = url
      continue
    }
    const idx = (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).indexOf(handle)
    if (idx >= 0) {
      // A wire with no file yet leaves the slot to an earlier one, as the run
      // does — but still counts as wired (the node keeps its handle shown).
      if (!url) {
        if (layers.length <= idx) layers[idx] = undefined
        continue
      }
      layers[idx] = url
      if (video) videoSlots.add(idx + 1)
      else videoSlots.delete(idx + 1)
    } else if (handle === "video" || base === undefined) base = url
  }
  return { base, layers, wiredVideoSlots: videoSlots, plan, connected }
}

/**
 * What is wired into each of a Video Overlay node's target handles, read
 * through `extractNodeOutput` — the single source of truth the executor uses —
 * outside React: the layers writer reads it at write time, the hook below on
 * every render. A layer wire's kind is the shared rule's
 * (`videoOverlayWireKindOf`), so the node draws and prices a wire as the run
 * sends it; the last wire with a file decides a slot, its kind included, as
 * both input resolvers do. The `layerPlan` id is the wired layer plan
 * (`plan`), never a layer source.
 */
export function readVideoOverlayUpstream(nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>, nodeId: string): VideoOverlayUpstream {
  return upstreamOfKey(videoOverlayWiresKey(nodes, edges, nodeId))
}

/** {@link readVideoOverlayUpstream} as a hook: re-renders only when a wire, an upstream result or a wire's kind changes. */
export function useVideoOverlayUpstream(nodeId: string): VideoOverlayUpstream {
  const key = useWorkflowStore((s) => videoOverlayWiresKey(s.nodes, s.edges, nodeId))
  return useMemo(() => upstreamOfKey(key), [key])
}
