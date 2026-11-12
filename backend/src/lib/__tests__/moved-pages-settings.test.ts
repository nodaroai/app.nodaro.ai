import { afterEach, describe, expect, it, vi } from "vitest"
import { flowHostOrigins, httpsOriginOf, legacyUiHostList, movedFlowOrigin, movedPagesSettingsProblem } from "../moved-pages-settings.js"

/**
 * The settings that move a deployment's pages to their own host
 * (docs/deployment.md, "Moving the app's pages to their own host"). The proxy
 * reads them per request and stays inert on a bad value; the server is where a
 * bad value is refused, loudly, at boot, naming the setting.
 */

describe("httpsOriginOf: the origin a setting names, as the Caddy block reads it", () => {
  it("takes a bare https origin, a trailing slash allowed", () => {
    expect(httpsOriginOf("https://flow.example.com")).toBe("https://flow.example.com")
    expect(httpsOriginOf("https://flow.example.com/")).toBe("https://flow.example.com")
  })
  it("refuses anything else, spaces around the value included (the proxy reads the value whole)", () => {
    for (const bad of ["", "http://flow.example.com", "https://flow.example.com/x", "https://Flow.example.com", "https://flow.example.com:8443", 'https://a"b', "flow.example.com", " https://flow.example.com", "https://flow.example.com/ ", "https://flow.example.com\n", undefined]) {
      expect(httpsOriginOf(bad), String(bad)).toBeNull()
    }
  })
})

describe("legacyUiHostList: one rule, the proxy's and the browser's", () => {
  it("commas are spaces, runs of spaces separate, letter case is ignored", () => {
    expect(legacyUiHostList(" App.Example.com ,next.app.example.com  other.example.com")).toEqual(["app.example.com", "next.app.example.com", "other.example.com"])
    expect(legacyUiHostList("")).toEqual([])
    expect(legacyUiHostList(undefined)).toEqual([])
  })
})

describe("movedPagesSettingsProblem", () => {
  const HOSTS = "app.example.com"

  it("unset is nothing to refuse (the move stays off)", () => {
    expect(movedPagesSettingsProblem({})).toBeNull()
    expect(movedPagesSettingsProblem({ LEGACY_UI_HOSTS: "  ", PUBLIC_URL: "http://localhost:3000" })).toBeNull()
  })

  it("a half-set state is refused: LEGACY_UI_HOSTS without a Flow host, or naming only the Flow host", () => {
    expect(movedPagesSettingsProblem({ LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com" })).toMatch(/^LEGACY_UI_HOSTS /)
    // Naming only the Flow host is no legacy host at all.
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "Flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^LEGACY_UI_HOSTS /)
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com" })).toBeNull()
  })

  it("the Flow host alone runs: the pages have their own host, every host keeps serving them, nothing redirects", () => {
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" })).toBeNull()
    expect(movedPagesSettingsProblem({ FLOW_PUBLIC_URL: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" })).toBeNull()
    // An empty or blank LEGACY_UI_HOSTS is no host: the same state.
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: " , ", PUBLIC_URL: "https://app.example.com" })).toBeNull()
    // It is held to the same origin rules as the move.
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^FLOW_UI_ORIGIN /)
    for (const PUBLIC_URL of ["", "http://app.example.com", "https://app.example.com/v1", "https://flow.example.com"]) {
      expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL }), PUBLIC_URL).toMatch(/^PUBLIC_URL /)
    }
  })

  it("every LEGACY_UI_HOSTS entry must be a bare host name, by the runtime config contract's rule", () => {
    const valid = { FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" }
    for (const LEGACY_UI_HOSTS of ["app.example.com\n", "https://app.example.com", "app.example.com:443", "app.example.com/", "app.example.com\tnext.example.com"]) {
      expect(movedPagesSettingsProblem({ ...valid, LEGACY_UI_HOSTS }), JSON.stringify(LEGACY_UI_HOSTS)).toMatch(/^LEGACY_UI_HOSTS /)
    }
    expect(movedPagesSettingsProblem({ ...valid, LEGACY_UI_HOSTS: "App.Example.com, next.example.com" })).toBeNull()
  })

  it("a FLOW_UI_ORIGIN that is not an https origin is refused, naming it", () => {
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^FLOW_UI_ORIGIN /)
    // The proxy would leave the move off for these while links named the Flow host: refused instead.
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: " https://flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^FLOW_UI_ORIGIN /)
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com\n", PUBLIC_URL: "https://app.example.com" })).toMatch(/^FLOW_UI_ORIGIN /)
  })

  it("only an empty value is unset, as the image's start script reads it; spaces alone are refused", () => {
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "", FLOW_PUBLIC_URL: "", PUBLIC_URL: "http://localhost:3000" })).toBeNull()
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "   ", FLOW_PUBLIC_URL: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^FLOW_UI_ORIGIN /)
  })

  it("with FLOW_UI_ORIGIN set, PUBLIC_URL must give the kept host's https origin, never the Flow host's", () => {
    for (const PUBLIC_URL of ["", "http://app.example.com", "https://app.example.com/v1", "https://flow.example.com"]) {
      expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL }), PUBLIC_URL).toMatch(/^PUBLIC_URL /)
    }
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com/", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com/" })).toBeNull()
  })
})

