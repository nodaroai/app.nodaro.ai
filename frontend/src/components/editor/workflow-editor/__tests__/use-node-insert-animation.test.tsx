import { describe, it, expect, beforeEach } from "vitest"
import { StrictMode } from "react"
import { render, act } from "@testing-library/react"
import { useNodeInsertAnimation, __resetSeenNodesForTests } from "../use-node-insert-animation"

function TestComponent({ nodeId }: { nodeId: string }) {
  const style = useNodeInsertAnimation(nodeId)
  return <div data-testid="anim" style={style} />
}

// Helper: flush the rAF + microtasks the hook uses to swap from
// initial (opacity 0 / scale 0.85) to target (opacity 1 / scale 1).
async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // Allow the post-rAF setState to flush.
    await Promise.resolve()
  })
}

describe("useNodeInsertAnimation", () => {
  beforeEach(() => {
    // The hook tracks "seen" node ids in a module-level Set. Reset it so
    // each test starts from a clean slate (the test runs share a module).
    __resetSeenNodesForTests()
  })

  it("first mount sets opacity:0 + scale(0.85)", () => {
    const { getByTestId } = render(<TestComponent nodeId="new-node-1" />)
    const el = getByTestId("anim")
    expect(el.style.opacity).toBe("0")
    expect(el.style.transform).toContain("scale(0.85)")
  })

  it("after animation frame, transitions to opacity:1 + scale(1)", async () => {
    const { getByTestId } = render(<TestComponent nodeId="new-node-2" />)
    await flushAnimationFrame()
    const el = getByTestId("anim")
    expect(el.style.opacity).toBe("1")
    expect(el.style.transform).toContain("scale(1)")
    expect(el.style.transition).toContain("opacity 300ms")
    expect(el.style.transition).toContain("transform 300ms")
  })

  it("re-rendering same nodeId after seen does not re-animate", async () => {
    // First render — record the nodeId as seen.
    const first = render(<TestComponent nodeId="seen-node" />)
    await flushAnimationFrame()
    first.unmount()

    // Second mount of the same nodeId — should skip the animation.
    const { getByTestId } = render(<TestComponent nodeId="seen-node" />)
    const el = getByTestId("anim")
    expect(el.style.opacity).toBe("1")
    expect(el.style.transform).not.toContain("0.85")
  })

  it("different nodeIds each animate independently", async () => {
    const a = render(<TestComponent nodeId="indep-a" />)
    expect(a.getByTestId("anim").style.opacity).toBe("0")
    await flushAnimationFrame()
    expect(a.getByTestId("anim").style.opacity).toBe("1")
    a.unmount()

    const b = render(<TestComponent nodeId="indep-b" />)
    // b is a fresh nodeId so it should start at 0 (not "seen" yet).
    expect(b.getByTestId("anim").style.opacity).toBe("0")
  })

  // Regression guard. React 18 StrictMode simulates mount→unmount→remount for
  // every effect. The previous implementation added the nodeId to SEEN_NODES
  // at rAF schedule time, so the cleanup cancelled the rAF but left the id
  // marked seen — the second mount then early-returned without scheduling a
  // new rAF, freezing phase at "initial" → opacity 0 forever. Visible in
  // dev as nodes rendering without their card frame: the EditableNodeLabel
  // sibling shows normally but the BaseNode wrapper is invisible.
  it("recovers from StrictMode double-mount race (opacity transitions to 1)", async () => {
    const { getByTestId } = render(
      <StrictMode>
        <TestComponent nodeId="strict-mode-node" />
      </StrictMode>,
    )
    await flushAnimationFrame()
    const el = getByTestId("anim")
    expect(el.style.opacity).toBe("1")
    expect(el.style.transform).toContain("scale(1)")
  })
})
