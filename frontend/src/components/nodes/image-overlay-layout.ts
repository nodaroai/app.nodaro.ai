import { OVERLAY_MAX_LAYERS } from "@/types/nodes"
import { VIDEO_NODE_MIN_HEIGHT } from "./video-node-defaults"

/** Top of the base handle, and of the first layer handle, in px from the node top. */
export const OVERLAY_BASE_HANDLE_TOP = 24
export const OVERLAY_FIRST_LAYER_TOP = 56
/** Vertical distance between layer handles. Tight enough that every handle the
 *  contract allows (OVERLAY_MAX_LAYERS) plus the "+" button fit inside the
 *  node's minimum height — image-overlay-handles.test.ts pins that. */
export const OVERLAY_HANDLE_PITCH = 24

export function overlayHandleTop(index: number): number {
  return OVERLAY_FIRST_LAYER_TOP + index * OVERLAY_HANDLE_PITCH
}

/** The "+" (add layer) button sits one pitch below the last shown handle. */
export function overlayAddButtonTop(handleCount: number): number {
  return overlayHandleTop(handleCount)
}

/** The QR link (text) handle — shown only while a QR layer reads its link
 *  from the workflow — sits one pitch under the "+" button, or in the "+"
 *  button's place once every layer slot is shown (the button hides then). */
export function overlayQrHandleTop(handleCount: number): number {
  return overlayHandleTop(Math.min(handleCount + 1, OVERLAY_MAX_LAYERS))
}

/** Right column: the composite at 24, the mask at 56, then one source
 *  handle per "export also for" platform at the layer pitch. */
export const OVERLAY_FIRST_VARIANT_TOP = 88
export function overlayVariantHandleTop(index: number): number {
  return OVERLAY_FIRST_VARIANT_TOP + index * OVERLAY_HANDLE_PITCH
}

/** Lowest pixel any handle-column control can reach — must stay inside the node. */
export const OVERLAY_HANDLE_COLUMN_BOTTOM = overlayAddButtonTop(OVERLAY_MAX_LAYERS) + 20

export { VIDEO_NODE_MIN_HEIGHT }
