/**
 * Single source of truth for the zoom-aware floor used by the node UI.
 *
 * Node-UI text/chrome compensates React Flow's canvas zoom so its visual size never drops below
 * `NODE_VISUAL_SCALE_FLOOR × natural` when the canvas is zoomed out. Above the floor (zoom ≥ FLOOR)
 * it scales 1:1 with the canvas — growing when zoomed in. None of it scales with the per-node zoom
 * (`data.zoom`).
 *
 * Two consumer families, by WHERE the element renders relative to React Flow's per-node
 * `scale(zoom)` wrapper — both land on the same on-screen size, so a portal pill tracks the
 * floating node title exactly at every zoom (the whole point of sharing this floor):
 *   - PORTAL content (e.g. a `NodeToolbar` pill/strip) renders OUTSIDE the wrapper, so it sizes
 *     itself: `flooredCanvasScale(canvasZoom)` (below).
 *   - IN-NODE content (the floating title, typed-handle labels) renders INSIDE the wrapper, so it
 *     counter-scales by `Math.max(1, FLOOR / Math.max(zoom, 0.01))` only below the floor.
 *
 * Past iterations have used 0.75 and 1.0. Tune via single-line edit here.
 */
export const NODE_VISUAL_SCALE_FLOOR = 0.6

/**
 * On-screen scale for PORTAL node-UI content (e.g. a `NodeToolbar` pill/strip), which renders
 * outside React Flow's per-node `scale(zoom)` wrapper and so must size itself. Floors at
 * `NODE_VISUAL_SCALE_FLOOR` when the canvas is zoomed out; tracks canvas zoom 1:1 above it. Pass the
 * canvas (viewport) zoom ONLY — not the per-node zoom — so the content matches the floating node
 * title (`EditableNodeLabel`, which ignores per-node zoom) at every zoom.
 */
export const flooredCanvasScale = (canvasZoom: number) => Math.max(NODE_VISUAL_SCALE_FLOOR, canvasZoom)
