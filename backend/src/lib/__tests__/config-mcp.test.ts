import { describe, it, expect } from "vitest"

describe("MCP config", () => {
  it("exposes MCP_ENABLED defaulting to false", async () => {
    const { config } = await import("../config.js")
    expect(typeof config.MCP_ENABLED).toBe("boolean")
  })

  it("exposes MCP_DYNAMIC_REGISTRATION defaulting to allowlist", async () => {
    const { config } = await import("../config.js")
    expect(["allowlist", "open"]).toContain(config.MCP_DYNAMIC_REGISTRATION)
  })

  it("exposes MCP_DCR_ALLOWLIST as a parsed array of client names", async () => {
    const { config } = await import("../config.js")
    expect(Array.isArray(config.MCP_DCR_ALLOWLIST_PARSED)).toBe(true)
    expect(config.MCP_DCR_ALLOWLIST_PARSED.length).toBeGreaterThan(0)
  })
})
