import { afterEach, describe, expect, it, vi } from "vitest"
import { httpsOriginOf, legacyUiHostList, movedPagesSettingsProblem } from "../moved-pages-settings.js"

/**
 * The settings that move a deployment's pages to their own host
 * (docs/deployment.md, "Moving the app's pages to their own host"). The proxy
 * reads them per request and stays inert on a bad value; the server is where a
 * bad value is refused, loudly, at boot, naming the setting.
 */

describe("httpsOriginOf: the origin a setting names, as the Caddy block reads it", () => {
  it("takes a bare https origin, a trailing slash allowed", () => {
    expect(httpsOriginOf("https://flow.example.com")).toBe("https://flow.example.com")
    expect(httpsOriginOf(" https://flow.example.com/ ")).toBe("https://flow.example.com")
  })
  it("refuses anything else", () => {
    for (const bad of ["", "http://flow.example.com", "https://flow.example.com/x", "https://Flow.example.com", "https://flow.example.com:8443", 'https://a"b', "flow.example.com", undefined]) {
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

  it("a partial set is refused: the move is on only with both settings, as the proxy and the browser read it", () => {
    expect(movedPagesSettingsProblem({ LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com" })).toMatch(/^LEGACY_UI_HOSTS /)
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^LEGACY_UI_HOSTS /)
    // Naming only the Flow host is no legacy host at all.
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "Flow.example.com", PUBLIC_URL: "https://app.example.com" })).toMatch(/^LEGACY_UI_HOSTS /)
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com" })).toBeNull()
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
  })

  it("with FLOW_UI_ORIGIN set, PUBLIC_URL must give the kept host's https origin, never the Flow host's", () => {
    for (const PUBLIC_URL of ["", "http://app.example.com", "https://app.example.com/v1", "https://flow.example.com"]) {
      expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL }), PUBLIC_URL).toMatch(/^PUBLIC_URL /)
    }
    expect(movedPagesSettingsProblem({ FLOW_UI_ORIGIN: "https://flow.example.com/", LEGACY_UI_HOSTS: HOSTS, PUBLIC_URL: "https://app.example.com/" })).toBeNull()
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

  it("refuses a partial set", async () => {
    vi.resetModules()
    vi.stubEnv("FLOW_UI_ORIGIN", "https://flow.example.com")
    vi.stubEnv("LEGACY_UI_HOSTS", "")
    vi.stubEnv("PUBLIC_URL", "https://app.example.com")
    await expect(import("../config.js")).rejects.toThrow(/LEGACY_UI_HOSTS/)
  })
})
