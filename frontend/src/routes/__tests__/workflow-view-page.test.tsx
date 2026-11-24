import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const api = vi.hoisted(() => ({ getWorkflowView: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowView: api.getWorkflowView,
}))
// The visitor is signed out, and the import (its own tests) is never reached.
vi.mock("@/hooks/use-auth", () => ({ useCachedUserId: () => undefined }))
vi.mock("@/hooks/use-import-workflow-json", () => ({
  useImportWorkflowJson: () => ({ importFile: vi.fn(), importFrom: vi.fn(), isImporting: false }),
}))
// The canvas has its own tests; here it only has to say what it was given.
vi.mock("@/components/workflow-view/seeded-view-canvas", () => ({
  SeededViewCanvas: ({ view, children }: any) => (
    <div data-testid="canvas">{view.nodes.length} nodes{children}</div>
  ),
}))

import WorkflowViewPage from "../workflow-view-page"
import WorkflowViewEmbedPage from "../workflow-view-embed-page"

const refusal = (code: string) => Object.assign(new Error(code), { code })
const VIEW = {
  name: "Astronaut <film>",
  nodes: [{ id: "a", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  indexable: false,
  export: { exportedAt: "2026-11-20T10:00:00Z", includesAssets: true },
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/view/:token" element={<WorkflowViewPage />} />
        <Route path="/embed/view/:token" element={<WorkflowViewEmbedPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("the workflow view pages", () => {
  afterEach(() => {
    cleanup()
    api.getWorkflowView.mockReset()
    document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove())
  })

  it("a link that is gone or was never there says so", async () => {
    api.getWorkflowView.mockRejectedValue(refusal("not_found"))
    renderAt("/view/missing")
    expect(await screen.findByText("This link is not available")).toBeInTheDocument()
    expect(screen.queryByTestId("canvas")).toBeNull()
  })

  it("a site without the feature yet says it is not available yet", async () => {
    api.getWorkflowView.mockRejectedValue(refusal("not_available"))
    renderAt("/view/t1")
    expect(await screen.findByText("Not available yet")).toBeInTheDocument()
  })

  it("any other failure is a calm error, not a crash", async () => {
    api.getWorkflowView.mockRejectedValue(new Error("boom"))
    renderAt("/embed/view/t1")
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument()
  })

  it("shows the canvas with the name, the saved file's download, and keeps a hidden view out of search", async () => {
    api.getWorkflowView.mockResolvedValue(VIEW)
    renderAt("/view/t1")
    expect(await screen.findByTestId("canvas")).toHaveTextContent("1 nodes")
    expect(screen.getByRole("heading", { name: VIEW.name })).toBeInTheDocument()
    const download = screen.getByRole("link", { name: "Download workflow" })
    expect(download).toHaveAttribute("href", "/v1/workflow-views/t1/export")
    expect(download).toHaveAttribute("download")
    // Beside the file: the same saved copy, into the visitor's own account, after signing in.
    expect(screen.getByRole("link", { name: "Sign in to make your own copy" })).toHaveAttribute("href", "/login?redirect=%2Fview%2Ft1")
    await waitFor(() => expect(document.title).toBe(VIEW.name))
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex")
    expect(api.getWorkflowView).toHaveBeenCalledWith("t1", expect.any(AbortSignal))
  })

  it("offers no download when the owner saved no file, and lets an indexable view be indexed", async () => {
    api.getWorkflowView.mockResolvedValue({ ...VIEW, indexable: true, export: null })
    renderAt("/view/t1")
    await screen.findByTestId("canvas")
    expect(screen.queryByRole("link", { name: "Download workflow" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Sign in to make your own copy" })).toBeNull()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it("the embed has no bar, only a small link to the full page in a new tab", async () => {
    api.getWorkflowView.mockResolvedValue(VIEW)
    renderAt("/embed/view/t1")
    await screen.findByTestId("canvas")
    expect(screen.queryByRole("heading")).toBeNull()
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", `${window.location.origin}/view/t1`)
    expect(link).toHaveAttribute("target", "_blank")
  })
})
