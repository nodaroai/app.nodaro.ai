import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AssetGenPanel } from "../asset-gen-panel"

vi.mock("@/lib/api", () => ({
  llmSuggestDescription: vi.fn().mockResolvedValue({ text: "warm closed-mouth smile" }),
}))

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onGenerate: vi.fn(),
  assetType: "expressions" as const,
  characterId: "char-1",
  canonicalDescription: "young woman with warm smile",
}

describe("AssetGenPanel", () => {
  it("renders custom prompt input and description textarea", () => {
    render(<AssetGenPanel {...baseProps} />)
    expect(screen.getByPlaceholderText(/custom prompt/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/description/i)).toBeInTheDocument()
  })

  it("calls onGenerate with prompt and description on Confirm", async () => {
    const onGenerate = vi.fn()
    render(<AssetGenPanel {...baseProps} onGenerate={onGenerate} />)
    await userEvent.type(screen.getByPlaceholderText(/custom prompt/i), "winking")
    await userEvent.type(screen.getByPlaceholderText(/^description/i), "playful wink")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: "winking",
        description: "playful wink",
      }),
    )
  })

  it("motion mode shows motionDescription field", () => {
    render(<AssetGenPanel {...baseProps} assetType="motions" />)
    expect(screen.getByPlaceholderText(/motion description/i)).toBeInTheDocument()
  })
})
