"use client"

import { createPortal } from "react-dom"
import { optimizedImageUrl } from "@/lib/image"
import { computeFlipPosition } from "./flip-position"

const PREVIEW_MAX = 220
const GAP = 8

/**
 * Large hover/selection preview for a reference image — body-portaled and
 * positioned next to `anchor`. Extracted from `image-ref-view` so the chip
 * thumbnail, the thumbnail swap-picker, and the `@` autocomplete rows share ONE
 * preview. Renders nothing when `url` or `anchor` is absent.
 *
 * `placement`:
 *   - "flip" (default) — below the anchor, flipping above when cramped. The
 *     original chip-thumbnail behavior (byte-identical `computeFlipPosition`
 *     args), so `image-ref-view` keeps its exact preview.
 *   - "side" — to the RIGHT of the anchor (left when the viewport lacks room),
 *     top-aligned + clamped. Used beside a dropdown/menu so hovering a row
 *     previews its image without covering the list.
 */
export function RefPreviewPortal({
  url,
  anchor,
  placement = "flip",
}: {
  url?: string
  anchor: DOMRect | null
  placement?: "flip" | "side"
}) {
  if (!url || !anchor) return null

  let top: number
  let left: number
  if (placement === "side") {
    const spaceRight = window.innerWidth - anchor.right - GAP
    left = spaceRight >= PREVIEW_MAX ? anchor.right + GAP : Math.max(GAP, anchor.left - PREVIEW_MAX - GAP)
    top = Math.max(GAP, Math.min(anchor.top, window.innerHeight - PREVIEW_MAX - GAP))
  } else {
    const pos = computeFlipPosition(anchor, {
      width: PREVIEW_MAX,
      estHeight: PREVIEW_MAX,
      margin: GAP,
      placeBelowThreshold: PREVIEW_MAX,
      secondaryClauseMargin: GAP,
    })
    top = pos.top
    left = pos.left
  }

  return createPortal(
    <div
      style={{ position: "fixed", top, left }}
      className="z-[10000] pointer-events-none rounded-md shadow-xl bg-popover border border-border p-1"
      aria-hidden
      data-testid="ref-preview-portal"
    >
      <img
        src={optimizedImageUrl(url, { width: 480 })}
        alt=""
        className="block rounded object-contain"
        style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
      />
    </div>,
    document.body,
  )
}
