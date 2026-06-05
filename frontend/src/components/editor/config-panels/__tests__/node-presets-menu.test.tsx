import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// jsdom doesn't implement Pointer Capture; stub so Radix handlers don't throw.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false })

const createMut = vi.fn().mockResolvedValue({ id: "new" })
vi.mock("@/hooks/queries/use-node-presets-queries", () => ({
  useNodePresets: () => ({
    data: [
      { id: "u1", source: "user", nodeType: "generate-image", name: "My Look", data: { prompt: "z" }, createdAt: "", updatedAt: "" },
    ],
    isLoading: false,
  }),
  useNodePresetMutations: () => ({
    create: { mutateAsync: createMut, isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    importMany: { mutateAsync: vi.fn(), isPending: false },
  }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { NodePresetsMenu } from "../node-presets-menu"

function wrap(ui: ReactNode) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe("NodePresetsMenu", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders nothing when there is no capturable config", () => {
    const { container } = wrap(
      <NodePresetsMenu nodeType="sticky-note" data={{ label: "hi" }} onApply={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for asset/entity nodes (Character) even with config-like data", () => {
    const { container } = wrap(
      <NodePresetsMenu nodeType="character" data={{ description: "a hero", style: "anime" }} onApply={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for teleport nodes (only structural channel fields, all excluded)", () => {
    const { container } = wrap(
      <NodePresetsMenu nodeType="teleport-send" data={{ label: "A", channel: "A", channelColor: "#f59e0b" }} onApply={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders a trigger when config is capturable and lists factory + user presets", async () => {
    wrap(<NodePresetsMenu nodeType="generate-image" data={{ prompt: "a", provider: "nano-banana" }} onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    expect(await screen.findByText(/Cinematic Portrait/i)).toBeInTheDocument()
    expect(screen.getByText(/My Look/i)).toBeInTheDocument()
  })

  it("calls onApply with preset data when a preset is clicked", async () => {
    const onApply = vi.fn()
    wrap(<NodePresetsMenu nodeType="generate-image" data={{ prompt: "a" }} onApply={onApply} />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByText(/My Look/i))
    expect(onApply).toHaveBeenCalledWith({ prompt: "z" })
  })

  it("save-as creates a preset with extracted data", async () => {
    wrap(<NodePresetsMenu nodeType="generate-image" data={{ prompt: "a", generatedResults: [1] }} onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    fireEvent.click(await screen.findByRole("button", { name: /save current/i }))
    fireEvent.change(screen.getByPlaceholderText(/preset name/i), { target: { value: "Fresh" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() =>
      expect(createMut).toHaveBeenCalledWith(
        expect.objectContaining({ nodeType: "generate-image", name: "Fresh", data: { prompt: "a" } }),
      ),
    )
  })

  it("search filters the list", async () => {
    wrap(<NodePresetsMenu nodeType="generate-image" data={{ prompt: "a" }} onApply={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /presets/i }))
    await screen.findByText(/My Look/i)
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "cinematic" } })
    expect(screen.queryByText(/My Look/i)).toBeNull()
    expect(screen.getByText(/Cinematic Portrait/i)).toBeInTheDocument()
  })
})
