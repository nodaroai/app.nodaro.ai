/**
 * Every layer handle the contract allows — and the "+" button below the last
 * one — must land inside the node's minimum height, or the bottom handles
 * float below the card with no anchor (they did at a 32px pitch: overlay11 at
 * 384px on a 368px node). Raising OVERLAY_MAX_LAYERS or the pitch fails here
 * instead of shipping detached handles.
 */
import { describe, it, expect } from "vitest"
import {
  OVERLAY_HANDLE_COLUMN_BOTTOM,
  OVERLAY_HANDLE_PITCH,
  overlayHandleTop,
  VIDEO_NODE_MIN_HEIGHT,
  overlayQrHandleTop,
  overlayVariantHandleTop,
} from "../image-overlay-layout"
import { OVERLAY_MAX_VARIANTS } from "@nodaro/shared"
import { OVERLAY_MAX_LAYERS } from "@/types/nodes"

describe("image-overlay handle column", () => {
  it("fits every handle plus the add button inside the node's minimum height", () => {
    expect(OVERLAY_HANDLE_COLUMN_BOTTOM).toBeLessThanOrEqual(VIDEO_NODE_MIN_HEIGHT)
    expect(overlayHandleTop(OVERLAY_MAX_LAYERS - 1) + OVERLAY_HANDLE_PITCH).toBeLessThanOrEqual(VIDEO_NODE_MIN_HEIGHT)
  })

  it("keeps handles far enough apart to be clickable", () => {
    expect(OVERLAY_HANDLE_PITCH).toBeGreaterThanOrEqual(20)
  })

  it("every variant output handle fits the right column under image + mask", () => {
    for (let i = 0; i < OVERLAY_MAX_VARIANTS; i++) {
      expect(overlayVariantHandleTop(i)).toBeGreaterThanOrEqual(56 + OVERLAY_HANDLE_PITCH)
      expect(overlayVariantHandleTop(i) + 12).toBeLessThanOrEqual(VIDEO_NODE_MIN_HEIGHT)
    }
  })

  it("the QR link handle never leaves the node and never overlaps a layer handle", () => {
    for (let n = 0; n <= OVERLAY_MAX_LAYERS; n++) {
      const top = overlayQrHandleTop(n)
      expect(top + 12).toBeLessThanOrEqual(VIDEO_NODE_MIN_HEIGHT)
      for (let i = 0; i < n; i++) expect(Math.abs(top - overlayHandleTop(i))).toBeGreaterThanOrEqual(OVERLAY_HANDLE_PITCH)
    }
  })
})