describe("FLOW_UI_ORIGIN and FLOW_PUBLIC_URL: two names, one origin", () => {
  const PUBLIC_URL = "https://app.example.com"
  const LEGACY_UI_HOSTS = "app.example.com"

  it("either name gives the Flow origin once the move is on", () => {
    expect(movedFlowOrigin({ FLOW_UI_ORIGIN: "https://flow.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toBe("https://flow.example.com")
    expect(movedFlowOrigin({ FLOW_PUBLIC_URL: "https://flow.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toBe("https://flow.example.com")
    expect(movedFlowOrigin({ FLOW_UI_ORIGIN: "https://flow.example.com", FLOW_PUBLIC_URL: "https://flow.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toBe("https://flow.example.com")
    expect(movedFlowOrigin({})).toBeNull()
    expect(movedFlowOrigin({ FLOW_PUBLIC_URL: "http://flow.example.com", LEGACY_UI_HOSTS, PUBLIC_URL })).toBeNull()
  })

  it("both set to different origins is refused, naming both", () => {
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", FLOW_PUBLIC_URL: "https://pages.example.com", LEGACY_UI_HOSTS, PUBLIC_URL }))
      .toMatch(/^FLOW_PUBLIC_URL and FLOW_UI_ORIGIN /)
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", FLOW_PUBLIC_URL: "https://flow.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toBeNull()
  })

  it("FLOW_PUBLIC_URL alone is held to the same rules, naming it", () => {
    expect(movedPagesSettingsProblem({ FLOW_PUBLIC_URL: "http://flow.example.com", LEGACY_UI_HOSTS, PUBLIC_URL })).toMatch(/^FLOW_PUBLIC_URL /)
    expect(movedPagesSettingsProblem({ FLOW_PUBLIC_URL: "https://flow.example.com", LEGACY_UI_HOSTS, PUBLIC_URL: "http://localhost:3000" })).toMatch(/^PUBLIC_URL /)
    expect(movedPagesSettingsProblem({ FLOW_PUBLIC_URL: "https://app.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toMatch(/^PUBLIC_URL /)
    expect(movedPagesSettingsProblem({ FLOW_PUBLIC_URL: "https://flow.example.com/", LEGACY_UI_HOSTS, PUBLIC_URL })).toBeNull()
  })

  it("the server's links follow the one rule: a Flow origin with no legacy host, or no kept origin, moves nothing", () => {
    expect(movedFlowOrigin({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL })).toBeNull()
    expect(movedFlowOrigin({ FLOW_PUBLIC_URL: "https://flow.example.com", LEGACY_UI_HOSTS: "flow.example.com", PUBLIC_URL })).toBeNull()
    expect(movedFlowOrigin({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS, PUBLIC_URL: "http://localhost:3000" })).toBeNull()
  })
})

describe("flowHostOrigins: the pages' own host, with or without the move", () => {
  const PUBLIC_URL = "https://app.example.com/"

  it("gives both origins once the Flow host and a different kept host are https origins", () => {
    expect(flowHostOrigins({ FLOW_UI_ORIGIN: "https://flow.example.com/", PUBLIC_URL })).toEqual({ flow: "https://flow.example.com", kept: "https://app.example.com" })
    expect(flowHostOrigins({ FLOW_PUBLIC_URL: "https://flow.example.com", PUBLIC_URL })).toEqual({ flow: "https://flow.example.com", kept: "https://app.example.com" })
    expect(flowHostOrigins({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "app.example.com", PUBLIC_URL })).toEqual({ flow: "https://flow.example.com", kept: "https://app.example.com" })
  })

  it("is null without a Flow origin, or without a kept origin of its own", () => {
    expect(flowHostOrigins({ PUBLIC_URL })).toBeNull()
    expect(flowHostOrigins({ FLOW_UI_ORIGIN: "http://flow.example.com", PUBLIC_URL })).toBeNull()
    expect(flowHostOrigins({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "http://localhost:3000" })).toBeNull()
    expect(flowHostOrigins({ FLOW_UI_ORIGIN: "https://app.example.com", PUBLIC_URL })).toBeNull()
  })
})

describe("the server refuses to start on a setting it cannot run", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("names the setting", async () => {
    vi.resetModules()
    vi.stubEnv("FLOW_UI_ORIGIN", "https://flow.example.com")
    vi.stubEnv("LEGACY_UI_HOSTS", "app.example.com")
    vi.stubEnv("PUBLIC_URL", "http://localhost:3000")
    await expect(import("../config.js")).rejects.toThrow(/PUBLIC_URL/)
  })

  it("refuses a half-set state", async () => {
    vi.resetModules()
    vi.stubEnv("FLOW_UI_ORIGIN", "")
    vi.stubEnv("FLOW_PUBLIC_URL", "")
    vi.stubEnv("LEGACY_UI_HOSTS", "app.example.com")
    vi.stubEnv("PUBLIC_URL", "https://app.example.com")
    await expect(import("../config.js")).rejects.toThrow(/LEGACY_UI_HOSTS/)
  })

  it("names both when the Flow host's two names disagree", async () => {
    vi.resetModules()
    vi.stubEnv("FLOW_UI_ORIGIN", "https://flow.example.com")
    vi.stubEnv("FLOW_PUBLIC_URL", "https://pages.example.com")
    vi.stubEnv("LEGACY_UI_HOSTS", "app.example.com")
    vi.stubEnv("PUBLIC_URL", "https://app.example.com")
    await expect(import("../config.js")).rejects.toThrow(/FLOW_PUBLIC_URL and FLOW_UI_ORIGIN/)
  })
})
