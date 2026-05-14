import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, act } from "@testing-library/react"
import type { Node } from "@xyflow/react"
import { useCameraAutoPan } from "../use-camera-auto-pan"

// ---------------------------------------------------------------------------
// Mock @xyflow/react's useReactFlow so the hook can run outside a real
// ReactFlowProvider. We only need setCenter + getViewport.
// ---------------------------------------------------------------------------

const mockSetCenter = vi.fn()
const mockGetViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }))

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    setCenter: mockSetCenter,
    getViewport: mockGetViewport,
  }),
}))

// ---------------------------------------------------------------------------
// Test harness — renders the hook with a controllable `nodes` prop and
// exposes the returned onMove on a ref so tests can simulate user interaction.
// ---------------------------------------------------------------------------

interface HarnessRef {
  onMove: () => void
}

function Harness({
  nodes,
  controlRef,
}: {
  nodes: readonly Node[]
  controlRef: { current: HarnessRef | null }
}) {
  const control = useCameraAutoPan(nodes)
  controlRef.current = { onMove: control.onMove }
  return null
}

function makeNode(
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 100,
): Node {
  return {
    id,
    type: "test-node",
    position: { x, y },
    data: {},
    measured: { width, height },
  } as Node
}

describe("useCameraAutoPan", () => {
  // Tests use fake timers by default so we can deterministically advance
  // past the 500ms initial-load grace period. Each test that expects a
  // pan must call advancePastInitialLoadGrace() before its first rerender,
  // otherwise the gate suppresses the pan (which is the whole point of
  // the gate — initial workflow loads should NOT pan).
  beforeEach(() => {
    mockSetCenter.mockClear()
    mockGetViewport.mockClear()
    mockGetViewport.mockImplementation(() => ({ x: 0, y: 0, zoom: 1 }))
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Advance the fake clock past the hook's INITIAL_LOAD_GRACE_MS (500ms)
   * so subsequent renders are treated as "post-load" additions and trigger
   * the camera pan. Use after the initial render() that mounts the harness.
   */
  function advancePastInitialLoadGrace() {
    act(() => {
      vi.advanceTimersByTime(600)
    })
  }

  it("pans to the center of a newly-added node", () => {
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    advancePastInitialLoadGrace()

    // Add one node at (100, 200) with default 200×100 dims → center
    // should land at (200, 250).
    const node = makeNode("n1", 100, 200, 200, 100)
    rerender(<Harness nodes={[node]} controlRef={controlRef} />)

    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [cx, cy, opts] = mockSetCenter.mock.calls[0]
    expect(cx).toBe(200)
    expect(cy).toBe(250)
    expect(opts).toMatchObject({ duration: 600, zoom: 1 })
  })

  it("does not re-pan to an already-seen node on re-render", () => {
    const controlRef = { current: null as HarnessRef | null }
    // Render with the node already present so it's marked seen during
    // the initial-load grace period (no pan), then re-render with the
    // same array — still nothing new, still no pan.
    const node = makeNode("seen", 0, 0)
    const { rerender } = render(
      <Harness nodes={[node]} controlRef={controlRef} />,
    )
    expect(mockSetCenter).not.toHaveBeenCalled()

    // Advance past the grace period and re-render with the SAME array —
    // the node is already in the seen-set, so still no pan.
    advancePastInitialLoadGrace()
    rerender(<Harness nodes={[node]} controlRef={controlRef} />)
    expect(mockSetCenter).not.toHaveBeenCalled()
  })

  it("pans to the centroid when multiple nodes are added at once", () => {
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    advancePastInitialLoadGrace()

    // Two nodes whose centers are (100, 100) and (300, 500). Centroid:
    // ((100+300)/2, (100+500)/2) = (200, 300).
    const a = makeNode("a", 0, 50, 200, 100)
    const b = makeNode("b", 200, 450, 200, 100)
    rerender(<Harness nodes={[a, b]} controlRef={controlRef} />)

    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [cx, cy] = mockSetCenter.mock.calls[0]
    expect(cx).toBe(200)
    expect(cy).toBe(300)
  })

  it("suppresses auto-pan when the user moved within the last 2 seconds", () => {
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    advancePastInitialLoadGrace()

    // Simulate the user dragging the canvas — fires onMove (handleMoveStart).
    act(() => {
      controlRef.current?.onMove()
    })

    // Now add a new node — the hook should refuse to pan.
    const node = makeNode("just-added", 500, 500)
    rerender(<Harness nodes={[node]} controlRef={controlRef} />)
    expect(mockSetCenter).not.toHaveBeenCalled()

    // Add ANOTHER node — still within 2s, still suppressed. Both should
    // have been added to the seen-set so they are not re-considered later.
    const node2 = makeNode("also-added", 700, 700)
    rerender(<Harness nodes={[node, node2]} controlRef={controlRef} />)
    expect(mockSetCenter).not.toHaveBeenCalled()
  })

  it("re-activates auto-pan after the 2-second debounce expires", () => {
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    // Past the initial-load grace period before any user interaction.
    advancePastInitialLoadGrace()

    // User interacts — stamps lastUserInteraction = now.
    act(() => {
      controlRef.current?.onMove()
    })

    // Within 2s → suppressed.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender(
      <Harness
        nodes={[makeNode("during-debounce", 100, 100)]}
        controlRef={controlRef}
      />,
    )
    expect(mockSetCenter).not.toHaveBeenCalled()

    // After 2s elapsed → auto-pan re-activates for a brand-new node.
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    const node = makeNode("after-debounce", 400, 600, 200, 100)
    rerender(
      <Harness
        nodes={[makeNode("during-debounce", 100, 100), node]}
        controlRef={controlRef}
      />,
    )
    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [cx, cy] = mockSetCenter.mock.calls[0]
    // Just the new node — the "during-debounce" one was already added
    // to the seen-set on the suppressed render, so the centroid is the
    // single new node's center: (400+100, 600+50) = (500, 650).
    expect(cx).toBe(500)
    expect(cy).toBe(650)
  })

  it("preserves the current zoom when panning", () => {
    mockGetViewport.mockImplementation(() => ({ x: 0, y: 0, zoom: 2.5 }))
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    advancePastInitialLoadGrace()

    rerender(
      <Harness
        nodes={[makeNode("zoomed", 0, 0)]}
        controlRef={controlRef}
      />,
    )

    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [, , opts] = mockSetCenter.mock.calls[0]
    expect(opts.zoom).toBe(2.5)
  })

  it("falls back to default 200x100 when a node has no measured dimensions", () => {
    const controlRef = { current: null as HarnessRef | null }
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )
    advancePastInitialLoadGrace()

    // No measured prop — center should use defaults (200×100), so
    // (0,0) → (100, 50).
    const unmeasured = {
      id: "unmeasured",
      type: "test-node",
      position: { x: 0, y: 0 },
      data: {},
    } as Node
    rerender(<Harness nodes={[unmeasured]} controlRef={controlRef} />)

    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [cx, cy] = mockSetCenter.mock.calls[0]
    expect(cx).toBe(100)
    expect(cy).toBe(50)
  })

  // ---------------------------------------------------------------------
  // D3 regression-fix tests: initial-load grace period gate
  // ---------------------------------------------------------------------

  it("does not pan to nodes that appear within 500ms of mount (initial load)", () => {
    const controlRef = { current: null as HarnessRef | null }
    // Mount with 5 nodes immediately — simulates loading a saved workflow.
    // The hook's mountedAtRef stamps the current fake time on first render,
    // so these nodes are within the grace period.
    const nodes = [
      makeNode("load-1", 0, 0, 200, 100),
      makeNode("load-2", 300, 0, 200, 100),
      makeNode("load-3", 600, 0, 200, 100),
      makeNode("load-4", 0, 300, 200, 100),
      makeNode("load-5", 300, 300, 200, 100),
    ]
    const { rerender } = render(
      <Harness nodes={nodes} controlRef={controlRef} />,
    )

    // Within grace period — no pan.
    expect(mockSetCenter).not.toHaveBeenCalled()

    // Advance partway through the grace period and re-render with the
    // same nodes (they're already seen now). Still no pan.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    rerender(<Harness nodes={nodes} controlRef={controlRef} />)
    expect(mockSetCenter).not.toHaveBeenCalled()
  })

  it("does pan to nodes that appear after 500ms of mount (post-load addition)", () => {
    const controlRef = { current: null as HarnessRef | null }
    // Mount with no nodes.
    const { rerender } = render(
      <Harness nodes={[]} controlRef={controlRef} />,
    )

    // Advance past the 500ms grace period.
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Now add a node — this is a real post-load addition (skill-driven
    // or user-driven), so the camera should pan.
    const node = makeNode("post-load", 400, 600, 200, 100)
    rerender(<Harness nodes={[node]} controlRef={controlRef} />)

    expect(mockSetCenter).toHaveBeenCalledTimes(1)
    const [cx, cy] = mockSetCenter.mock.calls[0]
    // Node at (400, 600) with 200×100 dims → center (500, 650).
    expect(cx).toBe(500)
    expect(cy).toBe(650)
  })
})
