import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * appBaseUrl/mcpBaseUrl are env-driven with the Nodaro Cloud domains as
 * fallbacks. The invariants locked here: unset env preserves Cloud behavior
 * exactly, PUBLIC_URL never leaks into the MCP host (the RFC 9728 resource
 * identity is deliberately independent), and trailing slashes are stripped so
 * `${base}/path` interpolation can't emit `//`.
 */

// Drive the module through a mocked `config`, NOT process.env: config parses
// the environment once at import, so a developer whose backend/.env sets
// PUBLIC_URL saw these fail locally while CI (clean env) passed — a test that
// only fails on your machine teaches people to ignore failures.
const env = { PUBLIC_URL: "", MCP_PUBLIC_URL: "" }
vi.mock("../config.js", () => ({ config: env }))

beforeEach(() => {
  env.PUBLIC_URL = ""
  env.MCP_PUBLIC_URL = ""
  vi.resetModules()
})

describe("appBaseUrl / mcpBaseUrl", () => {
  it("falls back to the Nodaro Cloud domains when env is unset", async () => {
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://app.nodaro.ai")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.ai")
  })

  it("PUBLIC_URL overrides app links; the MCP host is NOT derived from PUBLIC_URL", async () => {
    env.PUBLIC_URL = "https://nodaro.example.com"
    delete process.env.MCP_PUBLIC_URL
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://nodaro.example.com")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.ai")
  })

  it("MCP_PUBLIC_URL overrides the MCP host; trailing slashes are stripped", async () => {
    env.PUBLIC_URL = "https://nodaro.example.com/"
    env.MCP_PUBLIC_URL = "https://mcp.nodaro.example.com//"
    const { appBaseUrl, mcpBaseUrl } = await import("../deployment-urls.js")
    expect(appBaseUrl()).toBe("https://nodaro.example.com")
    expect(mcpBaseUrl()).toBe("https://mcp.nodaro.example.com")
  })
})

describe("workflowEditorUrl", () => {
  it("is this deployment's short editor link — the app's own /editor/<id> route", async () => {
    env.PUBLIC_URL = "https://next.nodaro.example.com/"
    const { workflowEditorUrl } = await import("../deployment-urls.js")
    expect(workflowEditorUrl("0b9a6f8e-1111-4222-8333-444455556666")).toBe(
      "https://next.nodaro.example.com/editor/0b9a6f8e-1111-4222-8333-444455556666",
    )
  })

  it("an id is one path segment, never a path of its own", async () => {
    const { workflowEditorUrl } = await import("../deployment-urls.js")
    expect(workflowEditorUrl("../admin?x=1")).toBe("https://app.nodaro.ai/editor/..%2Fadmin%3Fx%3D1")
  })
})
