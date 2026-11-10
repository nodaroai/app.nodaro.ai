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
const env = { PUBLIC_URL: "", MCP_PUBLIC_URL: "", FLOW_PUBLIC_URL: "", FLOW_UI_ORIGIN: "", LEGACY_UI_HOSTS: "" }
vi.mock("../config.js", () => ({ config: env }))

beforeEach(() => {
  env.PUBLIC_URL = ""
  env.MCP_PUBLIC_URL = ""
  env.FLOW_PUBLIC_URL = ""
  env.FLOW_UI_ORIGIN = ""
  env.LEGACY_UI_HOSTS = ""
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

describe("flowBaseUrl: where the app's own pages live", () => {
  it("unset, it is appBaseUrl() exactly, so an install without it links as before", async () => {
    env.PUBLIC_URL = "https://nodaro.example.com/"
    const { appBaseUrl, flowBaseUrl } = await import("../deployment-urls.js")
    expect(flowBaseUrl()).toBe(appBaseUrl())
    expect(flowBaseUrl()).toBe("https://nodaro.example.com")
  })

  it("names the app's own host when set, trailing slash stripped; appBaseUrl() stays the API host", async () => {
    env.PUBLIC_URL = "https://app.example.com"
    env.FLOW_PUBLIC_URL = "https://flow.example.com/"
    env.LEGACY_UI_HOSTS = "app.example.com"
    const { appBaseUrl, flowBaseUrl } = await import("../deployment-urls.js")
    expect(flowBaseUrl()).toBe("https://flow.example.com")
    expect(appBaseUrl()).toBe("https://app.example.com")
  })

  it("FLOW_UI_ORIGIN alone sets it too: the Flow host has one origin, whichever name gives it", async () => {
    env.PUBLIC_URL = "https://app.example.com"
    env.FLOW_UI_ORIGIN = "https://flow.example.com/"
    env.LEGACY_UI_HOSTS = "app.example.com"
    const { appBaseUrl, flowBaseUrl } = await import("../deployment-urls.js")
    expect(flowBaseUrl()).toBe("https://flow.example.com")
    expect(appBaseUrl()).toBe("https://app.example.com")
  })

  it("follows the one move-on rule: a Flow setting without a legacy host, or without a kept origin, moves no link", async () => {
    for (const settings of [
      { PUBLIC_URL: "https://app.example.com", FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "" },
      { PUBLIC_URL: "https://app.example.com", FLOW_PUBLIC_URL: "https://flow.example.com", LEGACY_UI_HOSTS: "flow.example.com" },
      { PUBLIC_URL: "http://localhost:3000", FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "app.example.com" },
    ]) {
      Object.assign(env, { FLOW_UI_ORIGIN: "", FLOW_PUBLIC_URL: "", LEGACY_UI_HOSTS: "" }, settings)
      vi.resetModules()
      const { appBaseUrl, flowBaseUrl } = await import("../deployment-urls.js")
      expect(flowBaseUrl(), JSON.stringify(settings)).toBe(appBaseUrl())
    }
  })

  it("the short editor link follows it", async () => {
    env.PUBLIC_URL = "https://app.example.com"
    env.FLOW_PUBLIC_URL = "https://flow.example.com"
    env.LEGACY_UI_HOSTS = "app.example.com"
    const { workflowEditorUrl } = await import("../deployment-urls.js")
    expect(workflowEditorUrl("wf1")).toBe("https://flow.example.com/editor/wf1")
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
