import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// jsdom doesn't implement Pointer Capture; stub so Radix handlers don't throw.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false })
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} })

const h = vi.hoisted(() => ({
  nodeType: "generate-image" as string,
  data: { prompt: "a", provider: "nano-banana" } as Record<string, unknown>,
  updateNodeData: vi.fn(),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) =>
    sel({ nodes: [{ id: "n1", type: h.nodeType, data: h.data }], updateNodeData: h.updateNodeData }),
}))

const createMut = vi.fn().mockResolvedValue({ id: "u-new" })
const updateMut = vi.fn().mockResolvedValue({ id: "u1" })
vi.mock("@/hooks/queries/use-node-presets-queries", () => ({
  useNodePresets: () => ({
    data: [{ id: "u1", nodeType: "generate-image", name: "My Look", data: { prompt: "z" }, createdAt: "", updatedAt: "" }],
    isLoading: false,
  }),
  useNodePresetMutations: () => ({
    create: { mutateAsync: createMut, isPending: false },
    update: { mutateAsync: updateMut, isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    importMany: { mutateAsync: vi.fn(), isPending: false },
  }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PresetDropdown } from "../node-preset-dropdown"

function wrap(ui: ReactNode) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe("PresetDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.nodeType = "generate-image"
    h.data = { prompt: "a", provider: "nano-banana" }
  })

  it("hides for asset nodes (character)", () => {
    h.nodeType = "character"
    h.data = { description: "x", style: "y" }
    const { container } = wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    expect(container.firstChild).toBeNull()
  })

  it("hides for config-less nodes (sticky-note)", () => {
    h.nodeType = "sticky-note"
    h.data = { label: "hi" }
    const { container } = wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    expect(container.firstChild).toBeNull()
  })

  it("renders an empty-state trigger labeled 'Preset' when no preset is active", () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    expect(screen.getByRole("button", { name: /presets/i })).toHaveTextContent(/Preset/)
  })

  it("shows the active preset name and no dirty star when data matches", () => {
    h.data = { prompt: "z", __activePresetId: "u1" }
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    const trigger = screen.getByRole("button", { name: /presets/i })
    expect(trigger).toHaveTextContent("My Look")
    expect(trigger).not.toHaveTextContent("*")
  })

  it("shows a dirty star when the config diverges from the active preset", () => {
    h.data = { prompt: "EDITED", __activePresetId: "u1" }
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    const trigger = screen.getByRole("button", { name: /presets/i })
    expect(trigger).toHaveTextContent("My Look")
    expect(trigger).toHaveTextContent("*")
  })

  it("save-as-new creates a preset with extracted data and marks it active", async () => {
    h.data = { prompt: "a", generatedResults: [1] } // runtime key must be stripped
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByRole("button", { name: /save as new/i }))
    fireEvent.change(screen.getByPlaceholderText(/preset name/i), { target: { value: "Fresh" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() =>
      expect(createMut).toHaveBeenCalledWith(
        expect.objectContaining({ nodeType: "generate-image", name: "Fresh", data: { prompt: "a" } }),
      ),
    )
    await waitFor(() => expect(h.updateNodeData).toHaveBeenCalledWith("n1", { __activePresetId: "u-new" }))
  })

  it("selecting a differing preset opens a confirm, then applies on Apply", async () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />) // current prompt "a" != preset "z"
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByText(/My Look/i))
    // confirm dialog
    const applyBtn = await screen.findByRole("button", { name: /^apply$/i })
    fireEvent.click(applyBtn)
    expect(h.updateNodeData).toHaveBeenCalledWith("n1", { prompt: "z", __activePresetId: "u1" })
  })

  it("search filters the list", async () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    await screen.findByText(/My Look/i)
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "cinematic" } })
    expect(screen.queryByText(/My Look/i)).toBeNull()
    expect(screen.getByText(/Cinematic Portrait/i)).toBeInTheDocument()
  })

  it("offers Override only when the active preset is a custom one", async () => {
    h.data = { prompt: "EDITED", __activePresetId: "u1" } // active custom + dirty
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    expect(await screen.findByRole("button", { name: /override/i })).toBeInTheDocument()
  })
})
