import { useCallback, useRef } from "react"
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
} from "remotion"
import { Scene3DCanvas } from "../scene3d/scene3d-canvas"
import type { Scene3DPlan } from "../scene3d/types"

interface Scene3DRendererProps {
  plan: Scene3DPlan
}

/**
 * Remotion composition for a Scene3D previz plan (composition id `3d-scene`).
 *
 * All it adds over `Scene3DCanvas` is the Remotion time source and the two
 * render-lifecycle hooks:
 *  - `delayRender` until the first frame has actually been drawn, so the
 *    encoder never captures an empty canvas;
 *  - `cancelRender` when WebGL is unavailable, so a failed context FAILS the
 *    job (and refunds) instead of encoding a video of an error message. In the
 *    Player/Studio the canvas keeps its in-place fallback instead.
 */
export function Scene3DRenderer({ plan }: Scene3DRendererProps) {
  const frame = useCurrentFrame()
  const initHandle = useRef<number | null>(null)
  // A state initializer is called twice by StrictMode and would orphan a
  // delay handle. The ref retains the one handle across its render replay.
  if (initHandle.current === null) initHandle.current = delayRender("Scene3D: initialising WebGL")
  const releasedRef = useRef(false)

  const onFirstDraw = useCallback(() => {
    if (releasedRef.current) return
    releasedRef.current = true
    continueRender(initHandle.current!)
  }, [])

  const onContextError = useCallback(
    (error: Error) => {
      if (getRemotionEnvironment().isRendering) {
        cancelRender(error)
        return
      }
      // Preview: release the handle so the Player stops waiting; the canvas
      // renders its own actionable fallback and the plan is untouched.
      onFirstDraw()
    },
    [onFirstDraw],
  )

  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      <Scene3DCanvas
        plan={plan}
        frame={frame}
        onFirstDraw={onFirstDraw}
        onContextError={onContextError}
      />
    </AbsoluteFill>
  )
}
