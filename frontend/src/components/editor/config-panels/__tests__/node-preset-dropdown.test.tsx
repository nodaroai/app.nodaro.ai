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
  // Favorited preset ids — overridden per-test (e.g. the Favorites band test).
  favoriteIds: [] as string[],
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) =>
    sel({ nodes: [{ id: "n1", type: h.nodeType, data: h.data }], updateNodeData: h.updateNodeData }),
}))

const createMut = vi.fn().mockResolvedValue({ id: "u-new" })
const updateMut = vi.fn().mockResolvedValue({ id: "u1" })
const noop = { mutateAsync: vi.fn(), isPending: false }
vi.mock("@/hooks/queries/use-node-presets-queries", () => ({
  useNodePresets: () => ({
    data: [{ id: "u1", nodeType: "generate-image", name: "My Look", data: { prompt: "z" }, tags: [], sortOrder: 0, createdAt: "", updatedAt: "" }],
    isLoading: false,
  }),
  useNodePresetGroups: () => ({ data: [], isLoading: false }),
  useNodePresetMutations: () => ({
    create: { mutateAsync: createMut, isPending: false },
    update: { mutateAsync: updateMut, isPending: false },
    remove: noop,
    importMany: noop,
    reorder: noop,
    createGroup: noop,
    updateGroup: noop,
    removeGroup: noop,
  }),
  useNodePresetFavorites: () => ({ data: h.favoriteIds }),
  useNodePresetFavoriteMutations: () => ({ add: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
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
    h.favoriteIds = []
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

  it("renders an empty-state trigger labeled 'PRESET' when no preset is active", () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    expect(screen.getByRole("button", { name: /presets/i })).toHaveTextContent(/PRESET/)
  })

  it("node variant sizes the trigger to the zoomed node title (11px × zoom)", () => {
    wrap(<PresetDropdown nodeId="n1" variant="node" zoom={2} />)
    const trigger = screen.getByRole("button", { name: /presets/i })
    expect(trigger.style.fontSize).toBe("22px") // 11 * 2 — matches the node title (text-[11px] scaled by zoom)
    expect(trigger.style.height).toBe("36px") // 18 * 2
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

  // Regression: on the node-variant (hover-toolbar) dropdown, selecting a DIFFERING preset
  // closed the popover and reported onOpenChange(false) while the confirm dialog was still
  // pending — so BaseNode unpinned the hover toolbar (isVisible={isHovered || presetMenuOpen}),
  // unmounting the dropdown + its confirm dialog before "Apply" could run. The preset never
  // changed. The dropdown must keep reporting active (true) until the confirm resolves.
  it("node variant stays active (onOpenChange true) while a select-confirm is pending, then applies", async () => {
    const onOpenChange = vi.fn()
    wrap(<PresetDropdown nodeId="n1" variant="node" onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByText(/My Look/i)) // differs → popover closes, confirm pending
    expect(onOpenChange).toHaveBeenLastCalledWith(true) // still active → toolbar (and dialog) stay mounted
    fireEvent.click(await screen.findByRole("button", { name: /^apply$/i }))
    expect(h.updateNodeData).toHaveBeenCalledWith("n1", { prompt: "z", __activePresetId: "u1" })
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false)) // confirm resolved → inactive
  })

  it("search filters the list", async () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    await screen.findByText(/My Look/i)
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "cinematic" } })
    expect(screen.queryByText(/My Look/i)).toBeNull()
    expect(screen.getByText(/Cinematic Portrait/i)).toBeInTheDocument()
  })

  it("renders factory presets as folders, collapsed by default, expanding on click", async () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    // Folder header is visible; its presets are hidden until expanded.
    const folder = await screen.findByText("Photography & Cinematic")
    expect(screen.queryByText("Cinematic Still")).toBeNull()
    fireEvent.click(folder)
    expect(await screen.findByText("Cinematic Still")).toBeInTheDocument()
  })

  it("lists custom presets above factory", async () => {
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    const my = await screen.findByText("My Presets")
    const factory = screen.getByText("Factory")
    // User section precedes the factory section in the menu.
    expect(my.compareDocumentPosition(factory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows a Favorites band only when the user has favorited presets", async () => {
    // Default (no favorites): the band is absent.
    const { unmount } = wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    await screen.findByText("Factory")
    expect(screen.queryByText("Favorites")).toBeNull()
    unmount()

    // With a favorited factory id, a "Favorites" header surfaces it at the top.
    h.favoriteIds = ["generate-image/cinematic-portrait"]
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    expect(await screen.findByText("Favorites")).toBeInTheDocument()
  })

  it("offers Override only when the active preset is a custom one", async () => {
    h.data = { prompt: "EDITED", __activePresetId: "u1" } // active custom + dirty
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    expect(await screen.findByRole("button", { name: /override/i })).toBeInTheDocument()
  })

  it("Reset to default clears the active preset (after confirm)", async () => {
    h.data = { prompt: "edited", provider: "flux", __activePresetId: "u1" }
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByRole("button", { name: /reset to default/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^reset$/i }))
    await waitFor(() => {
      const call = h.updateNodeData.mock.calls.find((c) => "__activePresetId" in ((c[1] as Record<string, unknown>) ?? {}))
      expect(call).toBeTruthy()
      expect((call![1] as Record<string, unknown>).__activePresetId).toBeUndefined()
    })
  })
})
