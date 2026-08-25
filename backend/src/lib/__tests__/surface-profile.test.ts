import { describe, it, expect, afterEach } from "vitest"
import { config } from "../config.js"
import {
  SURFACE_PROFILE_DEFAULT,
  parseSurfaceProfile,
  refineSurfaceEdition,
  runtimeSurfaceProfile,
  surfaceGateOpen,
  __resetSurfaceProfileCacheForTests,
} from "../surface-profile.js"

describe("SURFACE_PROFILE_DEFAULT — inert stock default", () => {
  it("hides nothing, denies nothing, allows public, shows the picker", () => {
    const d = SURFACE_PROFILE_DEFAULT
    expect(d.nav.hide).toEqual([])
    expect(d.dashboard.tabs).toEqual([])
    expect(d.nodes.deny).toEqual([])
    expect(d.models.deny).toEqual([])
    expect(d.auth.methods).toEqual([])
    expect(d.siblings.apps).toEqual([])
    expect(d.brand.productName).toBe("Nodaro")
    expect(d.locale.picker).toBe(true)
    expect(d.outputs.allowPublic).toBe(true)
  })
})

describe("parseSurfaceProfile — env string → profile", () => {
  it("returns the stock default for undefined and blank", () => {
    expect(parseSurfaceProfile(undefined)).toEqual(SURFACE_PROFILE_DEFAULT)
    expect(parseSurfaceProfile("")).toEqual(SURFACE_PROFILE_DEFAULT)
    expect(parseSurfaceProfile("   ")).toEqual(SURFACE_PROFILE_DEFAULT)
  })

  it("merges a partial override over the default, one level deep", () => {
    const p = parseSurfaceProfile(JSON.stringify({ nav: { hide: ["gallery"] }, brand: { productName: "Studio SAI" } }))
    expect(p.nav.hide).toEqual(["gallery"])
    expect(p.brand.productName).toBe("Studio SAI")
    // untouched keys keep the default
    expect(p.outputs.allowPublic).toBe(true)
    expect(p.locale.picker).toBe(true)
  })

  it("replaces arrays wholesale (never concatenates)", () => {
    const p = parseSurfaceProfile(JSON.stringify({ nodes: { deny: ["social-publish"] } }))
    expect(p.nodes.deny).toEqual(["social-publish"])
  })

  it("degrades to the stock default on malformed JSON, without throwing", () => {
    expect(() => parseSurfaceProfile("{ not json ")).not.toThrow()
    expect(parseSurfaceProfile("{ not json ")).toEqual(SURFACE_PROFILE_DEFAULT)
  })

  it("drops unknown NavKeys instead of failing the whole profile", () => {
    const p = parseSurfaceProfile(JSON.stringify({ nav: { hide: ["gallery", "bogus"] } }))
    expect(p.nav.hide).toEqual(["gallery"])
  })
})

describe("dashboard.tabs — app-discovery keys are representable", () => {
  it("keeps statistics/tutorials/miniapps instead of dropping them", () => {
    const p = parseSurfaceProfile(JSON.stringify({ dashboard: { tabs: ["statistics", "tutorials"] } }))
    expect(p.dashboard.tabs).toEqual(["statistics", "tutorials"])
  })
})

describe("S2 — deny arrays degrade element-wise, never whole-field", () => {
  it("keeps valid string members and drops non-strings (nodes.deny)", () => {
    // The bug: z.array(z.string()) rejected the WHOLE array on one non-string,
    // then .catch([]) dropped EVERY deny entry — silently un-denying everything.
    const p = parseSurfaceProfile(JSON.stringify({ nodes: { deny: ["social-publish", null] } }))
    expect(p.nodes.deny).toContain("social-publish")
    expect(p.nodes.deny).toEqual(["social-publish"])
  })

  it("keeps valid string members and drops non-strings (models.deny)", () => {
    const p = parseSurfaceProfile(JSON.stringify({ models: { deny: ["veo3", 123, "flux", null] } }))
    expect(p.models.deny).toEqual(["veo3", "flux"])
  })
})

