// @vitest-environment jsdom
import { StrictMode } from "react"
import { render, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  lost: new WeakSet<HTMLCanvasElement>(),
  created: 0,
  draw: vi.fn(),
  dispose: vi.fn(),
  lose: vi.fn(),
}))
vi.mock("three", async (original) => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: class {
    shadowMap = { enabled: false, type: 0 }
    domElement: HTMLCanvasElement
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      if (state.lost.has(canvas)) throw new Error("The canvas context was lost")
      this.domElement = canvas
      state.created++
    }
    setPixelRatio() {}
    setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height }
    render() { state.draw() }
    dispose() { state.dispose() }
    forceContextLoss() { state.lost.add(this.domElement); state.lose() }
  },
}))
const { Scene3DCanvas } = await import("../scene3d-canvas")
const { makePlan } = await import("./fixtures")

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  state.lost = new WeakSet()
  state.created = 0
})
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers() })

describe("Scene3D preview lifecycle", () => {
  it("survives StrictMode remount and repeated immutable edits, then releases the context on unmount", () => {
    const onError = vi.fn()
    const plan = makePlan()
    const { rerender, unmount, queryByRole } = render(
      <StrictMode><Scene3DCanvas plan={plan} frame={0} onContextError={onError} /></StrictMode>,
    )
    vi.runOnlyPendingTimers()
    expect(onError).not.toHaveBeenCalled()
    expect(queryByRole("alert")).toBeNull()
    expect(state.lose).not.toHaveBeenCalled()
    const created = state.created
    for (const x of [1, 2, 3]) {
      rerender(<StrictMode><Scene3DCanvas plan={{ ...plan, camera: { ...plan.camera, position: [x, 2, 8] } }} frame={24} onContextError={onError} /></StrictMode>)
    }
    expect(state.created).toBe(created)
    expect(state.draw.mock.calls.length).toBeGreaterThan(3)
    expect(onError).not.toHaveBeenCalled()
    unmount()
    vi.runOnlyPendingTimers()
    expect(state.lose).toHaveBeenCalledTimes(1)
  })

  it("shows a fallback when scene construction fails", () => {
    const onError = vi.fn()
    const plan = { ...makePlan(), objects: [null] } as never
    const { getByRole } = render(<Scene3DCanvas plan={plan} frame={0} onContextError={onError} />)
    expect(getByRole("alert").textContent).toContain("3D preview unavailable")
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})
