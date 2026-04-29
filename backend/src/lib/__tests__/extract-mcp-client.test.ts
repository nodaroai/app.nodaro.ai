import { describe, it, expect } from "vitest"
import { extractMcpClient } from "../extract-mcp-client.js"

describe("extractMcpClient", () => {
  it("returns null for empty/null/non-object input", () => {
    expect(extractMcpClient(null)).toBeNull()
    expect(extractMcpClient(undefined)).toBeNull()
    expect(extractMcpClient("string")).toBeNull()
  })
  it("returns null when mcp_client is missing", () => {
    expect(extractMcpClient({})).toBeNull()
    expect(extractMcpClient({ prompt: "hi" })).toBeNull()
  })
  it("returns the string when present", () => {
    expect(extractMcpClient({ mcp_client: "Claude" })).toBe("Claude")
    expect(extractMcpClient({ mcp_client: "Cursor" })).toBe("Cursor")
  })
  it("rejects too-long values to prevent abuse", () => {
    const longName = "a".repeat(100)
    expect(extractMcpClient({ mcp_client: longName })).toBeNull()
  })
})
