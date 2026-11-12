import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The MCP lane's address funnel (lib/mcp-lane-addresses.ts) and the declared
 * hosts it trusts (allowed-origins.ts `declaredOriginOfRequest`).
 *
 * Driven through a mocked `config` (config parses the environment once at
 * import) and the surface profile's env seam.
 */
const env = {
  PUBLIC_URL: "",
  MCP_PUBLIC_URL: "",
  CORS_ORIGIN: "",
  FLOW_PUBLIC_URL: "",
  FLOW_UI_ORIGIN: "",
  LEGACY_UI_HOSTS: "",
  EDITION: "cloud",
  MCP_ENABLED: true,
}
vi.mock("../config.js", async (orig) => {
  const actual = await orig<typeof import("../config.js")>()
  return { ...actual, config: env, isCloud: () => env.EDITION === "cloud", isBusiness: () => env.EDITION === "business" }
})

const REAL_PROFILE = process.env.NODARO_SURFACE_PROFILE

beforeEach(() => {
  Object.assign(env, { PUBLIC_URL: "", MCP_PUBLIC_URL: "", CORS_ORIGIN: "", FLOW_PUBLIC_URL: "", FLOW_UI_ORIGIN: "", LEGACY_UI_HOSTS: "", EDITION: "cloud", MCP_ENABLED: true })
  delete process.env.NODARO_SURFACE_PROFILE
  vi.resetModules()
})
afterEach(() => {
  if (REAL_PROFILE === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_PROFILE
})

const req = (host: string, extra: Record<string, string> = {}) => ({ headers: { host, ...extra } })

async function load(profile?: unknown) {
  if (profile !== undefined) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  const mod = await import("../mcp-lane-addresses.js")
  const urls = await import("../deployment-urls.js")
  const origins = await import("../allowed-origins.js")
  return { ...mod, ...urls, ...origins }
}

describe("the dedicated lane: exactly the addresses every site used before path mode", () => {
  it.each([
    ["Cloud defaults (nothing set)", {}],
    ["a self-host with its own hosts", { PUBLIC_URL: "https://studio.example.com/", MCP_PUBLIC_URL: "https://mcp.example.com/", CORS_ORIGIN: "https://alt.example.com" }],
    ["pages moved to their own host", { PUBLIC_URL: "https://api.example.com", FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "api.example.com" }],
  ])("%s", async (_label, settings) => {
    Object.assign(env, settings)
    const m = await load()
    const a = m.mcpLaneAddresses(req("alt.example.com"), "dedicated")
    // Each field is the expression its site used to compute itself.
    expect(a).toEqual({
      lane: "dedicated",
      mcpUrl: `${m.mcpBaseUrl()}/mcp`,
      realm: m.mcpBaseUrl().replace(/^https?:\/\//, ""),
      resourceMetadataUrl: null,
      issuer: m.appBaseUrl(),
      uploadProxyBase: m.mcpBaseUrl(),
      uploadPageBase: env.PUBLIC_URL.replace(/\/+$/, ""),
      handoffPageBase: env.PUBLIC_URL,
      pagesBase: m.flowBaseUrl(),
      picturesBase: m.appBaseUrl(),
    })
    expect(m.laneEditorUrl(a, "wf 1")).toBe(m.workflowEditorUrl("wf 1"))
    // No request at all (an in-process session) is the same set.
    expect(m.mcpLaneAddresses()).toEqual(a)
  })

  it("path mode is served only with MCP on and PUBLIC_URL an http(s) URL", async () => {
    env.CORS_ORIGIN = "https://second.example.com"
    const cases: Array<[Partial<typeof env>, string | null]> = [
      [{ PUBLIC_URL: "https://primary.example.com", MCP_ENABLED: true }, "/v1/mcp"],
      [{ PUBLIC_URL: "https://primary.example.com", MCP_ENABLED: false }, null],
      [{ PUBLIC_URL: "", MCP_ENABLED: true }, null],
      [{ PUBLIC_URL: "primary.example.com", MCP_ENABLED: true }, null],
      [{ PUBLIC_URL: "ftp://primary.example.com", MCP_ENABLED: true }, null],
    ]
    for (const [settings, served] of cases) {
      Object.assign(env, settings)
      vi.resetModules()
      const m = await load({ mcp: { byPath: true } })
      expect(m.mcpServedPath(), JSON.stringify(settings)).toBe(served)
      if (served === null) {
        // Not served: the path lane is the dedicated one, never a default host.
        expect(m.metadataLane()).toBe("dedicated")
        expect(m.mcpLaneAddresses(req("second.example.com"), "path")).toEqual(m.mcpLaneAddresses())
      }
    }
  })

  it("asking for the path lane while path mode is off answers the dedicated lane", async () => {
    env.PUBLIC_URL = "https://primary.example.com"
    env.CORS_ORIGIN = "https://second.example.com"
    const m = await load({ mcp: { byPath: false } })
    expect(m.mcpPathModeOn()).toBe(false)
    expect(m.metadataLane()).toBe("dedicated")
    expect(m.mcpLaneAddresses(req("second.example.com"), "path")).toEqual(m.mcpLaneAddresses())
  })
})

describe("the path lane: the declared host the client connected through, else the primary origin", () => {
  beforeEach(() => {
    env.PUBLIC_URL = "https://primary.example.com"
    env.CORS_ORIGIN = "https://second.example.com,http://plain.example.org , https://ported.example.net:8443, not a url, ftp://files.example.com"
  })

  it("a declared host: every address on it", async () => {
    const m = await load({ mcp: { byPath: true } })
    expect(m.metadataLane()).toBe("path")
    const a = m.mcpLaneAddresses(req("second.example.com"), "path")
    expect(a).toEqual({
      lane: "path",
      mcpUrl: "https://second.example.com/v1/mcp",
      realm: "second.example.com",
      resourceMetadataUrl: "https://second.example.com/.well-known/oauth-protected-resource/v1/mcp",
      issuer: "https://second.example.com",
      uploadProxyBase: "https://second.example.com",
      uploadPageBase: "https://second.example.com",
      handoffPageBase: "https://second.example.com",
      pagesBase: "https://second.example.com",
      picturesBase: "https://second.example.com",
    })
    expect(m.laneEditorUrl(a, "wf-1")).toBe("https://second.example.com/editor/wf-1")
  })

  it("the configured path is the endpoint's path and its metadata document's suffix", async () => {
    const m = await load({ mcp: { byPath: true, path: "/v1/mcp/agents" } })
    const a = m.mcpLaneAddresses(req("primary.example.com"), "path")
    expect(a.mcpUrl).toBe("https://primary.example.com/v1/mcp/agents")
    expect(a.resourceMetadataUrl).toBe("https://primary.example.com/.well-known/oauth-protected-resource/v1/mcp/agents")
  })

  it.each([
    ["no request", undefined],
    ["an undeclared host", req("evil.example.com")],
    ["a declared host on another port", req("second.example.com:444")],
    ["a declared ported host without its port", req("ported.example.net")],
    ["a host with a path", req("second.example.com/evil")],
    ["a host with credentials", req("second.example.com@evil.example.com")],
    ["a lookalike", req("second.example.com.evil.example.com")],
    ["an entry that is not a URL", req("not a url")],
    ["a non-http declaration", req("files.example.com")],
    ["no host header at all", { headers: {} }],
    ["an undeclared forwarded host", req("second.example.com", { "x-forwarded-host": "evil.example.com" })],
  ])("%s → the primary origin", async (_label, request) => {
    const m = await load({ mcp: { byPath: true } })
    const a = m.mcpLaneAddresses(request, "path")
    expect(a.issuer).toBe("https://primary.example.com")
    expect(a.mcpUrl).toBe("https://primary.example.com/v1/mcp")
    expect(JSON.stringify(a)).not.toContain("evil")
  })

  it("the primary origin drops PUBLIC_URL's trailing slash and any path", async () => {
    env.PUBLIC_URL = "https://primary.example.com/app/"
    const m = await load({ mcp: { byPath: true } })
    expect(m.mcpLaneAddresses(req("evil.example.com"), "path").issuer).toBe("https://primary.example.com")
    expect(m.mcpLaneAddresses(req("primary.example.com"), "path").mcpUrl).toBe("https://primary.example.com/v1/mcp")
  })

  it("port and scheme come from the declaration; letter case of the host is ignored", async () => {
    const m = await load({ mcp: { byPath: true } })
    expect(m.mcpLaneAddresses(req("ported.example.net:8443"), "path").issuer).toBe("https://ported.example.net:8443")
    expect(m.mcpLaneAddresses(req("plain.example.org", { "x-forwarded-proto": "https" }), "path").issuer).toBe("http://plain.example.org")
    expect(m.mcpLaneAddresses(req("SECOND.Example.COM"), "path").issuer).toBe("https://second.example.com")
  })

  it("a host declared under both schemes is stated as https", async () => {
    env.CORS_ORIGIN = "http://second.example.com,https://second.example.com"
    const m = await load({ mcp: { byPath: true } })
    expect(m.declaredOriginOfRequest(req("second.example.com"))).toBe("https://second.example.com")
    env.CORS_ORIGIN = "https://second.example.com,http://second.example.com"
    expect(m.declaredOriginOfRequest(req("second.example.com"))).toBe("https://second.example.com")
  })

  it("the built-in localhost development origins are not declared hosts", async () => {
    const m = await load({ mcp: { byPath: true } })
    expect(m.isAllowedRequestHost(req("localhost:3000"))).toBe(true) // the CORS allowlist keeps them…
    expect(m.declaredOriginOfRequest(req("localhost:3000"))).toBeNull() // …the deployment never declared them
    expect(m.mcpLaneAddresses(req("localhost:3000"), "path").issuer).toBe("https://primary.example.com")
  })

  it("a forwarded host the deployment declared wins over Host, as the SSO host check reads it", async () => {
    const m = await load({ mcp: { byPath: true } })
    expect(m.mcpLaneAddresses(req("primary.example.com", { "x-forwarded-host": "second.example.com" }), "path").issuer).toBe("https://second.example.com")
  })

  it("pages moved to their own host stay linked there; everything else follows the connected host", async () => {
    env.FLOW_UI_ORIGIN = "https://flow.example.com"
    env.LEGACY_UI_HOSTS = "primary.example.com"
    const m = await load({ mcp: { byPath: true } })
    const a = m.mcpLaneAddresses(req("second.example.com"), "path")
    expect(a.pagesBase).toBe("https://flow.example.com")
    expect(a.issuer).toBe("https://second.example.com")
    expect(a.uploadPageBase).toBe("https://second.example.com")
  })
})
