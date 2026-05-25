/**
 * Canonical priority for execution-state edge accents.
 *
 * Two callers need to agree on which color "wins" when an edge has BOTH
 * its source AND target running concurrently (fan-out execution):
 *   1. `workflow-canvas.tsx` paints the edge stroke when assigning
 *      animated edge data (the stroke COLOR carries data-direction).
 *   2. `animated-flow-edge.tsx` paints the hover-glow color when the
 *      popover hovers a connection row (the GLOW signals user attention).
 *
 * If the two priorities disagree, a both-running edge renders one color
 * for stroke and another for glow — visually contradicting the data-flow
 * signal. This helper is the single source of truth.
 *
 * Priority: output-running (isRunning) > input-running (isInputRunning) >
 * neutral. Output-running wins because the source's output is the
 * data being emitted; the target's incoming animation is downstream.
 */

/** Exported so the animated stroke dots (animated-flow-edge.tsx) use the
 *  same colors as the stroke and glow — otherwise a future palette tweak
 *  here would silently leave the dots on the old hex values. */
export const ACCENT_PINK = "#ff0073"
export const ACCENT_BLUE = "#3b82f6"
const PINK_GLOW = "drop-shadow(0 0 6px rgba(255, 0, 115, 0.55))"
const BLUE_GLOW = "drop-shadow(0 0 6px rgba(59, 130, 246, 0.55))"

export interface EdgeAccent {
  readonly stroke: string
  readonly glow: string
}

export function pickEdgeAccent(isRunning: boolean, isInputRunning: boolean): EdgeAccent {
  if (isRunning) return { stroke: ACCENT_PINK, glow: PINK_GLOW }
  if (isInputRunning) return { stroke: ACCENT_BLUE, glow: BLUE_GLOW }
  return { stroke: ACCENT_PINK, glow: PINK_GLOW }
}
