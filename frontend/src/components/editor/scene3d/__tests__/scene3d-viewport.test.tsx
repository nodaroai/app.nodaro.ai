import { describe, it, expect, vi, beforeEach } from "vitest"
import { useEffect } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { Scene3DViewport } from "../scene3d-viewport"
import { makeV2Plan, REV_V2, REV_V2_B } from "@/lib/scene3d/__tests__/fixture"

/**
 * The v2 readiness contract, which only exists once there is a canvas: assets
 * are downloaded, digest-checked and validated BEFORE anything is drawn, so
 * there is a real interval with no frame — and a failure in it must be shown
 * instead of a frame, never as well as one.
 *
 * jsdom has no WebGL and the real canvas would never mount, so both it and the
 * WebGL probe are stubbed. What is under test is the VIEWPORT's state machine
 * around the canvas, which is where recovery lives.
 */
vi.mock("@/lib/scene3d/webgl", () => ({ hasWebGL: () => true }))

/** Revision id → what the stubbed canvas does with it. */
const behaviour = new Map<string, "draw" | "fail" | "hang">()

vi.mock("@remotion-pkg/scene3d", () => ({
  Scene3DCanvas: ({
    plan,
    onContextError,
    onFirstDraw,
  }: {
    plan: { revisionId: string }
    onContextError?: (error: Error) => void
    onFirstDraw?: () => void
  }) => {
    useEffect(() => {
      const mode = behaviour.get(plan.revisionId) ?? "draw"
      if (mode === "fail") {
        onContextError?.(new Error(`[SCENE_ASSET_UNAVAILABLE] the host could not supply "geo"`))
      } else if (mode === "draw") {
        onFirstDraw?.()
      }
      // "hang" — still loading, which is the pre-readiness state.
    }, [plan, onContextError, onFirstDraw])
    return <canvas data-testid="canvas" data-revision={plan.revisionId} />
  },
}))

const resolver = { resolve: vi.fn() }

beforeEach(() => {
  behaviour.clear()
  vi.clearAllMocks()
})

describe("Scene3DViewport — v2 readiness", () => {
  it("says it is loading until a frame has actually been drawn", async () => {
    behaviour.set(REV_V2, "hang")
    render(<Scene3DViewport plan={makeV2Plan()} frame={0} assetResolver={resolver} />)
    await screen.findByTestId("canvas")
    expect(screen.getByRole("status")).toHaveTextContent(/Loading 3D assets/i)
  })

  it("clears the loading state once the first frame is drawn", async () => {
    render(<Scene3DViewport plan={makeV2Plan()} frame={0} assetResolver={resolver} />)
    await screen.findByTestId("canvas")
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
  })

  it("shows the asset failure — with its code — instead of a frame", async () => {
    behaviour.set(REV_V2, "fail")
    render(<Scene3DViewport plan={makeV2Plan()} frame={0} assetResolver={resolver} />)
    expect(await screen.findByText(/SCENE_ASSET_UNAVAILABLE/)).toBeInTheDocument()
    expect(screen.queryByTestId("canvas")).toBeNull()
    // The scene data is untouched and the panel around it keeps working.
    expect(screen.getByText(/scene is intact/i)).toBeInTheDocument()
  })

  /**
   * The canvas keeps its own error state for the life of its mount, so
   * recovering from a dead context or a failed download means REMOUNTING it —
   * and the only honest trigger is a different revision. This is the case that
   * matters in practice: a build failed, the user re-ran it, and the repaired
   * revision must draw.
   */
  it("recovers when a LATER revision arrives", async () => {
    behaviour.set(REV_V2, "fail")
    const { rerender } = render(<Scene3DViewport plan={makeV2Plan()} frame={0} assetResolver={resolver} />)
    expect(await screen.findByText(/SCENE_ASSET_UNAVAILABLE/)).toBeInTheDocument()

    rerender(
      <Scene3DViewport plan={makeV2Plan({ revisionId: REV_V2_B })} frame={0} assetResolver={resolver} />,
    )
    const canvas = await screen.findByTestId("canvas")
    expect(canvas.getAttribute("data-revision")).toBe(REV_V2_B)
    expect(screen.queryByText(/SCENE_ASSET_UNAVAILABLE/)).toBeNull()
  })

  it("keeps showing the failure while the SAME revision is on screen", async () => {
    behaviour.set(REV_V2, "fail")
    const { rerender } = render(<Scene3DViewport plan={makeV2Plan()} frame={0} assetResolver={resolver} />)
    expect(await screen.findByText(/SCENE_ASSET_UNAVAILABLE/)).toBeInTheDocument()

    // A re-render with an equal-but-new plan object is not a new revision, and
    // must not silently retry a load that is going to fail again.
    rerender(<Scene3DViewport plan={makeV2Plan()} frame={1} assetResolver={resolver} />)
    expect(screen.getByText(/SCENE_ASSET_UNAVAILABLE/)).toBeInTheDocument()
  })
})
