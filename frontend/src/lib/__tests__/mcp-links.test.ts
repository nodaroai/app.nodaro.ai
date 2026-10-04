import { describe, expect, it, vi } from "vitest"

const platformLinks = vi.fn(() => true)
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfacePlatformLinks: () => platformLinks(),
}))

const { mcpClientUrl, mcpLinksShown } = await import("../mcp-links")

describe("mcpClientUrl", () => {
  it("opens nodaro.ai/mcp on the client's own tab", () => {
    expect(mcpClientUrl("claude-code")).toBe("https://nodaro.ai/mcp?ref=app#client-claude-code")
    expect(mcpClientUrl("claude")).toBe("https://nodaro.ai/mcp?ref=app#client-claude")
    expect(mcpClientUrl("chatgpt")).toBe("https://nodaro.ai/mcp?ref=app#client-chatgpt")
  })

  it("carries the interface language, which the page follows to its translation", () => {
    expect(mcpClientUrl("claude-code", { lang: "pt-br" })).toBe("https://nodaro.ai/mcp?lang=pt-br&ref=app#client-claude-code")
  })
})

describe("mcpLinksShown", () => {
  it("is the platform-links gate: a white-label surface hides them", () => {
    expect(mcpLinksShown()).toBe(true)
    platformLinks.mockReturnValue(false)
    expect(mcpLinksShown()).toBe(false)
  })
})
