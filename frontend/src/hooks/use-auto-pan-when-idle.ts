"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useReactFlow } from "@xyflow/react"

const IDLE_MS = 5000

interface Opts {
  /**
   * Whether the auto-pan logic is active. When false, the hook still tracks
   * idle state (so the "Follow build →" button can re-arm when the user
   * starts a pipeline) but never pans.
   */
  readonly enabled: boolean
  /**
   * The React Flow node id to keep centered while the user is idle. Typically
   * fed by `usePipelineEvents().lastAddedPipelineNodeId` so the pan follows
   * the freshest entity materialization.
   */
  readonly focusNodeId: string | null
}

interface UseAutoPanResult {
  /**
   * True when the user hasn't interacted with the canvas for `IDLE_MS`. The
   * "Follow build →" button is hidden in this state.
   */
  readonly isIdle: boolean
  /**
   * Resets the idle state to "idle now". Used by the manual "Follow build →"
   * button to immediately resume auto-pan after the user has been moving
   * around — without waiting for the natural 5s debounce to fire.
   */
  readonly followBuild: () => void
}

/**
 * Phase 1B.4 — auto-pan the canvas to the freshest pipeline-owned node when
 * the user is idle. Pointer/wheel/key events on `window` count as
 * interaction; 5 seconds of no interaction flips `isIdle=true` and triggers
 * a `setCenter` call on every subsequent `focusNodeId` change.
 *
 * The hook listens at the `window` level (not React Flow's own pane) so that
 * panel interactions (e.g., scrolling the pipeline panel on the right) also
 * count as user activity and pause auto-pan.
 */
export function useAutoPanWhenIdle({ enabled, focusNodeId }: Opts): UseAutoPanResult {
  const { getNode, setCenter } = useReactFlow()
  const [isIdle, setIsIdle] = useState(true)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onUserInteract = useCallback(() => {
    setIsIdle(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setIsIdle(true), IDLE_MS)
  }, [])

  useEffect(() => {
    const events: ReadonlyArray<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "wheel",
      "keydown",
    ]
    events.forEach((evt) =>
      window.addEventListener(evt, onUserInteract, { passive: true }),
    )
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, onUserInteract))
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [onUserInteract])

  useEffect(() => {
    if (!enabled || !isIdle || !focusNodeId) return
    const node = getNode(focusNodeId)
    if (!node) return
    setCenter(node.position.x + 100, node.position.y + 60, {
      zoom: 0.8,
      duration: 600,
    })
  }, [enabled, isIdle, focusNodeId, getNode, setCenter])

  const followBuild = useCallback(() => {
    // Re-arm immediately — re-renders pick up `isIdle=true` and the
    // focus-effect above pans to the current `focusNodeId`.
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    setIsIdle(true)
  }, [])

  return { isIdle, followBuild }
}
