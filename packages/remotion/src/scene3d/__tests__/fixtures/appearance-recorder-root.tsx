/**
 * TEST-ONLY Remotion root, used exclusively while RECORDING the historical
 * reference frames for `../render-appearance.test.ts`. Nothing ships it and no
 * assertion renders through it — the test itself always bundles the real
 * `src/Root3DScene.tsx`.
 *
 * ## Why it exists
 *
 * Two of the committed references are pictures of a look the code no longer
 * produces: the flat, untonemapped, shadowless v1 render from before PR #1328.
 * They are what makes the regression test able to FAIL — without them the suite
 * could only say "these pixels are stable", never "these pixels are not the old
 * ones".
 *
 * A revert of two lines in `scene-builder.ts` would produce them too, but not
 * reproducibly: the next person re-recording would have to know which two lines
 * and would silently record something else. This root reproduces the historical
 * look from a named argument instead, through the SAME composition, the SAME
 * canvas and the SAME builder as the live path.
 *
 * ## How it reaches the renderer
 *
 * `Scene3DCanvas` sets `shadowMap.enabled` and `toneMapping` from the handle
 * the BUILDER named, immediately before `renderer.render(...)`. There is no
 * prop, no context and no module export that overrides that — deliberately, so
 * that a deployment cannot drift from the authored look. So the override goes
 * where the value is finally consumed: a wrapper on
 * `THREE.WebGLRenderer.prototype.render` clobbers the two fields on the way in.
 * three re-derives each material's program key per render call, so toggling
 * `shadowMap.enabled` this way recompiles rather than reusing a shadowed
 * program.
 *
 * Patching a prototype is only tolerable because this module is unreachable
 * from production: it lives under `__tests__/`, and the only bundle that
 * contains it is one the recorder builds.
 */
import React from "react"
import * as THREE from "three"
import { Composition, registerRoot } from "remotion"
import { Scene3DRenderer } from "../../../compositions/scene3d-renderer"
import { APPEARANCE_PLAN } from "./appearance-plan"
import type { Scene3DPlanV1 } from "../../types"

/**
 * - `clay` — no override at all; identical to what `Root3DScene` renders.
 * - `no-shadows` — the clay tone map, shadow map off. Isolates the shadow
 *   contribution so the floor comparison cannot be confounded by ACES.
 * - `flat` — shadow map off AND `NoToneMapping` at exposure 1: the exact
 *   pre-#1328 v1 look.
 */
export type AppearanceOverride = "clay" | "no-shadows" | "flat"

let override: AppearanceOverride = "clay"

type RenderFn = THREE.WebGLRenderer["render"]

/**
 * three 0.170 does NOT put `render` on `WebGLRenderer.prototype` — the
 * constructor assigns `this.render = function (scene, camera) {…}` as an own
 * property, so there is no prototype method to wrap. A prototype ACCESSOR turns
 * that constructor-time assignment into the hook: the plain `=` in three's
 * constructor is a [[Set]], which finds this setter and hands us the real
 * function, and we install the wrapper as the instance's own `render`.
 */
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  get(): RenderFn | undefined {
    return undefined
  },
  set(this: THREE.WebGLRenderer, original: RenderFn) {
    const renderer = this
    Object.defineProperty(renderer, "render", {
      configurable: true,
      writable: true,
      value: (scene: Parameters<RenderFn>[0], camera: Parameters<RenderFn>[1]) => {
        // `Scene3DCanvas` has just set both fields from the handle the BUILDER
        // named; this is the last moment before three reads them.
        if (override !== "clay") renderer.shadowMap.enabled = false
        if (override === "flat") {
          renderer.toneMapping = THREE.NoToneMapping
          renderer.toneMappingExposure = 1
        }
        return original.call(renderer, scene, camera)
      },
    })
  },
})

interface RecorderProps {
  plan: Scene3DPlanV1
  appearance?: AppearanceOverride
}

/**
 * Same bridge `Root3DScene.tsx` uses between a typed component and Remotion's
 * `LooseComponentType<Record<string, unknown>>`. Copied rather than imported:
 * `Root3DScene.tsx` calls `registerRoot` at module scope, so importing it here
 * would register two roots in one bundle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asRemotionComponent(Comp: React.FC<any>): React.FC<Record<string, unknown>> {
  const Wrapper: React.FC<Record<string, unknown>> = (props) => <Comp {...props} />
  Wrapper.displayName = `Remotion(${Comp.displayName ?? Comp.name})`
  return Wrapper
}

function AppearanceRecorder({ plan, appearance }: RecorderProps) {
  // Set during render, read by the patched `render` on the same tick — the
  // canvas draws in a layout effect, always after this body has run.
  override = appearance ?? "clay"
  return <Scene3DRenderer plan={plan} />
}

function AppearanceRecorderRoot() {
  return (
    <Composition
      // The recorder must answer to the same id, so `selectComposition` in the
      // harness is byte-for-byte the call the render worker makes.
      id="3d-scene"
      component={asRemotionComponent(AppearanceRecorder)}
      durationInFrames={APPEARANCE_PLAN.durationInFrames}
      fps={APPEARANCE_PLAN.fps}
      width={APPEARANCE_PLAN.width}
      height={APPEARANCE_PLAN.height}
      defaultProps={{ plan: APPEARANCE_PLAN, appearance: "clay" }}
      calculateMetadata={({ props }) => {
        const plan = (props as { plan?: Scene3DPlanV1 }).plan
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

registerRoot(AppearanceRecorderRoot)
