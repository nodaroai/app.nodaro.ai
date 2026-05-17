/**
 * Returns a style object for an edge's SVG `<path>` that animates it in on
 * first mount (stroke draws from source to target over 500ms via
 * stroke-dashoffset).
 *
 * Idempotent per-edgeId: edges that have been seen before don't re-animate.
 * Uses a module-level Set to track seen IDs across renders (survives unmounts).
 *
 * Designed for the Film Director skill's live canvas construction (spec §5.4
 * Pattern A-prime). Mirrors the per-node `useNodeInsertAnimation` pattern:
 * each per-stage update_workflow_json call adds new edges to the React Flow
 * graph; this hook makes them visually stretch from source to target.
 *
 * Implementation: CSS-only via a generous stroke-dasharray (9999) — we don't
 * compute the actual path length per-edge because (a) it requires DOM access
 * to the path element, and (b) 9999 is comfortably larger than any realistic
 * edge length in the editor's coordinate space (~thousands of px max). The
 * cosmetic effect is identical: the dash "completes" off-screen and the user
 * sees a stretch from origin to target.
 *
 * Usage (inside a custom edge component):
 *   const animProps = useEdgeInsertAnimation(props.id)
 *   return <BaseEdge style={{ ...userStyle, ...animProps.style }} ... />
 *
 * The hook is pure React + CSS transitions — no external animation library.
 */
import { useLayoutEffect, useState, type CSSProperties } from "react"

/**
 * Module-level set of edge ids that have already played their entrance
 * animation. Lives at module scope (not in component state) so the animation
 * is not replayed when an edge component unmounts and remounts (e.g. React
 * Flow recycling, StrictMode double-render, or the edge scrolling out of
 * the virtualized viewport).
 */
const SEEN_EDGES = new Set<string>()

const ANIMATION_DURATION_MS = 500

/**
 * Generous dasharray — comfortably larger than any realistic edge length in
 * the React Flow coordinate space. Stays as a single dash so the visible
 * stroke either fully covers the path (offset = 0) or is fully hidden
 * (offset = DASH_LENGTH).
 */
const DASH_LENGTH = 9999

const FINAL_STYLE: CSSProperties = {
  // No dasharray/offset on subsequent mounts — the edge renders normally.
}

const ANIMATING_STYLE: CSSProperties = {
  strokeDasharray: String(DASH_LENGTH),
  strokeDashoffset: "0",
  transition: `stroke-dashoffset ${ANIMATION_DURATION_MS}ms ease-out`,
}

const INITIAL_STYLE: CSSProperties = {
  strokeDasharray: String(DASH_LENGTH),
  strokeDashoffset: String(DASH_LENGTH),
  // No transition on the initial frame — applying the transition only on
  // the swap to the animating state ensures the browser doesn't try to
  // animate FROM a previous render's "no style" to dashoffset:9999 (which
  // would flash the edge for one frame before the draw-in begins).
}

export interface EdgeInsertAnimationProps {
  /** Style to spread onto the SVG `<path>` element (or merge into BaseEdge `style`). */
  style: CSSProperties
}

export function useEdgeInsertAnimation(edgeId: string): EdgeInsertAnimationProps {
  // Initialize: "have we seen this edge before?". Reading the Set
  // synchronously during render lets us return the correct style on the
  // very first render — by the second render, we've added the id to the
  // Set so any subsequent mount of the same id skips the animation.
  const [phase, setPhase] = useState<"initial" | "animating" | "done">(() =>
    SEEN_EDGES.has(edgeId) ? "done" : "initial",
  )

  useLayoutEffect(() => {
    if (SEEN_EDGES.has(edgeId)) {
      // Subsequent mount of the same edge id — no animation, no work.
      // (Belt-and-suspenders: setPhase guarantees "done" wins even if the
      // lazy initializer raced earlier.)
      setPhase("done")
      return
    }
    // First mount for this edgeId: schedule the swap to the animating
    // state on the next frame. We use rAF (not setTimeout 0) so the
    // browser has actually painted the initial state before the
    // transition begins — otherwise the change may be batched into a
    // single paint and the animation skipped entirely.
    //
    // Adding to SEEN_EDGES happens INSIDE the rAF callback (not at
    // schedule time) so React 18 StrictMode's simulated mount→unmount→
    // remount cycle doesn't poison the set: the cleanup cancels the
    // first rAF before it fires, then the second mount re-schedules
    // cleanly. Marking the id seen on cancellation would early-return
    // on the second mount, freezing phase at "initial" → dashoffset 9999
    // (edge stays hidden).
    const rafId = requestAnimationFrame(() => {
      SEEN_EDGES.add(edgeId)
      setPhase("animating")
    })
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [edgeId])

  if (phase === "done") return { style: FINAL_STYLE }
  if (phase === "animating") return { style: ANIMATING_STYLE }
  return { style: INITIAL_STYLE }
}

/**
 * Test-only: reset the module-level seen-edge set so each test starts
 * with a clean slate. Production code MUST NOT call this — the seen-set
 * is intentionally shared across the whole app session.
 *
 * @internal
 */
export function __resetSeenEdgesForTests(): void {
  SEEN_EDGES.clear()
}
