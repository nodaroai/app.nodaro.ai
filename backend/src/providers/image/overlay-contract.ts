/**
 * The Image Overlay node's handle contract — shared by the provider, the
 * orchestrator's input-resolver / payload-builder and the route, and kept
 * free of `sharp` so the orchestrator never loads the native module just to
 * know how many layer handles exist. Mirrors `OVERLAY_HANDLE_IDS` in
 * frontend/src/types/nodes.ts (the node-definition test pins the frontend
 * half; image-overlay-wiring.test.ts pins this one).
 */
export const OVERLAY_HANDLE_IDS = ["overlay", "overlay2", "overlay3", "overlay4", "overlay5", "overlay6", "overlay7", "overlay8", "overlay9", "overlay10", "overlay11", "overlay12"] as const
export type OverlayHandleId = (typeof OVERLAY_HANDLE_IDS)[number]

/** Hard cap on overlay layers per job — one handle per layer on the node. */
/** Longest edge any single rasterised layer may have, in px — larger inputs are
 *  scaled down to it BEFORE decoding / rendering, never after. Shared by the
 *  image, text, QR and shape lanes. */
export const OVERLAY_MAX_LAYER_EDGE = 8192
/** Pixel cap handed to sharp for every decode (`limitInputPixels`). */
export const OVERLAY_PIXEL_LIMIT = OVERLAY_MAX_LAYER_EDGE * OVERLAY_MAX_LAYER_EDGE

export const OVERLAY_MAX_LAYERS = OVERLAY_HANDLE_IDS.length

/** `overlay` → 0 … `overlay12` → 11; anything else (including `overlay0`,
 *  `overlay13`) → -1, never a silent out-of-range index. */
export function overlayHandleIndex(handle: string | null | undefined): number {
  return handle ? (OVERLAY_HANDLE_IDS as readonly string[]).indexOf(handle) : -1
}
