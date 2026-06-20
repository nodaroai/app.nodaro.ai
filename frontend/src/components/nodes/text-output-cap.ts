/**
 * Streamed text-output nodes (Generate Text / `llm-chat`, Image-to-Text) render
 * their result in a scroll region. Those nodes have no fixed height, so React
 * Flow auto-sizes them to content — which means a long (or streaming) result
 * grows the node taller and taller without bound.
 *
 * To stop that, the output region auto-grows only up to ~{@link MAX_OUTPUT_LINES}
 * lines and then scrolls. The cap applies ONLY while the node is auto-sized: once
 * the user drag-resizes it (React Flow marks the node `rf-resized`), they own the
 * height and the region fills it instead (so dragging taller still works).
 */

/** Max number of text lines the output region auto-grows to before scrolling. */
export const MAX_OUTPUT_LINES = 10

/**
 * Cap height (px) for the scroll region. `text-sm` (14px) × `leading-relaxed`
 * (1.625) ≈ 22.75px per line, plus the text block's `pt-0.5` + `pb-3` vertical
 * padding (~14px). Logical px — measured/applied inside the node's own
 * (zoom-scaled) wrapper, so it stays "~10 lines" at any node zoom.
 */
export const MAX_OUTPUT_HEIGHT = Math.round(MAX_OUTPUT_LINES * 22.75) + 14 // ≈ 242

/**
 * Whether the output region should be height-capped (and thus scroll) rather
 * than grow the node. Caps only in auto-size mode once the natural content
 * height exceeds the max; never once the user has manually resized the node.
 */
export function shouldCapOutput(
  contentHeight: number,
  isResized: boolean,
  maxHeight: number = MAX_OUTPUT_HEIGHT,
): boolean {
  return !isResized && contentHeight > maxHeight
}
