// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StrictMode } from "react"
import { render, cleanup } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  currentFrame: { value: 0 },
  environment: { isRendering: true },
  delayRender: vi.fn((_label?: string, _options?: unknown) => 7),
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
const { makeV2Plan } = await import("../../scene3d/v2/__tests__/v2-fixtures")

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

  it("CANCELS on a v2 asset failure too, not just on a WebGL failure", () => {
    render(<Scene3DRenderer plan={makeV2Plan()} assetUrls={{ cam: "https://x/y" }} />)
    const err = new Error("[SCENE_ASSET_INVALID] SHA-256 mismatch")
    ;(lastProps().onContextError as (e: Error) => void)(err)
    expect(mocks.cancelRender).toHaveBeenCalledWith(err)
    expect(mocks.continueRender).not.toHaveBeenCalled()
  })
})

describe("Scene3DRenderer — v2 asset plumbing", () => {
  it("builds a resolver from the JSON-only assetUrls prop", () => {
    // A resolver FUNCTION cannot cross `inputProps`, so the backend sends
    // short-lived URLs and the composition turns them into one here.
    render(<Scene3DRenderer plan={makeV2Plan()} assetUrls={{ cam: "https://assets/x" }} />)
    expect(lastProps().assetResolver).toBeDefined()
  })

  it("passes no resolver for a v1 plan (v1 has no assets)", () => {
    render(<Scene3DRenderer plan={makePlan()} />)
    expect(lastProps().assetResolver).toBeUndefined()
  })

  it("raises the delayRender timeout well past Remotion's 30s default", () => {
    // 64 MiB of assets over the network does not fit in 30 seconds, and the
    // default would abort a perfectly healthy render.
    render(<Scene3DRenderer plan={makeV2Plan()} assetUrls={{ cam: "https://assets/x" }} />)
    const options = mocks.delayRender.mock.calls[0][1] as { timeoutInMilliseconds: number }
    expect(options.timeoutInMilliseconds).toBeGreaterThanOrEqual(120_000)
  })

  it("lets the caller override the asset timeout", () => {
    render(
      <Scene3DRenderer
        plan={makeV2Plan()}
        assetUrls={{ cam: "https://assets/x" }}
        assetTimeoutInMilliseconds={300_000}
      />,
    )
    const options = mocks.delayRender.mock.calls[0][1] as { timeoutInMilliseconds: number }
    expect(options.timeoutInMilliseconds).toBe(300_000)
  })

  it("labels the v2 delay so a stuck render says WHAT it is waiting on", () => {
    render(<Scene3DRenderer plan={makeV2Plan()} assetUrls={{ cam: "https://assets/x" }} />)
    expect(mocks.delayRender.mock.calls[0][0]).toMatch(/verifying scene assets/)
  })
})
