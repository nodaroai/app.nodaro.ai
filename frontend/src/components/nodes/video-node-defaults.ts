/**
 * Shared sizing for every video-producing node on the canvas.
 *
 * Before this existed, each video node hand-picked its own `minWidth`/`minHeight`
 * and aspect handling, so node size drifted with handle count: Generate Video
 * (11 input pips → a tall 368px floor) rendered as a big 16:9 box, while
 * Lip Sync (3 pips → ~150px floor) was tiny. Sharing only `minWidth` didn't fix
 * it — the idle size is driven by the *height* floor, not the width.
 *
 * The convention, matching Generate Video:
 *   - idle / no result yet → a 16:9 box at VIDEO_NODE_MIN_HEIGHT (≈654×368)
 *   - once a result exists  → snap to the result's *true* aspect ratio
 *     (driven by `useResultAspectRatio`, fed the raw videoWidth/videoHeight)
 *
 * Every video node spreads `videoNodeSizing(mediaAspectRatio)` onto <BaseNode>,
 * so size no longer depends on handle count and a new video node inherits the
 * correct, consistent footprint by default. Height — not width — is the lever,
 * so portrait (9:16) results stay correctly proportioned (240 wide) instead of
 * being inflated by a large width floor.
 */

/** Idle/auto-sized width floor for video nodes (px). */
export const VIDEO_NODE_MIN_WIDTH = 240

/**
 * Minimum preview height for video nodes (px). Drives the idle 16:9 box size
 * (≈654 wide at 368 tall) and is ≥ every video node's handle-stack height, so
 * it never clips pips. Matches Generate Video's floor.
 */
export const VIDEO_NODE_MIN_HEIGHT = 368

/** Aspect ratio for the idle placeholder before a result exists (16:9). */
export const VIDEO_NODE_DEFAULT_ASPECT = 16 / 9

/**
 * The canonical <BaseNode> sizing props for a video node. Spread onto BaseNode:
 *
 *   <BaseNode {...videoNodeSizing(mediaAspectRatio)} ... />
 *
 * `mediaAspectRatio` comes from `useResultAspectRatio` (undefined until a result
 * loads). For dual-mode nodes (e.g. Voice Changer), spread conditionally so the
 * video sizing only applies when the node is actually showing a video result.
 */
export function videoNodeSizing(mediaAspectRatio: number | undefined): {
  minWidth: number
  minHeight: number
  imageAspectRatio: number
} {
  return {
    minWidth: VIDEO_NODE_MIN_WIDTH,
    // When a result exists, floor the height at VIDEO_NODE_MIN_HEIGHT but let a
    // tall (portrait) result grow past it — round(minWidth / aspect) is the
    // natural height at the min width. Idle → exactly VIDEO_NODE_MIN_HEIGHT.
    minHeight: mediaAspectRatio
      ? Math.max(VIDEO_NODE_MIN_HEIGHT, Math.round(VIDEO_NODE_MIN_WIDTH / mediaAspectRatio))
      : VIDEO_NODE_MIN_HEIGHT,
    imageAspectRatio: mediaAspectRatio ?? VIDEO_NODE_DEFAULT_ASPECT,
  }
}

/**
 * Sizing for an **image-output** node. Same minimum size as a video node, but
 * the idle aspect resolves through a richer fallback chain:
 *
 *   rendered result  →  connected upstream image  →  16:9
 *
 * so a node with no result of its own still previews at the aspect of the image
 * it will transform (e.g. Edit Image fed a 3:4 photo previews 3:4), instead of a
 * generic 16:9 box. Pass `useResultAspectRatio(...).aspectRatio` as `resultAspect`
 * and `useUpstreamImageAspect(id)` as `upstreamAspect`. Delegates to
 * `videoNodeSizing` so video and image nodes share one sizing characteristic.
 */
export function imageNodeSizing(
  resultAspect: number | undefined,
  upstreamAspect: number | undefined,
): { minWidth: number; minHeight: number; imageAspectRatio: number } {
  return videoNodeSizing(resultAspect ?? upstreamAspect)
}

