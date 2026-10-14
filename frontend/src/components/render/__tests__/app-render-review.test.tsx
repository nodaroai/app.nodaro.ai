// Render final in the app runner (A6.3, decided 2026-10-04): the render's
// output card offers its final (asked twice — it spends), says while it
// renders, and offers the preview back once the final shows; a node that
// waited for the final says so, and never shows the creator's snapshot output.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { translate } from "@/lib/i18n"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))
const price = vi.hoisted(() => ({
  unchecked: undefined as undefined | "checking" | "editor" | "held" | "length",
  /** What each quote was asked to price: the executable ids and the graph. */
  asked: [] as Array<{ ids: string[]; nodes: Array<{ id: string; data?: Record<string, unknown> }> }>,
}))
vi.mock("@/hooks/use-run-from-here-credits", () => ({
  useRunSetPrice: (executable: Array<{ id: string }>, nodes: Array<{ id: string; data?: Record<string, unknown> }>) => {
    price.asked.push({ ids: executable.map((n) => n.id), nodes })
    return { credits: 530, hold: 530, estimating: price.unchecked !== undefined, ...(price.unchecked ? { unchecked: price.unchecked } : {}) }
  },
}))
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

  it("a final whose UGC part's price is not the server's checked figure is marked as an estimate, the reason on the button", () => {
    price.unchecked = "editor"
    show({ cut: preview, cap: { status: "skipped" } })
    const button = screen.getByText(`Render final · ${translate("en", "renderFinal.priceEstimate", { n: "530" })}`).closest("button")!
    expect(button.title).toBe(translate("en", "ugc.price.unchecked"))
    price.unchecked = undefined
  })

  it.each(["editor", "checking", "held", "length"] as const)("asked with an unchecked price (%s), the confirmation marks it an estimate and says why", (state) => {
    price.unchecked = state
    try {
      show({ cut: preview, cap: { status: "skipped" } })
      fireEvent.click(screen.getByText(`Render final · ${translate("en", "renderFinal.priceEstimate", { n: "530" })}`))
      const ask = screen.getByRole("alertdialog")
      const reason = { editor: "ugc.price.unchecked", checking: "ugc.price.checking", held: "ugc.price.uncheckedHeld", length: "ugc.price.uncheckedLength" } as const
      expect(ask.textContent).toContain(`Render final · ${translate("en", "renderFinal.priceEstimate", { n: "530" })}`)
      expect(ask.textContent).toContain(translate("en", reason[state]))
      expect(ask.getAttribute("aria-label")).toBe(`Render final · ${translate("en", "renderFinal.priceEstimate", { n: "530" })}`)
    } finally {
      price.unchecked = undefined
    }
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

// A review-on Tighten Episode holds its own Preview (decided 2026-10-13): its
// card offers Render final, which continues the run that made that Preview.
describe("an app run whose Tighten Episode made a Preview", () => {
  const ucNodes = [
    { id: "rec", type: "upload-video", data: { url: "https://r2/rec.mp4" }, position: { x: 0, y: 0 } },
    { id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true, captions: false }, position: { x: 0, y: 0 } },
    { id: "fmt", type: "add-captions", data: {}, position: { x: 0, y: 0 } },
  ] as unknown as WorkflowNode[]
  const ucEdges = [
    { id: "w", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
    { id: "o", source: "t1", target: "fmt", sourceHandle: "media", targetHandle: "video" },
  ] as unknown as WorkflowEdge[]
  const settings = { captions: true, reviewBeforeRender: true }
  const ucPreview = { status: "completed", jobId: "job-w", output: { videoUrl: "https://r2/p.mp4", quality: "proxy", useCaseSettings: settings } }
  const ucFinal = { status: "completed", jobId: "job-f", output: { videoUrl: "https://r2/f.mp4", quality: "final" } }
  const runtime = (status: string) => ({
    "run-1": { final: { renderNodeId: "t1", executionId: "exec-final", status, completedNodes: 1, totalNodes: 4, errorMessage: status === "failed" ? "boom" : null, base: {} } },
  })

  function showUc(t1: unknown) {
    usePresentationStore.setState({ nodes: ucNodes, edges: ucEdges, nodeStates: { t1 } as never })
    return render(
      <AppRenderReviewProvider runId="run-1" executionId="exec-run">
        <OutputCard nodeId="t1" nodeType="tighten-episode" label="Episode" outputType="video" status="completed" url="https://r2/p.mp4" preview />
      </AppRenderReviewProvider>,
    )
  }

  beforeEach(() => {
    price.asked.length = 0
  })

  it("the card offers Render final, priced as the node's own run continued, and starts it on the node", () => {
    const renderFinal = vi.fn().mockResolvedValue(undefined)
    useAppRunnerStore.setState({ renderFinal })
    showUc(ucPreview)
    expect(screen.getByText(/Render final · 530/)).toBeTruthy()
    const quote = price.asked.at(-1)!
    expect(quote.ids.sort()).toEqual(["fmt", "t1"])
    expect(quote.nodes.find((n) => n.id === "t1")!.data!.useCaseContinue).toEqual({ mode: "render-final", jobId: "job-w", settings })
    fireEvent.click(screen.getByText(/Render final · 530/))
    fireEvent.click(screen.getByRole("button", { name: "Render final" }))
    expect(renderFinal).toHaveBeenCalledWith("run-1", "t1")
  })

  it("a Final take offers no Render final", () => {
    showUc(ucFinal)
    expect(screen.queryByText(/Render final/)).toBeNull()
  })

  it("while its final renders: the progress, no second Render final", () => {
    useAppRunnerStore.setState({ runtimes: runtime("running") as never })
    showUc(ucPreview)
    expect(screen.getByText("Rendering final… 25%")).toBeTruthy()
    expect(screen.queryByText(/Render final · 530/)).toBeNull()
  })

  it("after its final failed: the reason, and Render final again on the same Preview", () => {
    useAppRunnerStore.setState({ runtimes: runtime("failed") as never })
    showUc(ucPreview)
    expect(screen.getByText(/boom/)).toBeTruthy()
    expect(screen.getByText(/Render final · 530/)).toBeTruthy()
  })

  it("once its final shows: the Final, with its Preview one click away", async () => {
    useAppRunnerStore.setState({ runtimes: runtime("completed") as never })
    showUc(ucFinal)
    expect(screen.queryByText(/Render final · 530/)).toBeNull()
    expect(screen.getByText("Show preview")).toBeTruthy()
  })
})

describe("outside the app runner", () => {
  it("an output card with no provider is exactly as before", () => {
    usePresentationStore.setState({ nodes, edges, nodeStates: { cut: preview } as never })
    render(<OutputCard nodeId="cut" nodeType="apply-edl" label="Cut" outputType="video" status="completed" url="https://r2/preview.mp4" preview />)
    expect(screen.queryByText(/Render final/)).toBeNull()
  })
})