describe("S1 — outputs.allowPublic is a fail-closed privacy control", () => {
  it("a stringified \"false\" resolves to false (does NOT flip open)", () => {
    // The bug: "false" failed z.boolean(), the whole outputs object caught to
    // { allowPublic: true }, and a locked-down install silently went public.
    const p = parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: "false" } }))
    expect(p.outputs.allowPublic).toBe(false)
  })

  it("coerces the accepted string/boolean forms", () => {
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: false } })).outputs.allowPublic).toBe(false)
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: "0" } })).outputs.allowPublic).toBe(false)
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: "true" } })).outputs.allowPublic).toBe(true)
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: "1" } })).outputs.allowPublic).toBe(true)
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: true } })).outputs.allowPublic).toBe(true)
  })

  it("defaults to public (true) when genuinely absent or unparseable", () => {
    // present outputs object, missing field
    expect(parseSurfaceProfile(JSON.stringify({ outputs: {} })).outputs.allowPublic).toBe(true)
    // unparseable value
    expect(parseSurfaceProfile(JSON.stringify({ outputs: { allowPublic: "maybe" } })).outputs.allowPublic).toBe(true)
    // outputs key absent entirely
    expect(parseSurfaceProfile(JSON.stringify({ brand: { productName: "X" } })).outputs.allowPublic).toBe(true)
  })
})

describe("refineSurfaceEdition — narrows, never widens", () => {
  it("drops auth methods the edition cannot serve (widen vector)", () => {
    // "sso" without a configured ssoLabel is not a serveable method → dropped.
    const refined = refineSurfaceEdition({
      ...SURFACE_PROFILE_DEFAULT,
      auth: { methods: ["email", "sso"] },
    })
    expect(refined.auth.methods).toEqual(["email"])
  })

  it("keeps sso when an ssoLabel is present", () => {
    const refined = refineSurfaceEdition({
      ...SURFACE_PROFILE_DEFAULT,
      auth: { methods: ["sso"], ssoLabel: "LibreChat" },
    })
    expect(refined.auth.methods).toEqual(["sso"])
  })

  it("leaves deny/hide (subtractive fields) untouched — they can only narrow", () => {
    const refined = refineSurfaceEdition({
      ...SURFACE_PROFILE_DEFAULT,
      nodes: { deny: ["social-publish"] },
      nav: { hide: ["gallery"] },
    })
    expect(refined.nodes.deny).toEqual(["social-publish"])
    expect(refined.nav.hide).toEqual(["gallery"])
  })
})

describe("d2 gate — the surface profile is business+ only", () => {
  const originalEdition = config.EDITION

  afterEach(() => {
    config.EDITION = originalEdition
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("community ignores NODARO_SURFACE_PROFILE — gate closed, stock default served", () => {
    config.EDITION = "community"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nav: { hide: ["gallery"] } })
    __resetSurfaceProfileCacheForTests()
    expect(surfaceGateOpen()).toBe(false)
    expect(runtimeSurfaceProfile()).toEqual(SURFACE_PROFILE_DEFAULT)
  })

  it("business applies NODARO_SURFACE_PROFILE — gate open", () => {
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nav: { hide: ["gallery"] } })
    __resetSurfaceProfileCacheForTests()
    expect(surfaceGateOpen()).toBe(true)
    expect(runtimeSurfaceProfile().nav.hide).toEqual(["gallery"])
  })

  it("cloud applies NODARO_SURFACE_PROFILE — gate open", () => {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ outputs: { allowPublic: false } })
    __resetSurfaceProfileCacheForTests()
    expect(surfaceGateOpen()).toBe(true)
    expect(runtimeSurfaceProfile().outputs.allowPublic).toBe(false)
  })
})
