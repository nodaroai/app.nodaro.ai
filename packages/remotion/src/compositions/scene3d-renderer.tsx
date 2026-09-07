import { useCallback, useMemo, useRef } from "react"
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
} from "remotion"
import { Scene3DCanvas, type Scene3DAnyPlan } from "../scene3d/scene3d-canvas"
import { createUrlAssetResolver } from "../scene3d/v2/asset-resolver"
import { isScene3DPlanV2 } from "../scene3d/v2/plan-shape"

/**
 * Assets can be tens of megabytes over the network, and Remotion's default
 * `delayRender` timeout is 30 s — which would abort a perfectly healthy v2
 * render. NOTE for the worker side: `renderMedia({timeoutInMilliseconds})` must
 * be at least this too, since the shorter of the two wins.
 */
const DEFAULT_ASSET_TIMEOUT_MS = 120_000

export interface Scene3DRendererProps {
  plan: Scene3DAnyPlan
  /**
   * `assetId → short-lived authorized URL`. Required for a v2 plan: the plan
   * persists ids and digests only, so the transport URLs are minted per render
   * and travel in `inputProps` (a resolver FUNCTION cannot cross that boundary).
   */
  assetUrls?: Record<string, string>
  assetTimeoutInMilliseconds?: number
}

/**
 * Remotion composition for a Scene3D previz plan (composition id `3d-scene`).
 *
 * All it adds over `Scene3DCanvas` is the Remotion time source and the two
 * render-lifecycle hooks:
 *  - `delayRender` until the first frame has actually been drawn — for v2 that
 *    is after every asset has been fetched, digest-verified and validated, so
 *    the encoder never captures an empty canvas or a half-loaded scene;
 *  - `cancelRender` when WebGL is unavailable OR an asset fails, so a failed
 *    context/download FAILS the job (and refunds) instead of encoding a video
 *    of an error message. In the Player/Studio the canvas keeps its in-place
 *    fallback instead.
 */
export function Scene3DRenderer({
  plan,
  assetUrls,
  assetTimeoutInMilliseconds,
}: Scene3DRendererProps) {
  const frame = useCurrentFrame()
  const initHandle = useRef<number | null>(null)
  // A state initializer is called twice by StrictMode and would orphan a
  // delay handle. The ref retains the one handle across its render replay.
  if (initHandle.current === null) {
    initHandle.current = delayRender(
      isScene3DPlanV2(plan)
        ? "Scene3D v2: loading and verifying scene assets"
        : "Scene3D: initialising WebGL",
      { timeoutInMilliseconds: assetTimeoutInMilliseconds ?? DEFAULT_ASSET_TIMEOUT_MS },
    )
  }
  const releasedRef = useRef(false)

  const onFirstDraw = useCallback(() => {
    if (releasedRef.current) return
    releasedRef.current = true
    continueRender(initHandle.current as number)
  }, [])

  const onFatalError = useCallback(
    (error: Error) => {
      if (getRemotionEnvironment().isRendering) {
        // Fails the job. Deliberately NOT `continueRender` — a released handle
        // over a broken scene is exactly how a placeholder MP4 gets encoded.
        // Written as an `else` rather than an early return because Remotion
        // types `cancelRender` as `never`, which makes a `return` after it
        // "unreachable" to tsc while still being the behaviour that matters.
        cancelRender(error)
      } else {
        // Preview: release the handle so the Player stops waiting; the canvas
        // renders its own actionable fallback and the plan is untouched.
        onFirstDraw()
      }
    },
    [onFirstDraw],
  )

  // Built from JSON, not passed in: `inputProps` is serialized, so the render
  // side can only ever receive URLs. The browser preview passes a real
  // resolver to `Scene3DCanvas` directly and never goes through here.
  const assetResolver = useMemo(
    () => (assetUrls ? createUrlAssetResolver(assetUrls) : undefined),
    [assetUrls],
  )

  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      <Scene3DCanvas
        plan={plan}
        frame={frame}
        assetResolver={assetResolver}
        onFirstDraw={onFirstDraw}
        onContextError={onFatalError}
      />
    </AbsoluteFill>
  )
}
