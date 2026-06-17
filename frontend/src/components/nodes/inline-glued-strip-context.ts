import { createContext } from "react"

/**
 * True when a node's run strip is rendered DOM-glued inside the node wrapper
 * (inline prompt mode) rather than via React Flow's `<NodeToolbar>` portal.
 *
 * The portal renders OUTSIDE the viewport transform, so the bespoke quick
 * toolbars self-scale by zoom (`toolbarTransform`) to match the node. A glued
 * strip lives INSIDE the viewport, which already applies `scale(zoom)`, so the
 * toolbar must NOT self-scale or it double-scales. Quick toolbars read this and
 * drop their `toolbarTransform` when true.
 *
 * Why glued at all: `<NodeToolbar>` positions off the node's async-MEASURED
 * height, which lags the explicitly-derived `node.height` during a resize, so
 * the pill drifts "too far / too close". A glued strip tracks the same
 * `node.height` the card does, so it stays attached to the card's bottom.
 */
export const InlineGluedStripContext = createContext(false)
