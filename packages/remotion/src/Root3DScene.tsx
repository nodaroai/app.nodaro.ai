/**
 * Remotion entry point for the `3d-scene` previz composition.
 *
 * Its own entry (not Root.tsx, not Root3D.tsx) for two reasons:
 *  - three.js is ~600 KB; every non-3D render would pay for it in the main bundle.
 *  - Root3D.tsx loads @react-three/fiber, which installs its own React
 *    reconciler at module scope. This composition is native three.js and must
 *    not share a bundle with that reconciler.
 *
 * The render worker maps composition id `3d-scene` to this file; see
 * `getBundlePath()` in backend/src/workers/render-worker.ts.
 */
import React from "react"
import { Composition, registerRoot } from "remotion"
import { Scene3DRenderer } from "./compositions/scene3d-renderer"
import { SCENE3D_DEFAULT_PLAN } from "./scene3d/default-plan"
import type { Scene3DPlan } from "./scene3d/types"

/**
 * Bridge specific component prop types with Remotion's
 * LooseComponentType<Record<string, unknown>> requirement.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asRemotionComponent(Comp: React.FC<any>): React.FC<Record<string, unknown>> {
  const Wrapper: React.FC<Record<string, unknown>> = (props) => <Comp {...props} />
  Wrapper.displayName = `Remotion(${Comp.displayName ?? Comp.name})`
  return Wrapper
}

/** Only used by Remotion Studio / a bare CLI render; jobs always pass inputProps. */
const SCENE_3D_DEFAULT_PROPS: { plan: Scene3DPlan } = { plan: SCENE3D_DEFAULT_PLAN }

function Root3DScene() {
  return (
    <Composition
      id="3d-scene"
      component={asRemotionComponent(Scene3DRenderer)}
      durationInFrames={96}
      fps={24}
      width={1920}
      height={1080}
      defaultProps={SCENE_3D_DEFAULT_PROPS}
      // The plan is the single source of timing and framing: a CLI or Studio
      // render of an arbitrary plan gets the right metadata without the caller
      // restating width/height/fps/duration.
      calculateMetadata={({ props }) => {
        const plan = (props as { plan?: Scene3DPlan }).plan
        if (!plan) return {}
        return {
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          durationInFrames: Math.max(1, Math.round(plan.durationInFrames)),
        }
      }}
    />
  )
}

registerRoot(Root3DScene)
