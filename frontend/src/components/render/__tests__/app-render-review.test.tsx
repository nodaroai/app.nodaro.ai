// Render final in the app runner (A6.3, decided 2026-10-04): the render's
// output card offers its final (asked twice — it spends), says while it
// renders, and offers the preview back once the final shows; a node that
// waited for the final says so, and never shows the creator's snapshot output.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))
vi.mock("@/hooks/use-run-from-here-credits", () => ({ useRunSetCredits: () => 530 }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getAppExecutionStatus: vi.fn().mockResolvedValue({
      status: "completed",
      node_states: { cut: { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } } },
      completed_nodes: 1,
      total_nodes: 1,
      failed_nodes: 0,
      error_message: null,
    }),
  }
})

import { AppRenderReviewProvider } from "../app-render-review"
import { OutputCard } from "@/components/presentation/output-card"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const nodes = [
  { id: "plan", type: "edit-plan", data: {}, position: { x: 0, y: 0 } },
  { id: "cut", type: "apply-edl", data: { quality: "proxy" }, position: { x: 0, y: 0 } },
  { id: "cap", type: "add-captions", data: { generatedVideoUrl: "https://r2/creator-snapshot.mp4" }, position: { x: 0, y: 0 } },
] as unknown as WorkflowNode[]
const edges = [
  { id: "e1", source: "plan", target: "cut", targetHandle: "edl" },
  { id: "e2", source: "cut", target: "cap" },
] as unknown as WorkflowEdge[]

const preview = { status: "completed" as const, output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } }
const final = { status: "completed" as const, output: { videoUrl: "https://r2/final.mp4", quality: "final" } }

function show(states: Record<string, unknown>, opts: { runId?: string | null } = {}) {
  usePresentationStore.setState({ nodes, edges, nodeStates: states as never })
  return render(
    <AppRenderReviewProvider runId={opts.runId === undefined ? "run-1" : opts.runId} executionId="exec-run">
      <OutputCard nodeId="cut" nodeType="apply-edl" label="Cut" outputType="video" status="completed" url="https://r2/preview.mp4" preview />
      <OutputCard nodeId="cap" nodeType="add-captions" label="Captions" outputType="video" status="idle" url="https://r2/creator-snapshot.mp4" />
    </AppRenderReviewProvider>,
  )
}

beforeEach(() => {
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  useAppRunnerStore.setState({ slug: "my-app", activeRunId: "run-1", runtimes: {} })
})
afterEach(() => {
  cleanup()
  delete window.__NODARO_RUNTIME__
  vi.restoreAllMocks()
})

describe("an app run that stopped at a Preview", () => {
  it("the render's card offers Render final with its price and the note; the card after it waits", () => {
    show({ cut: preview, cap: { status: "skipped" } })
    expect(screen.getByText(/Render final · 530/)).toBeTruthy()
    expect(screen.getAllByText(/no creator markup/).length).toBeGreaterThan(0)
    expect(screen.getByText("Waits for Render final")).toBeTruthy()
    // Never the creator's snapshot output.
    expect(document.querySelector('[src="https://r2/creator-snapshot.mp4"]')).toBeNull()
  })

  it("Render final asks first, then starts the run's final", () => {
    const renderFinal = vi.fn().mockResolvedValue(undefined)
    useAppRunnerStore.setState({ renderFinal })
    show({ cut: preview, cap: { status: "skipped" } })
    fireEvent.click(screen.getByText(/Render final · 530/))
    expect(renderFinal).not.toHaveBeenCalled()
    expect(screen.getByText("Render final · ≈530 credits")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Render final" }))
    expect(renderFinal).toHaveBeenCalledWith("run-1", "cut")
  })

  it("while the final renders the preview stays, with its progress", () => {
    useAppRunnerStore.setState({
      runtimes: {
        "run-1": {
          final: { renderNodeId: "cut", executionId: "exec-final", status: "running", completedNodes: 1, totalNodes: 2, errorMessage: null, base: {} },
        } as never,
      },
    })
    show({ cut: preview, cap: { status: "skipped" } })
    expect(screen.getByText("Rendering final… 50%")).toBeTruthy()
    expect(screen.queryByText(/Render final · 530/)).toBeNull()
  })

  it("once the final shows: no Render final, the card after it shows its own result, and the preview is one click away", async () => {
    useAppRunnerStore.setState({
      runtimes: {
        "run-1": {
          final: { renderNodeId: "cut", executionId: "exec-final", status: "completed", completedNodes: 2, totalNodes: 2, errorMessage: null, base: {} },
        } as never,
      },
    })
    show({ cut: final, cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" } } })
    expect(screen.queryByText(/Render final · 530/)).toBeNull()
    expect(screen.queryByText("Waits for Render final")).toBeNull()
    fireEvent.click(screen.getByText("Show preview"))
    expect(await screen.findByText("Show final")).toBeTruthy()
  })

  it("the published snapshot (no run on show) carries no review", () => {
    show({ cut: preview }, { runId: null })
    expect(screen.queryByText(/Render final/)).toBeNull()
    expect(screen.queryByText("Waits for Render final")).toBeNull()
  })

  // Decided 2026-10-06: Render final shows whatever the flag, as in the
  // editor. With the flag off the run ran the whole graph — nothing waited —
  // and Render final re-renders the render at Final.
  it("with the stop rule off, a Preview take still offers Render final, and nothing waits", () => {
    delete window.__NODARO_RUNTIME__
    const renderFinal = vi.fn().mockResolvedValue(undefined)
    useAppRunnerStore.setState({ renderFinal })
    show({ cut: preview, cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" } } })
    expect(screen.getByText(/Render final · 530/)).toBeTruthy()
    expect(screen.queryByText("Waits for Render final")).toBeNull()
    fireEvent.click(screen.getByText(/Render final · 530/))
    fireEvent.click(screen.getByRole("button", { name: "Render final" }))
    expect(renderFinal).toHaveBeenCalledWith("run-1", "cut")
  })
})

describe("outside the app runner", () => {
  it("an output card with no provider is exactly as before", () => {
    usePresentationStore.setState({ nodes, edges, nodeStates: { cut: preview } as never })
    render(<OutputCard nodeId="cut" nodeType="apply-edl" label="Cut" outputType="video" status="completed" url="https://r2/preview.mp4" preview />)
    expect(screen.queryByText(/Render final/)).toBeNull()
  })
})
