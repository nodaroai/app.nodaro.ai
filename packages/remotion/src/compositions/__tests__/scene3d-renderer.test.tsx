// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StrictMode } from "react"
import { render, cleanup } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  currentFrame: { value: 0 },
  environment: { isRendering: true },
  delayRender: vi.fn(() => 7),
  continueRender: vi.fn(),
  cancelRender: vi.fn(),
  canvasProps: [] as Array<Record<string, unknown>>,
}))

vi.mock("remotion", () => ({
  useCurrentFrame: () => mocks.currentFrame.value,
  delayRender: mocks.delayRender,
  continueRender: mocks.continueRender,
  cancelRender: mocks.cancelRender,
  getRemotionEnvironment: () => mocks.environment,
  AbsoluteFill: ({ children }: { children?: unknown }) => children,
}))

// Stand in for the real canvas so this suite tests the RENDER LIFECYCLE
// (delayRender / continueRender / cancelRender) rather than WebGL.
vi.mock("../../scene3d/scene3d-canvas", () => ({
  Scene3DCanvas: (props: Record<string, unknown>) => {
    mocks.canvasProps.push(props)
    return null
  },
}))

const { Scene3DRenderer } = await import("../scene3d-renderer")
const { makePlan } = await import("../../scene3d/__tests__/fixtures")

const lastProps = () => mocks.canvasProps[mocks.canvasProps.length - 1]

beforeEach(() => {
  mocks.canvasProps.length = 0
  mocks.currentFrame.value = 0
  mocks.environment.isRendering = true
  mocks.delayRender.mockClear()
  mocks.continueRender.mockClear()
  mocks.cancelRender.mockClear()
})
afterEach(() => cleanup())

describe("Scene3DRenderer", () => {
  it("feeds Remotion's current frame straight into the shared canvas", () => {
    const plan = makePlan()
    mocks.currentFrame.value = 31
    render(<Scene3DRenderer plan={plan} />)
    expect(lastProps().frame).toBe(31)
    expect(lastProps().plan).toBe(plan)
  })

  it("holds the render until the first frame is actually drawn", () => {
    render(<Scene3DRenderer plan={makePlan()} />)
    expect(mocks.delayRender).toHaveBeenCalledTimes(1)
    expect(mocks.continueRender).not.toHaveBeenCalled()

    ;(lastProps().onFirstDraw as () => void)()
    expect(mocks.continueRender).toHaveBeenCalledWith(7)
  })

  it("releases the handle only once even if the canvas reports several draws", () => {
    render(<Scene3DRenderer plan={makePlan()} />)
    const onFirstDraw = lastProps().onFirstDraw as () => void
    onFirstDraw()
    onFirstDraw()
    onFirstDraw()
    expect(mocks.continueRender).toHaveBeenCalledTimes(1)
  })

  it("creates only one render delay under StrictMode replay", () => {
    render(<StrictMode><Scene3DRenderer plan={makePlan()} /></StrictMode>)
    expect(mocks.delayRender).toHaveBeenCalledTimes(1)
    ;(lastProps().onFirstDraw as () => void)()
    expect(mocks.continueRender).toHaveBeenCalledTimes(1)
  })

  it("CANCELS the render when WebGL fails during an export — never encodes a placeholder", () => {
    render(<Scene3DRenderer plan={makePlan()} />)
    const err = new Error("WebGL is unavailable")
    ;(lastProps().onContextError as (e: Error) => void)(err)
    expect(mocks.cancelRender).toHaveBeenCalledWith(err)
    expect(mocks.continueRender).not.toHaveBeenCalled()
  })

  it("keeps the preview alive instead of cancelling when it is not a render", () => {
    mocks.environment.isRendering = false
    render(<Scene3DRenderer plan={makePlan()} />)
    ;(lastProps().onContextError as (e: Error) => void)(new Error("no WebGL"))
    expect(mocks.cancelRender).not.toHaveBeenCalled()
    // the Player must stop waiting on the delayRender handle
    expect(mocks.continueRender).toHaveBeenCalledWith(7)
  })
})
