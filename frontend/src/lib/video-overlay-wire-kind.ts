/**
 * What a wire into a Video Overlay layer handle draws as, on the canvas — the
 * shared wired-kind rule (`videoOverlayWiredLayerKind`, @nodaro/shared) handed
 * exactly what the server's input resolver hands it: the source as the
 * producer its pip behaves as (`outputPipSourceType`), the pip the wire leaves
 * (the teleport origin's), the medium a component's or sub-workflow's port
 * declares and a List column's type. The canvas run's resolver, the node's
 * upstream read and the connect writer all ask here, so the preview, the Run
 * button and the run cannot read one wire two ways.
 */
import {
  declaredOutputMediaType,
  listColumnMediaType,
  videoOverlayWiredLayerKind,
  videoOverlayWireMediumBeforeRun,
  type VideoOverlayWiredLayerKind,
  type VideoOverlayWiredSource,
  type VideoOverlayWireMedium,
} from "@nodaro/shared/video"
import { outputPipSourceType } from "@nodaro/shared/entities"
import { bypassTeleports } from "@nodaro/render-rules"
import { readNodeOutput } from "@/lib/node-output-reader"
import type { WorkflowNode } from "@/types/nodes"

/** The node a wire leaves (after any teleport pair). */
export interface VideoOverlayWireOrigin {
  readonly type?: string | null
  readonly data?: unknown
}

/** The rule's source for a wire leaving `node`'s pip `handle`. */
export function videoOverlayWiredSourceOf(node: VideoOverlayWireOrigin, handle: string | null | undefined): VideoOverlayWiredSource {
  const type = outputPipSourceType(node.type, handle)
  return {
    type,
    handle,
    declaredMediaType: declaredOutputMediaType(type, node.data, handle),
    columnMediaType: listColumnMediaType(type, node.data, handle),
  }
}

/** What the wire's file `url` draws as on a layer: an image or a video. */
export function videoOverlayWireKindOf(node: VideoOverlayWireOrigin, handle: string | null | undefined, url: string): VideoOverlayWiredLayerKind {
  return videoOverlayWiredLayerKind(videoOverlayWiredSourceOf(node, handle), url)
}

/**
 * What the wire hands a layer as far as it is known now: the kind of its file
 * when it has one, else what the source decides by itself, else `unknown`
 * (a source whose kind follows a file it has not produced yet).
 */
export function videoOverlayWireMediumOf(node: VideoOverlayWireOrigin, handle: string | null | undefined, url: string | null | undefined): VideoOverlayWireMedium {
  if (typeof url === "string" && url.length > 0) return videoOverlayWireKindOf(node, handle, url)
  return videoOverlayWireMediumBeforeRun(videoOverlayWiredSourceOf(node, handle))
}

interface WireGraphNode extends VideoOverlayWireOrigin {
  readonly id: string
}
interface WireGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

/**
 * What `edge` hands its layer handle as far as it is known now, read on the
 * graph the canvas run reads (`bypassTeleports`: through a teleport pair, the
 * origin node and pip) with the file the node hands on (`readNodeOutput`).
 * `unknown` when its source is missing. For the connect writer, which may ask
 * about an edge not in `edges` yet.
 */
export function videoOverlayEdgeMedium(nodes: readonly WireGraphNode[], edges: readonly WireGraphEdge[], edge: WireGraphEdge): VideoOverlayWireMedium {
  const all = edges.includes(edge) ? edges : [...edges, edge]
  const routed = bypassTeleports(nodes, all)[all.indexOf(edge)]!
  const origin = nodes.find((n) => n.id === routed.source)
  if (!origin) return "unknown"
  const url = readNodeOutput(origin as WorkflowNode, routed.sourceHandle ?? undefined)
  return videoOverlayWireMediumOf(origin, routed.sourceHandle, typeof url === "string" ? url : undefined)
}

/**
 * The 1-based video slots after the wire on `slot` lands: the last wire on a
 * slot decides its kind, as it decides its URL. Sorted; undefined when no
 * slot is a video (the server's `overlayVideoSlots` shape).
 */
export function withVideoOverlayWireKind(slots: readonly number[] | undefined, slot: number, kind: VideoOverlayWiredLayerKind): number[] | undefined {
  const next = (slots ?? []).filter((s) => s !== slot)
  if (kind === "video") next.push(slot)
  return next.length > 0 ? next.sort((a, b) => a - b) : undefined
}
