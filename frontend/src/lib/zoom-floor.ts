/**
 * Single source of truth for the zoom-aware floor used by the node UI.
 *
 * The floating editable title, typed-handle labels, and the Generate Image
 * quick toolbar all compensate React Flow's canvas zoom so their visual
 * size never drops below `NODE_VISUAL_SCALE_FLOOR × natural` when the
 * canvas is zoomed out. Above the floor (zoom ≥ FLOOR) they scale 1:1
 * with the canvas — growing when zoomed in, matching the node's own
 * growth.
 *
 * Keep this value in sync across all three consumers via this module:
 *   - `components/nodes/editable-node-label.tsx`
 *   - `components/nodes/handle-with-popover.tsx`
 *   - `components/nodes/generate-image-quick-toolbar.tsx`
 *
 * Past iterations have used 0.75 and 1.0. Tune via single-line edit here.
 */
export const NODE_VISUAL_SCALE_FLOOR = 0.6
