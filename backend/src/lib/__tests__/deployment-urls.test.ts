import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * appBaseUrl/mcpBaseUrl are env-driven with the Nodaro Cloud domains as
 * fallbacks. The invariants locked here: unset env preserves Cloud behavior
 * exactly, PUBLIC_URL never leaks into the MCP host (the RFC 9728 resource
 * identity is deliberately independent), and trailing slashes are stripped so
 * `${base}/path` interpolation can't emit `//`.
 */

const ENV_KEYS = ["PUBLIC_URL", "MCP_PUBLIC_URL"] as const
const ORIGINAL: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k]
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL[k]
  }
})

describe("appBaseUrl / mcpBaseUrl", () => {
  it("falls back to the Nodaro Cloud domains when env is unset", async () => {
    delete process.env.PUBLIC_URL
    delete process.env.MCP_PUBLIC_URL
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://app.nodaro.ai")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.ai")
  })

  it("PUBLIC_URL overrides app links; the MCP host is NOT derived from PUBLIC_URL", async () => {
    process.env.PUBLIC_URL = "https://nodaro.example.com"
    delete process.env.MCP_PUBLIC_URL
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://nodaro.example.com")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.ai")
  })

  it("MCP_PUBLIC_URL overrides the MCP host; trailing slashes are stripped", async () => {
    process.env.PUBLIC_URL = "https://nodaro.example.com/"
    process.env.MCP_PUBLIC_URL = "https://mcp.nodaro.example.com//"
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://nodaro.example.com")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.example.com")
  })
})
