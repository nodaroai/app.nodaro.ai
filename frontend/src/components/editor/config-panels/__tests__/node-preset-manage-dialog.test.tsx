import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false })
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} })

const m = {
  update: vi.fn().mockResolvedValue({}),
  remove: vi.fn().mockResolvedValue({}),
  reorder: vi.fn().mockResolvedValue({}),
  createGroup: vi.fn().mockResolvedValue({ id: "gnew" }),
  updateGroup: vi.fn().mockResolvedValue({}),
  removeGroup: vi.fn().mockResolvedValue({}),
}
vi.mock("@/hooks/queries/use-node-presets-queries", () => ({
  useNodePresets: () => ({
    data: [
      { id: "p1", nodeType: "generate-image", name: "In Folder", data: {}, groupId: "g1", tags: [], sortOrder: 0, createdAt: "", updatedAt: "" },
      { id: "p2", nodeType: "generate-image", name: "Root Preset", data: {}, tags: ["hero"], sortOrder: 1, createdAt: "", updatedAt: "" },
    ],
    isLoading: false,
  }),
  useNodePresetGroups: () => ({
    data: [{ id: "g1", nodeType: "generate-image", name: "Portraits", kind: "folder", sortOrder: 0 }],
    isLoading: false,
  }),
  useNodePresetMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: m.update, isPending: false },
    remove: { mutateAsync: m.remove, isPending: false },
    importMany: { mutateAsync: vi.fn(), isPending: false },
    reorder: { mutateAsync: m.reorder, isPending: false },
    createGroup: { mutateAsync: m.createGroup, isPending: false },
    updateGroup: { mutateAsync: m.updateGroup, isPending: false },
    removeGroup: { mutateAsync: m.removeGroup, isPending: false },
  }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { NodePresetManageDialog } from "../node-preset-manage-dialog"

function wrap(ui: ReactNode) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const dialog = (over: Partial<{ activeId: string }> = {}) => (
  <NodePresetManageDialog nodeType="generate-image" open onOpenChange={() => {}} activeId={over.activeId} />
)

describe("NodePresetManageDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders folders, their presets, and root presets", () => {
    wrap(dialog())
    expect(screen.getByDisplayValue("Portraits")).toBeInTheDocument()
    expect(screen.getByDisplayValue("In Folder")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Root Preset")).toBeInTheDocument()
  })

  it("New folder / New section create a group of the right kind", () => {
    wrap(dialog())
    fireEvent.click(screen.getByRole("button", { name: /new folder/i }))
    expect(m.createGroup).toHaveBeenCalledWith(expect.objectContaining({ kind: "folder", nodeType: "generate-image" }))
    fireEvent.click(screen.getByRole("button", { name: /new section/i }))
    expect(m.createGroup).toHaveBeenCalledWith(expect.objectContaining({ kind: "section" }))
  })

  it("reorders root items via the move-up control", () => {
    wrap(dialog())
    // Root order = [folder g1 (i0), Root Preset (i1)] → Root Preset can move up.
    const ups = screen.getAllByLabelText("Move up")
    // The last 'Move up' belongs to the root preset (folder's is first, disabled).
    fireEvent.click(ups[ups.length - 1])
    expect(m.reorder).toHaveBeenCalled()
  })

  it("adds a tag to a preset", async () => {
    wrap(dialog())
    const tagInputs = screen.getAllByPlaceholderText(/add tag/i)
    fireEvent.change(tagInputs[0], { target: { value: "studio" } })
    fireEvent.keyDown(tagInputs[0], { key: "Enter" })
    await waitFor(() => expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ tags: expect.arrayContaining(["studio"]) }) })))
  })

  it("deletes a preset", () => {
    wrap(dialog())
    fireEvent.click(screen.getByLabelText("Delete In Folder"))
    expect(m.remove).toHaveBeenCalledWith("p1")
  })

  it("renames a folder on blur", () => {
    wrap(dialog())
    const folderInput = screen.getByDisplayValue("Portraits")
    fireEvent.change(folderInput, { target: { value: "Headshots" } })
    fireEvent.blur(folderInput)
    expect(m.updateGroup).toHaveBeenCalledWith({ id: "g1", patch: { name: "Headshots" } })
  })
})
