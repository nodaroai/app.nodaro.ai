import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => store } }))
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => ({
  "creatorCard.sourceLabel": "Creator", "creatorCard.aiCreator": "AI creator", "creatorCard.myPhoto": "My photo",
  "creatorCard.genderLabel": "Gender", "creatorCard.woman": "Woman", "creatorCard.man": "Man",
  "creatorCard.photoLabel": "Your photo", "creatorCard.photoConsent": "Only upload a photo of yourself or of someone who agreed to this.",
} as Record<string, string>)[k] ?? k }))
vi.mock("../image-upload-card", () => ({
  ImageUploadCard: ({ nodeId, onUpdateInput }: { nodeId: string; onUpdateInput: (id: string, key: string, v: unknown) => void }) => (
    <input aria-label="photo url" onChange={(e) => onUpdateInput(nodeId, "url", e.target.value)} />
  ),
}))

import { CreatorSourceCard } from "../creator-source-card"

const props = (over: Partial<Parameters<typeof CreatorSourceCard>[0]> = {}) => ({
  nodeId: "creator", label: "Creator", data: { source: "sampled", gender: "woman" }, isFullscreen: true,
  inputValues: {}, onUpdateInput: vi.fn(), ...over,
})

beforeEach(() => vi.clearAllMocks())

describe("CreatorSourceCard (spec §6.6, R3, R10)", () => {
  it("defaults to AI creator and Woman, with no upload zone", () => {
    render(<CreatorSourceCard {...props()} />)
    expect(screen.getByRole("radio", { name: "AI creator" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Woman" })).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByLabelText("photo url")).toBeNull()
  })
  it("My photo writes source and shows the upload zone with the consent line", () => {
    const p = props()
    const { rerender } = render(<CreatorSourceCard {...p} />)
    fireEvent.click(screen.getByRole("radio", { name: "My photo" }))
    expect(p.onUpdateInput).toHaveBeenCalledWith("creator", "source", "photo")
    rerender(<CreatorSourceCard {...p} inputValues={{ creator: { source: "photo" } }} />)
    expect(screen.getByLabelText("photo url")).toBeInTheDocument()
    expect(screen.getByText("Only upload a photo of yourself or of someone who agreed to this.")).toBeInTheDocument()
  })
  it("Man writes gender", () => {
    const p = props()
    render(<CreatorSourceCard {...p} />)
    fireEvent.click(screen.getByRole("radio", { name: "Man" }))
    expect(p.onUpdateInput).toHaveBeenCalledWith("creator", "gender", "man")
  })
  it("a pasted photo URL writes photoUrl, never url", () => {
    const p = props({ inputValues: { creator: { source: "photo" } } })
    render(<CreatorSourceCard {...p} />)
    fireEvent.change(screen.getByLabelText("photo url"), { target: { value: "https://cdn.example/p.png" } })
    expect(p.onUpdateInput).toHaveBeenCalledWith("creator", "photoUrl", "https://cdn.example/p.png")
    expect(p.onUpdateInput).not.toHaveBeenCalledWith("creator", "url", expect.anything())
  })
  it("in the editor preview (not fullscreen) the same choices write node data", () => {
    const p = props({ isFullscreen: false, data: { source: "photo", gender: "woman" } })
    render(<CreatorSourceCard {...p} />)
    fireEvent.click(screen.getByRole("radio", { name: "AI creator" }))
    expect(store.updateNodeData).toHaveBeenCalledWith("creator", { source: "sampled" })
    fireEvent.change(screen.getByLabelText("photo url"), { target: { value: "https://cdn.example/p.png" } })
    expect(store.updateNodeData).toHaveBeenCalledWith("creator", { photoUrl: "https://cdn.example/p.png" })
    expect(p.onUpdateInput).not.toHaveBeenCalled()
  })
  it("read-only writes nothing", () => {
    const p = props({ readOnly: true, inputValues: { creator: { source: "photo" } } })
    render(<CreatorSourceCard {...p} />)
    expect(screen.getByRole("radio", { name: "Man" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("photo url"), { target: { value: "https://cdn.example/p.png" } })
    expect(p.onUpdateInput).not.toHaveBeenCalled()
  })
})
