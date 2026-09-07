// @vitest-environment jsdom
import type React from "react"
import { describe, it, expect, vi } from "vitest"

/**
 * The render worker asks Remotion for composition id `3d-scene` in the bundle
 * built from `Root3DScene.tsx`. If the id here ever drifts, every 3d-scene job
 * fails at `selectComposition` — after the queue, the reservation and a full
 * webpack build. This suite pins the registration and the metadata derivation
 * without launching a browser.
 */
const captured = vi.hoisted(() => ({
  root: null as null | (() => unknown),
  compositions: [] as Array<Record<string, unknown>>,
}))

vi.mock("remotion", () => ({
  registerRoot: (component: () => unknown) => {
    captured.root = component
  },
  Composition: (props: Record<string, unknown>) => {
    captured.compositions.push(props)
    return null
  },
  // pulled in transitively by the composition component
  AbsoluteFill: ({ children }: { children?: unknown }) => children,
  useCurrentFrame: () => 0,
  delayRender: () => 0,
  continueRender: () => undefined,
  cancelRender: () => undefined,
  getRemotionEnvironment: () => ({ isRendering: false }),
}))

const { render } = await import("@testing-library/react")
await import("../Root3DScene")
const { scene3DPlanSchema } = await import("@nodaro/shared")
const { SCENE3D_DEFAULT_PLAN } = await import("../scene3d/default-plan")

function composition() {
  expect(captured.root).toBeTypeOf("function")
  const Root = captured.root as () => React.ReactElement
  captured.compositions.length = 0
  render(<Root />)
  expect(captured.compositions).toHaveLength(1)
  return captured.compositions[0]
}

describe("Root3DScene", () => {
  it("registers exactly the composition id the render worker selects", () => {
    expect(composition().id).toBe("3d-scene")
  })

  it("ships default props that the shared contract accepts", () => {
    const props = composition().defaultProps as { plan: unknown }
    expect(props.plan).toBe(SCENE3D_DEFAULT_PLAN)
    expect(scene3DPlanSchema.safeParse(props.plan).success).toBe(true)
  })

  it("derives framing and timing from the plan instead of the static defaults", () => {
    const calculateMetadata = composition().calculateMetadata as (arg: {
      props: unknown
    }) => Record<string, number>

    const metadata = calculateMetadata({
      props: {
        plan: { ...SCENE3D_DEFAULT_PLAN, width: 1080, height: 1920, fps: 30, durationInFrames: 45 },
      },
    })

    expect(metadata).toEqual({ width: 1080, height: 1920, fps: 30, durationInFrames: 45 })
  })

  it("falls back to the registered metadata when no plan is passed", () => {
    const calculateMetadata = composition().calculateMetadata as (arg: {
      props: unknown
    }) => Record<string, number>
    expect(calculateMetadata({ props: {} })).toEqual({})
  })
})
