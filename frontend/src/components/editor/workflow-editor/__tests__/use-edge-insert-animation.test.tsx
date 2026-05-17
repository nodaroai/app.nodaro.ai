import { describe, it, expect, beforeEach } from "vitest"
import { StrictMode } from "react"
import { render, act } from "@testing-library/react"
import { useEdgeInsertAnimation, __resetSeenEdgesForTests } from "../use-edge-insert-animation"

function TestComponent({ edgeId }: { edgeId: string }) {
  const animProps = useEdgeInsertAnimation(edgeId)
  // Wrap the <path> in an <svg> so jsdom renders it inside a valid namespace.
  return (
    <svg>
      <path data-testid="edge" d="M0,0 L100,100" style={animProps.style} />
    </svg>
  )
}

// Helper: flush the rAF + microtasks the hook uses to swap from
// initial (dashoffset = DASH_LENGTH) to animating (dashoffset = 0).
async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // Allow the post-rAF setState to flush.
    await Promise.resolve()
  })
}

describe("useEdgeInsertAnimation", () => {
  beforeEach(() => {
    // The hook tracks "seen" edge ids in a module-level Set. Reset it so
    // each test starts from a clean slate (the test runs share a module).
    __resetSeenEdgesForTests()
  })

  it("first mount hides the edge via stroke-dashoffset", () => {
    const { getByTestId } = render(<TestComponent edgeId="new-edge-1" />)
    const el = getByTestId("edge")
    // Initially: dasharray and dashoffset both set to DASH_LENGTH so the
    // visible portion of the stroke is fully off-screen (edge invisible).
    expect(el.style.strokeDasharray).toBe("9999")
    expect(el.style.strokeDashoffset).toBe("9999")
    // No transition on the initial frame — the browser would otherwise
    // collapse initial+animating into one paint.
    expect(el.style.transition).toBe("")
  })

  it("after animation frame, transitions to stroke-dashoffset:0 over 500ms", async () => {
    const { getByTestId } = render(<TestComponent edgeId="new-edge-2" />)
    await flushAnimationFrame()
    const el = getByTestId("edge")
    expect(el.style.strokeDasharray).toBe("9999")
    expect(el.style.strokeDashoffset).toBe("0")
    expect(el.style.transition).toContain("stroke-dashoffset")
    expect(el.style.transition).toContain("500ms")
  })

  it("re-rendering same edgeId after seen does not re-animate", async () => {
    // First render — record the edgeId as seen.
    const first = render(<TestComponent edgeId="seen-edge" />)
    await flushAnimationFrame()
    first.unmount()

    // Second mount of the same edgeId — should skip the animation entirely.
    // The path renders with no dasharray override (i.e. as a solid line).
    const { getByTestId } = render(<TestComponent edgeId="seen-edge" />)
    const el = getByTestId("edge")
    expect(el.style.strokeDasharray).toBe("")
    expect(el.style.strokeDashoffset).toBe("")
    expect(el.style.transition).toBe("")
  })

  it("different edgeIds each animate independently", async () => {
    const a = render(<TestComponent edgeId="indep-a" />)
    // a is a fresh edgeId so it starts hidden.
    expect(a.getByTestId("edge").style.strokeDashoffset).toBe("9999")
    await flushAnimationFrame()
    expect(a.getByTestId("edge").style.strokeDashoffset).toBe("0")
    a.unmount()

    const b = render(<TestComponent edgeId="indep-b" />)
    // b is a different edgeId — should also start hidden (not skipped).
    expect(b.getByTestId("edge").style.strokeDashoffset).toBe("9999")
  })

  // Regression guard. React 18 StrictMode simulates mount→unmount→remount for
  // every effect. The previous implementation added the edgeId to SEEN_EDGES
  // at rAF schedule time, so the cleanup cancelled the rAF but left the id
  // marked seen — the second mount then early-returned without scheduling a
  // new rAF, freezing phase at "initial" → strokeDashoffset stays at 9999
  // forever (edge invisible).
  it("recovers from StrictMode double-mount race (dashoffset transitions to 0)", async () => {
    const { getByTestId } = render(
      <StrictMode>
        <TestComponent edgeId="strict-mode-edge" />
      </StrictMode>,
    )
    await flushAnimationFrame()
    const el = getByTestId("edge")
    expect(el.style.strokeDashoffset).toBe("0")
    expect(el.style.transition).toContain("stroke-dashoffset")
  })
})
