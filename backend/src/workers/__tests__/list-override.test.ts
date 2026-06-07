import { describe, it, expect } from "vitest"
import { overrideInputWithListItem } from "../list-item-override"
describe("overrideInputWithListItem", () => {
  it("sets overridePrompt AND prompt for a text item", () => {
    const inputs: Record<string, unknown> = {}
    overrideInputWithListItem(inputs as never, "a cat")
    expect(inputs.overridePrompt).toBe("a cat")
    expect(inputs.prompt).toBe("a cat")
  })
  it("does NOT set overridePrompt for a URL item", () => {
    const inputs: Record<string, unknown> = {}
    overrideInputWithListItem(inputs as never, "https://x/y.mp4")
    expect(inputs.overridePrompt).toBeUndefined()
    expect(inputs.videoUrl).toBe("https://x/y.mp4")
  })
})
