/**
 * The availability sets arrive AFTER first paint, from one authenticated
 * fetch. The picker and the model dropdowns read them through plain functions
 * during render, so without a subscription nothing re-renders when they land
 * and a deployment's whitelist silently does nothing in the UI — every user
 * keeps seeing every node and model for the rest of the session. That shipped,
 * and is what this pins.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, act } from "@testing-library/react"

vi.mock("../surface-profile", () => ({
  runtimeSurfaceProfile: () => ({ nodes: { deny: [], allow: [] }, models: { deny: [], allow: [] } }),
}))

const { useSurfaceAvailability, isNodeUnavailable, isModelUnavailable, __resetSurfaceAvailabilityForTests } =
  await import("../surface-availability")

let renders = 0
function Picker() {
  useSurfaceAvailability()
  renders += 1
  return <div data-testid="out">{isNodeUnavailable("suno-generate") ? "hidden" : "shown"}</div>
}

beforeEach(() => {
  renders = 0
  __resetSurfaceAvailabilityForTests(null)
})

describe("availability is reactive", () => {
  it("a component re-renders and narrows when the sets arrive", () => {
    const { getByTestId } = render(<Picker />)
    // Pre-fetch: only the static profile deny applies, which is empty here.
    expect(getByTestId("out").textContent).toBe("shown")
    const before = renders

    act(() => {
      __resetSurfaceAvailabilityForTests({ nodes: ["suno-generate"], models: [] })
    })

    expect(renders).toBeGreaterThan(before)
    expect(getByTestId("out").textContent).toBe("hidden")
  })

  it("unmounted components stop being notified (no listener leak)", () => {
    const { unmount } = render(<Picker />)
    unmount()
    const after = renders
    act(() => {
      __resetSurfaceAvailabilityForTests({ nodes: ["x"], models: [] })
    })
    expect(renders).toBe(after)
  })

  it("the helpers still answer for non-React callers", () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["a"], models: ["m"] })
    expect(isNodeUnavailable("a")).toBe(true)
    expect(isNodeUnavailable("b")).toBe(false)
    expect(isModelUnavailable("m")).toBe(true)
  })
})
