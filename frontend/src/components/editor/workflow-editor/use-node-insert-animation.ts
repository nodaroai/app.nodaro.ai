/**
 * Returns a style object for a node's wrapper that animates it in on first
 * mount (opacity 0 → 1, scale 0.85 → 1, over 300ms).
 *
 * Idempotent per-nodeId: nodes that have been seen before don't re-animate.
 * Uses a module-level Set to track seen IDs across renders (survives unmounts).
 *
 * Designed for the Film Director skill's live canvas construction (spec §5.4
 * Pattern A-prime). Each per-stage update_workflow_json call adds new nodes
 * to the React Flow graph; this hook makes them visually fade in.
 *
 * Usage:
 *   const style = useNodeInsertAnimation(props.id)
 *   return <div style={style}>...</div>
 *
 * The hook is pure React + CSS transitions — no external animation library.
 */
import { useLayoutEffect, useState, type CSSProperties } from "react"

/**
 * Module-level set of node ids that have already played their entrance
 * animation. Lives at module scope (not in component state) so the animation
 * is not replayed when a node component unmounts and remounts (e.g. React
 * Flow recycling, StrictMode double-render, or the node briefly scrolling
 * out of the virtualized viewport).
 */
const SEEN_NODES = new Set<string>()

const ANIMATION_DURATION_MS = 300
const INITIAL_SCALE = 0.85

const FINAL_STYLE: CSSProperties = {
  opacity: 1,
  transform: "scale(1)",
}

const ANIMATING_STYLE: CSSProperties = {
  opacity: 1,
  transform: "scale(1)",
  transition: `opacity ${ANIMATION_DURATION_MS}ms ease-out, transform ${ANIMATION_DURATION_MS}ms ease-out`,
  willChange: "opacity, transform",
}

const INITIAL_STYLE: CSSProperties = {
  opacity: 0,
  transform: `scale(${INITIAL_SCALE})`,
  // No transition on the initial frame — applying the transition only on
  // the swap to the final state ensures the browser doesn't try to animate
  // FROM a previous render's "no style" to opacity:0 (which would result
  // in a flicker before the fade-in begins).
  willChange: "opacity, transform",
}

export function useNodeInsertAnimation(nodeId: string): CSSProperties {
  // Initialize: "have we seen this node before?". Reading the Set
  // synchronously during render lets us return the correct style on the
  // very first render — by the second render, we've added the id to the
  // Set so any subsequent mount of the same id skips the animation.
  const [phase, setPhase] = useState<"initial" | "animating" | "done">(() =>
    SEEN_NODES.has(nodeId) ? "done" : "initial",
  )

  useLayoutEffect(() => {
    if (SEEN_NODES.has(nodeId)) {
      // Subsequent mount of the same node id — no animation, no work.
      return
    }
    // First mount for this nodeId: mark seen, then schedule the swap to
    // the animating state on the next frame. We use rAF (not setTimeout 0)
    // so the browser has actually painted the initial state before the
    // transition begins — otherwise the change may be batched into a single
    // paint and the animation skipped entirely.
    SEEN_NODES.add(nodeId)
    const rafId = requestAnimationFrame(() => {
      setPhase("animating")
    })
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [nodeId])

  if (phase === "done") return FINAL_STYLE
  if (phase === "animating") return ANIMATING_STYLE
  return INITIAL_STYLE
}

/**
 * Test-only: reset the module-level seen-node set so each test starts
 * with a clean slate. Production code MUST NOT call this — the seen-set
 * is intentionally shared across the whole app session.
 */
export function __resetSeenNodesForTests(): void {
  SEEN_NODES.clear()
}
