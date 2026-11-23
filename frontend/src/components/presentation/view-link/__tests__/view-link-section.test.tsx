import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const api = vi.hoisted(() => ({
  getWorkflowViewLink: vi.fn(),
  enableWorkflowViewLink: vi.fn(),
  setWorkflowViewIndexable: vi.fn(),
  exportWorkflowViewFile: vi.fn(),
  removeWorkflowViewFile: vi.fn(),
  revokeWorkflowViewLink: vi.fn(),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ViewLinkSection } from "../view-link-section"
import { workflowEmbedCode } from "@/lib/workflow-view-embed"

const ON = { enabled: true, token: "tok1", indexable: true, export: null, createdAt: "2026-11-20T10:00:00Z" } as const
const refusal = (code: string) => Object.assign(new Error(code), { code })

function renderSection(name = "My flow") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ViewLinkSection workflowId="wf1" workflowName={name} active />
    </QueryClientProvider>,
  )
}

describe("the view link section of the share dialog", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
  })
  afterEach(() => cleanup())

  it("enables the link with the interface language, then shows the link and the embed code", async () => {
    api.getWorkflowViewLink.mockResolvedValue({ enabled: false })
    api.enableWorkflowViewLink.mockResolvedValue(ON)
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "Create view link" }))
    expect(await screen.findByLabelText("View link")).toHaveValue(`${window.location.origin}/view/tok1`)
    expect(api.enableWorkflowViewLink).toHaveBeenCalledWith("wf1", "en")
    const code = screen.getByLabelText("Embed code") as HTMLTextAreaElement
    expect(code.value).toBe(
      `<iframe src="${window.location.origin}/embed/view/tok1" width="100%" height="600" style="border:0" loading="lazy" allowfullscreen title="My flow"></iframe>`,
    )
  })

  it("the embed code follows the size fields", async () => {
    api.getWorkflowViewLink.mockResolvedValue(ON)
    renderSection()
    fireEvent.change(await screen.findByLabelText("Width"), { target: { value: "800" } })
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "50%" } })
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).toContain('width="800" height="50%"')
  })

  it("the search switch reflects the state and saves a change", async () => {
    api.getWorkflowViewLink.mockResolvedValue(ON)
    api.setWorkflowViewIndexable.mockResolvedValue({ ...ON, indexable: false })
    renderSection()
    const toggle = await screen.findByRole("switch", { name: "Show in search engines" })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    fireEvent.click(toggle)
    await waitFor(() => expect(api.setWorkflowViewIndexable).toHaveBeenCalledWith("wf1", false))
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))
  })

  it("the downloadable file: off by default, asks about assets, saves, then offers an update and a way to remove it", async () => {
    api.getWorkflowViewLink.mockResolvedValue(ON)
    const saved = { ...ON, export: { exportedAt: "2026-11-21T09:30:00Z", includesAssets: true } }
    api.exportWorkflowViewFile.mockResolvedValue(saved)
    api.removeWorkflowViewFile.mockResolvedValue(ON)
    renderSection()
    const fileSwitch = await screen.findByRole("switch", { name: "Downloadable workflow file" })
    expect(fileSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(fileSwitch)
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Save copy" }))
    await waitFor(() => expect(api.exportWorkflowViewFile).toHaveBeenCalledWith("wf1", true))
    expect(await screen.findByText(/^Saved copy from /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Update file" }))
    await waitFor(() => expect(api.exportWorkflowViewFile).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("switch", { name: "Downloadable workflow file" }))
    await waitFor(() => expect(api.removeWorkflowViewFile).toHaveBeenCalledWith("wf1"))
  })

  it("stop sharing asks inline first, then revokes", async () => {
    api.getWorkflowViewLink.mockResolvedValue(ON)
    api.revokeWorkflowViewLink.mockResolvedValue({ enabled: false })
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "Stop sharing" }))
    expect(api.revokeWorkflowViewLink).not.toHaveBeenCalled()
    expect(screen.getByText(/The link and every embed stop working/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }))
    await waitFor(() => expect(api.revokeWorkflowViewLink).toHaveBeenCalledWith("wf1"))
    expect(await screen.findByRole("button", { name: "Create view link" })).toBeInTheDocument()
  })

  it("says calmly that the feature is not available yet when the server is not ready", async () => {
    api.getWorkflowViewLink.mockRejectedValue(refusal("not_available"))
    renderSection()
    expect(await screen.findByText(/Sharing the canvas is not available yet/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Create view link" })).toBeNull()
  })

  it("is not shown at all to someone who does not own the workflow", async () => {
    api.getWorkflowViewLink.mockRejectedValue(refusal("forbidden"))
    const { container } = renderSection()
    await waitFor(() => expect(api.getWorkflowViewLink).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector("section")).toBeNull())
  })
})

describe("workflowEmbedCode", () => {
  it("escapes the title and the address, and refuses a size that is not a number or a percentage", () => {
    const code = workflowEmbedCode({
      embedUrl: "https://x.test/embed/view/a\"b",
      width: '100%" onload="alert(1)',
      height: "600",
      title: `Tom's "best" <flow> & more`,
    })
    expect(code).toBe(
      `<iframe src="https://x.test/embed/view/a&quot;b" width="100%" height="600" style="border:0" loading="lazy" allowfullscreen title="Tom&#39;s &quot;best&quot; &lt;flow&gt; &amp; more"></iframe>`,
    )
  })
})
