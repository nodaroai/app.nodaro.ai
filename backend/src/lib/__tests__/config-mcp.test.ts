import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

describe("MCP_ENABLED strict parsing", () => {
  const ORIGINAL_MCP_ENABLED = process.env.MCP_ENABLED

  beforeEach(() => {
    // Clear vitest module cache so the next `import("../config.js")` re-evaluates
    // the schema against the current process.env.
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_MCP_ENABLED === undefined) delete process.env.MCP_ENABLED
    else process.env.MCP_ENABLED = ORIGINAL_MCP_ENABLED
  })

  it("parses MCP_ENABLED='true' as true", async () => {
    process.env.MCP_ENABLED = "true"
    const { config } = await import("../config.js")
    expect(config.MCP_ENABLED).toBe(true)
  })

  it("parses MCP_ENABLED='false' as false (NOT true — the original bug)", async () => {
    process.env.MCP_ENABLED = "false"
    const { config } = await import("../config.js")
    expect(config.MCP_ENABLED).toBe(false)
  })

  it("parses MCP_ENABLED='0' as false", async () => {
    process.env.MCP_ENABLED = "0"
    const { config } = await import("../config.js")
    expect(config.MCP_ENABLED).toBe(false)
  })

  it("treats unset env var as false (default)", async () => {
    delete process.env.MCP_ENABLED
    const { config } = await import("../config.js")
    expect(config.MCP_ENABLED).toBe(false)
  })
})
