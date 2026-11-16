import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("MCP config", () => {
  it("exposes MCP_ENABLED defaulting to false", async () => {
    const { config } = await import("../config.js")
    expect(typeof config.MCP_ENABLED).toBe("boolean")
  })

  it("exposes MCP_DYNAMIC_REGISTRATION defaulting to allowlist", async () => {
    const { config } = await import("../config.js")
    expect(["allowlist", "open", "off"]).toContain(config.MCP_DYNAMIC_REGISTRATION)
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

describe("MCP_TOOLS_BUILT_ONCE strict parsing", () => {
  const ORIGINAL = process.env.MCP_TOOLS_BUILT_ONCE

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_TOOLS_BUILT_ONCE
    else process.env.MCP_TOOLS_BUILT_ONCE = ORIGINAL
  })

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
    ["", false],
  ])("parses %j as %s", async (value, expected) => {
    process.env.MCP_TOOLS_BUILT_ONCE = value
    const { config, mcpToolsBuiltOnce } = await import("../config.js")
    expect(config.MCP_TOOLS_BUILT_ONCE).toBe(expected)
    expect(mcpToolsBuiltOnce()).toBe(expected)
  })

  it("is off when unset (every request builds its own tools, as before)", async () => {
    delete process.env.MCP_TOOLS_BUILT_ONCE
    const { config, mcpToolsBuiltOnce } = await import("../config.js")
    expect(config.MCP_TOOLS_BUILT_ONCE).toBe(false)
    expect(mcpToolsBuiltOnce()).toBe(false)
  })
})

describe("MCP_ALLOWED_CLIENT_IDS at boot", () => {
  const ORIGINAL = process.env.MCP_ALLOWED_CLIENT_IDS

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS
    else process.env.MCP_ALLOWED_CLIENT_IDS = ORIGINAL
  })

  it("unset or blank boots, with no list", async () => {
    for (const value of [undefined, "", "  "]) {
      vi.resetModules()
      if (value === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS
      else process.env.MCP_ALLOWED_CLIENT_IDS = value
      const { config } = await import("../config.js")
      expect(config.MCP_ALLOWED_CLIENT_IDS.trim()).toBe("")
    }
  })

  it("a list of developer-app ids boots", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = `app_${"a".repeat(32)}`
    const { config } = await import("../config.js")
    expect(config.MCP_ALLOWED_CLIENT_IDS).toBe(`app_${"a".repeat(32)}`)
  })

  it.each([`ndr_dcr_${"a".repeat(32)}`, "Claude", `app_${"a".repeat(32)},`])("%j stops the boot, naming the setting", async (value) => {
    process.env.MCP_ALLOWED_CLIENT_IDS = value
    await expect(import("../config.js")).rejects.toThrow(/Invalid env vars: MCP_ALLOWED_CLIENT_IDS entry/)
  })
})
