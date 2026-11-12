import { clearWiredVideoOverlayImageUrls, videoOverlaySlotOfHandle, type VideoOverlayLayerInput, type VideoOverlayWireMedium } from "@nodaro/shared/video"

/** What the slot was before the new wire, and what the new wire hands it (`videoOverlayWireMediumOf`). */
export interface VideoOverlayConnectKinds {
  /** The medium of the wire already on that handle, if any (the last one). Absent = none: the slot's own stored source decides. */
  readonly previous?: VideoOverlayWireMedium
  readonly next?: VideoOverlayWireMedium
}

const decided = (m: VideoOverlayWireMedium | undefined): m is "image" | "video" => m === "image" || m === "video"
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0

/**
 * The kind a slot's stored layer was read as before any new wire: its own
 * video, its own image, else — with no source of its own — a video only when
 * it carries `sound` (a video layer's only setting), and an image otherwise
 * (as every reader expands a layer with no `videoUrl`).
 */
function storedKind(layer: VideoOverlayLayerInput): "image" | "video" {
  if (nonEmpty(layer.videoUrl)) return "video"
  if (nonEmpty(layer.imageUrl)) return "image"
  return layer.sound != null ? "video" : "image"
}

/**
 * D3 — the node-data patch a new wire into a Video Overlay layer handle
 * implies: that slot's own `imageUrl` / `videoUrl` is cleared (the wire
 * replaces it), so a stored layer never carries both and disconnecting empties
 * the slot. When the wire changes the slot's kind (image ↔ video, both known),
 * the settings that belonged to the other kind go with it: `animate` returns to
 * the new kind's default (on for an image, off for a video — a setting made
 * for the other kind is not the user's choice for this one), and `sound` goes
 * when the slot is now an image. Called by the workflow store's `onConnect`,
 * the interactive connection path — not a panel effect, which would miss a
 * node whose panel is closed. (Programmatic edge writers — `batchAddNodesAndEdges`,
 * `loadWorkflow`, remote reconcile — do not call it; none targets a Video
 * Overlay layer today, and the run-time merge `wired ?? imageUrl` still makes a
 * wire win there.) `null` when the handle is not a layer handle or nothing changes.
 */
export function videoOverlayConnectPatch(
  data: { readonly layers?: unknown },
  targetHandle: string | null | undefined,
  kinds: VideoOverlayConnectKinds = {},
): { layers: Array<VideoOverlayLayerInput | null> } | null {
  const slot = videoOverlaySlotOfHandle(targetHandle)
  if (slot === 0 || !Array.isArray(data.layers)) return null
  const layers = data.layers as Array<VideoOverlayLayerInput | null>
  const own = layers[slot - 1]
  const previous = kinds.previous ?? (own && typeof own === "object" && !Array.isArray(own) ? storedKind(own) : undefined)
  const cleared = clearWiredVideoOverlayImageUrls(layers, new Set([slot]))
  const layer = cleared[slot - 1]
  if (!decided(previous) || !decided(kinds.next) || previous === kinds.next || !layer || typeof layer !== "object") {
    return cleared === layers ? null : { layers: [...cleared] }
  }
  const { animate: _otherKinds, sound, ...rest } = layer
  const next: VideoOverlayLayerInput = kinds.next === "video" && sound !== undefined ? { ...rest, sound } : rest
  if (cleared === layers && Object.keys(next).length === Object.keys(layer).length) return null
  return { layers: cleared.map((l, i) => (i === slot - 1 ? next : l)) }
}