/**
 * Fit a node's box to a result `aspectRatio` (= width/height), **preserving the node's current
 * AREA** when the aspect changes. This keeps a node roughly the same size as its result rotates
 * between landscape and portrait: a user-resized 1600×900 (16:9) box becomes ~900×1600 for a 9:16
 * result — NOT 1600×2844 (which keeping the width would produce, making portrait nodes huge).
 *
 * - When the node already has a box (both `width` and `height`) AND has no chrome, re-fit at
 *   constant area: `w = √(area·aspect)`, `h = w/aspect`. Re-running once fitted is a no-op (stable).
 * - When `chromeHeight > 0` (inline-prompt nodes) AND the fit is to the SAME aspect the box already
 *   has (`prevAspectRatio === aspectRatio` — i.e. a manual horizontal-resize drag), the node is
 *   WIDTH-DRIVEN: the dragged `width` is used directly and height is re-derived
 *   (`h = chrome + max(minHeight, w/aspect)`). This avoids the rubber-band a
 *   `resizeDirection="horizontal"` drag would otherwise hit, since React Flow writes only width and
 *   area-preservation would re-fit it from the stale stored preview height.
 * - When the aspect CHANGES (a new result rotated landscape↔portrait), area is preserved EVEN WITH
 *   chrome — otherwise a 16:9→9:16 inline node keeps its wide width and balloons in height. The
 *   width-driven shortcut is strictly for same-aspect resize drags; aspect rotations always re-fit
 *   at constant preview area (the chrome is stripped out before the √ and re-added after).
 * - First fit (no prior height) starts from the node's `width` (or `minWidth`) — the snug default.
 * - Both dimensions are floored: width to the proportional minimum (`max(minWidth, minHeight·aspect)`,
 *   the narrowest box that keeps both `minHeight` and the aspect), height to `minHeight`.
 */
export function computeFittedNodeBox(opts: {
  aspectRatio: number
  width: number | undefined
  height: number | undefined
  minWidth: number
  minHeight: number
  /**
   * Fixed "chrome" height (px) below the aspect-locked preview sub-region —
   * e.g. the inline prompt editor + run strip. The preview is what stays at
   * `aspectRatio`; chrome is additive. Defaults to 0 (no chrome → today's
   * whole-node behavior). `minHeight` is the PREVIEW floor (un-inflated); the
   * caller is responsible for the node-level min clamp (`minHeight + chrome`).
   */
  chromeHeight?: number
  /**
   * The aspect ratio the node's box is CURRENTLY fitted to (i.e. the previous
   * `aspectRatio` this helper was last fed for this node). Lets the helper tell
   * a same-aspect manual resize (width-driven, chrome only) from a result-aspect
   * ROTATION (area-preserving, always). Omit/undefined ⇒ treated as a change ⇒
   * area is preserved. Only consulted when `chromeHeight > 0`.
   */
  prevAspectRatio?: number
}): { width: number; height: number } {
  const { aspectRatio, width, height, minWidth, minHeight } = opts
  const chrome = opts.chromeHeight ?? 0
  const proportionalMinWidth = Math.max(minWidth, minHeight * aspectRatio)
  // Width-driven ONLY for a chrome node being re-fitted to the SAME aspect it
  // already has — that is a manual `resizeDirection="horizontal"` drag, where
  // React Flow wrote only width and this re-derives height. Area preservation
  // there would re-fit width from the STALE stored preview height, rubber-banding
  // the drag. When the aspect CHANGES (new result rotated landscape↔portrait), we
  // fall through to the area-preserving √ branch EVEN WITH chrome — keeping the
  // wide width on a now-portrait result is exactly what made inline nodes balloon.
  // Non-chrome nodes (chrome === 0, every existing node) always area-preserve.
  const sameAspect = opts.prevAspectRatio === aspectRatio
  let baseW: number
  if (chrome > 0 && sameAspect) {
    baseW = typeof width === "number" ? width : minWidth
  } else {
    // Area math operates on the PREVIEW sub-area only (strip chrome out first).
    const previewH = typeof height === "number" ? Math.max(0, height - chrome) : undefined
    baseW =
      typeof width === "number" && typeof previewH === "number"
        ? Math.sqrt(width * previewH * aspectRatio) // preserve preview area, re-fit to new aspect
        : typeof width === "number"
          ? width
          : minWidth
  }
  const w = Math.max(baseW, proportionalMinWidth)
  const h = chrome + Math.max(minHeight, w / aspectRatio)
  return { width: w, height: h }
}
