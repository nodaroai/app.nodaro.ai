/**
 * Placement geometry for the component marketplace POPUP variant.
 *
 * A leaf module on purpose: the canvas toolbar rail anchors the popup beside
 * itself and needs the width, but a static value import of the modal would
 * pull the whole marketplace (react-query mutations, the preview modal, the
 * cards) into the eager editor chunk and defeat the three `lazy()` boundaries
 * that mount it. Nothing here may import from the modal.
 */
import type { CSSProperties } from "react"

/** The popup variant's width (`w-80`). */
export const MARKETPLACE_POPUP_WIDTH = 320

/** Keep a caller-supplied physical x on-screen: every caller hands over a raw
 *  coordinate (a rail button's edge, a right-click, a handle drop) with no idea
 *  of the popup's width, and near the viewport's inline end that runs the popup
 *  off-screen. */
export function clampPopupLeft(x: number, viewportWidth: number): number {
  return Math.max(8, Math.min(x, viewportWidth - MARKETPLACE_POPUP_WIDTH - 8))
}

/** Where the popup opens when no caller position is given: beside the Add
 *  Node panel at the inline start, past the app sidebar. The popup is `fixed`
 *  (viewport-physical), so the side is chosen by the live direction. */
export function popupDefaultStyle(isRtl: boolean): CSSProperties {
  return isRtl
    ? { right: 70, top: "50%", transform: "translateY(-50%)" }
    : { left: 70, top: "50%", transform: "translateY(-50%)" }
}
