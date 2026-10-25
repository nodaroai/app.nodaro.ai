import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { NodeProps } from "@xyflow/react"

/**
 * Video Upscale → Seedance 2.5 HD (from draft): the Run button's price.
 *
 * - With a draft wired: the exact credits from the server estimate, asked ONCE
 *   per draft — keyed by the task id the run itself sends.
 * - With no draft wired, or while the draft is refused: "from N", the lowest
 *   any draft costs (the same estimate route, no draft named).
 * - The result's job is looked up (for the audio warning) only while the node
 *   is the HD finalize: a Topaz/VEO result never carries it.
 */

const api = vi.hoisted(() => ({
  estimate: vi.fn(),
  getJobStatus: vi.fn(),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  estimateSeedanceHdCredits: api.estimate,
  getJobStatus: api.getJobStatus,
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-model-credit-cost")>()),
  useModelCreditCost: () => ({ data: 19 }),
}))

const store = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  edges: [] as Array<{ source: string; target: string }>,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        openFreeCut: () => {},
        videoAutoplay: false,
        nodes: store.nodes,
        edges: store.edges,
      }),
    { getState: () => ({ nodes: store.nodes, edges: store.edges }) },
  ),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, topToolbarContent }: { children: ReactNode; topToolbarContent: ReactNode }) => (
    <div>{topToolbarContent}{children}</div>
  ),
}))
vi.mock("../run-node-button", () => ({
  RunNodeButton: ({ credits, creditsFrom, creditsEstimate }: { credits?: number; creditsFrom?: boolean; creditsEstimate?: boolean }) => (
    <div data-testid="run" data-credits={String(credits ?? "")} data-from={String(!!creditsFrom)} data-estimate={String(!!creditsEstimate)} />
  ),
}))
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))
vi.mock("../missing-refs-chip", () => ({ MissingRefsChip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../video-result-overlay", () => ({ VideoResultOverlay: () => <div data-testid="overlay" /> }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))

import { VideoUpscaleNode } from "../video-upscale-node"

const RESULT = { url: "https://r2/out.mp4", jobId: "11111111-2222-4333-8444-555555555555", timestamp: "t" }

function renderNode(data: Record<string, unknown>) {
  store.nodes = [...store.nodes.filter((n) => n.id !== "up"), { id: "up", data }]
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <VideoUpscaleNode {...({ id: "up", data: { label: "Upscale", ...data }, selected: false } as unknown as NodeProps)} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.estimate.mockReset()
  api.getJobStatus.mockReset()
  api.getJobStatus.mockResolvedValue({ input_data: {}, output_data: {} })
  store.nodes = []
  store.edges = []
})

describe("Seedance 2.5 HD price on the node", () => {
  it("no draft wired: 'from N', the server's minimum — no draft estimate asked", async () => {
    api.estimate.mockImplementation(async (draft?: { taskId?: string }) =>
      draft?.taskId ? { credits: 9999, minimum: false } : { credits: 1425, minimum: true })
    renderNode({ provider: "seedance-2-5-hd" })
    await waitFor(() => expect(screen.getByTestId("run").dataset.credits).toBe("1425"))
    expect(screen.getByTestId("run").dataset.from).toBe("true")
    expect(api.estimate).toHaveBeenCalledTimes(1)
    expect(api.estimate.mock.calls[0]![0]).toBeUndefined()
  })

  it("a draft wired: the exact price for THAT draft, asked by the task id the run sends", async () => {
    store.nodes = [{ id: "gv", data: { kieTaskId: "task-draft" } }]
    store.edges = [{ source: "gv", target: "up" }]
    api.estimate.mockImplementation(async (draft?: { taskId?: string }) =>
      draft?.taskId ? { credits: 1900, minimum: false } : { credits: 1425, minimum: true })
    renderNode({ provider: "seedance-2-5-hd" })
    await waitFor(() => expect(screen.getByTestId("run").dataset.credits).toBe("1900"))
    expect(screen.getByTestId("run").dataset.from).toBe("false")
    expect(api.estimate).toHaveBeenCalledWith({ taskId: "task-draft" })
    expect(api.estimate.mock.calls.filter(([d]) => d?.taskId === "task-draft")).toHaveLength(1)
  })

  it("a refused draft falls back to 'from N' instead of a wrong exact price", async () => {
    store.nodes = [{ id: "gv", data: { kieTaskId: "task-not-a-draft" } }]
    store.edges = [{ source: "gv", target: "up" }]
    api.estimate.mockImplementation(async (draft?: { taskId?: string }) => {
      if (draft?.taskId) throw new Error("not_a_draft")
      return { credits: 1425, minimum: true }
    })
    renderNode({ provider: "seedance-2-5-hd" })
    await waitFor(() => expect(screen.getByTestId("run").dataset.credits).toBe("1425"))
    expect(screen.getByTestId("run").dataset.from).toBe("true")
  })
})

describe("result job lookups", () => {
  it("a Topaz upscale result makes no job lookup and no estimate", async () => {
    renderNode({ provider: "topaz", generatedResults: [RESULT], activeResultIndex: 0, executionStatus: "completed" })
    expect(screen.getByTestId("overlay")).toBeTruthy()
    expect(screen.getByTestId("run").dataset.credits).toBe("19")
    // Metered: the figure is the server's price for the quoted Topaz units — an estimate (≈).
    expect(screen.getByTestId("run").dataset.estimate).toBe("true")
    await new Promise((r) => setTimeout(r, 20))
    expect(api.getJobStatus).not.toHaveBeenCalled()
    expect(api.estimate).not.toHaveBeenCalled()
  })

  it("a VEO upscale result makes no job lookup", async () => {
    renderNode({ provider: "veo-1080p", generatedResults: [RESULT], activeResultIndex: 0, executionStatus: "completed" })
    expect(screen.getByTestId("run").dataset.estimate).toBe("false")
    await new Promise((r) => setTimeout(r, 20))
    expect(api.getJobStatus).not.toHaveBeenCalled()
  })

  it("a Seedance 2.5 HD result is looked up once (for its audio warning)", async () => {
    api.estimate.mockResolvedValue({ credits: 1425, minimum: true })
    renderNode({ provider: "seedance-2-5-hd", generatedResults: [RESULT], activeResultIndex: 0, executionStatus: "completed" })
    await waitFor(() => expect(api.getJobStatus).toHaveBeenCalledTimes(1))
    expect(api.getJobStatus).toHaveBeenCalledWith(RESULT.jobId)
  })
})
