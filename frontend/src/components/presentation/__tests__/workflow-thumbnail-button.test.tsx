import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({
  thumbnailRow: { thumbnail_url: null as string | null },
  upload: vi.fn(),
  setWorkflowThumbnail: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.thumbnailRow, error: null }) }),
      }),
    }),
  }),
}))
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: h.upload, isUploading: false }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (select: (s: { setWorkflowThumbnail: typeof h.setWorkflowThumbnail }) => unknown) =>
    select({ setWorkflowThumbnail: h.setWorkflowThumbnail }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.toastError } }))

import { WorkflowThumbnailButton } from "../workflow-thumbnail-button"

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorkflowThumbnailButton workflowId="wf-1" />
    </QueryClientProvider>,
  )
}

function chooseFile(name = "cover.png") {
  const input = screen.getByTestId("thumbnail-file") as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/png" })] } })
}

beforeEach(() => {
  h.thumbnailRow = { thumbnail_url: null }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Present → Thumbnail", () => {
  it("shows that the workflow has no thumbnail yet", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Thumbnail" }))
    expect(await screen.findByText("No thumbnail yet")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy()
  })

  it("shows the current thumbnail and offers to replace it", async () => {
    h.thumbnailRow = { thumbnail_url: "https://cdn/current.png" }
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Thumbnail" }))
    const img = (await screen.findByRole("img", { name: "Workflow thumbnail" })) as HTMLImageElement
    expect(img.getAttribute("src")).toBe("https://cdn/current.png")
    expect(screen.getByRole("button", { name: "Replace image" })).toBeTruthy()
  })

  it("an uploaded image becomes the thumbnail, with no node on the canvas", async () => {
    h.upload.mockResolvedValue({ url: "https://cdn/uploads/new.png" })
    h.setWorkflowThumbnail.mockResolvedValue(true)
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Thumbnail" }))
    await screen.findByText("No thumbnail yet")
    chooseFile()
    await waitFor(() => expect(h.setWorkflowThumbnail).toHaveBeenCalledWith("https://cdn/uploads/new.png"))
    const img = (await screen.findByRole("img", { name: "Workflow thumbnail" })) as HTMLImageElement
    expect(img.getAttribute("src")).toBe("https://cdn/uploads/new.png")
  })

  it("a failed save leaves the shown thumbnail as it was", async () => {
    h.upload.mockResolvedValue({ url: "https://cdn/uploads/new.png" })
    h.setWorkflowThumbnail.mockResolvedValue(false)
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Thumbnail" }))
    await screen.findByText("No thumbnail yet")
    chooseFile()
    await waitFor(() => expect(h.setWorkflowThumbnail).toHaveBeenCalled())
    expect(screen.getByText("No thumbnail yet")).toBeTruthy()
  })

  it("a failed upload says so and sets nothing", async () => {
    h.upload.mockRejectedValue(new Error("Storage limit reached"))
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Thumbnail" }))
    await screen.findByText("No thumbnail yet")
    chooseFile()
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Couldn't upload the thumbnail", { description: "Storage limit reached" }),
    )
    expect(h.setWorkflowThumbnail).not.toHaveBeenCalled()
  })
})
