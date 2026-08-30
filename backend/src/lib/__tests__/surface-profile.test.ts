import { describe, it, expect, afterEach, vi } from "vitest"
import { config } from "../config.js"
import {
  SURFACE_PROFILE_DEFAULT,
  parseSurfaceProfile,
  refineSurfaceEdition,
  runtimeSurfaceProfile,
  surfaceGateOpen,
  surfaceProfileFailedToLoad,
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

describe("surfaceProfileFailedToLoad — fail-closed boot guard (SAI-4/H8)", () => {
  const originalEdition = config.EDITION
  afterEach(() => {
    config.EDITION = originalEdition
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("true: a profile is configured on an honoring edition but fails to load (invalid JSON)", () => {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = "{ not valid json"
    __resetSurfaceProfileCacheForTests()
    expect(surfaceProfileFailedToLoad()).toBe(true)
  })

  it("true: an unreadable @file path", () => {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = "@/nonexistent/does-not-exist.json"
    __resetSurfaceProfileCacheForTests()
    expect(surfaceProfileFailedToLoad()).toBe(true)
  })

  it("false (LOAD-BEARING): an empty-but-VALID profile {} loads as a FRESH object, not the default identity", () => {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = "{}"
    __resetSurfaceProfileCacheForTests()
    // A successful parse returns mergeOverDefault(...), a distinct object — so
    // the by-identity check does not mistake "loaded, equals default" for "failed".
    expect(runtimeSurfaceProfile()).not.toBe(SURFACE_PROFILE_DEFAULT)
    expect(surfaceProfileFailedToLoad()).toBe(false)
  })

  it("false: a real profile loads", () => {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nav: { hide: ["gallery"] } })
    __resetSurfaceProfileCacheForTests()
    expect(surfaceProfileFailedToLoad()).toBe(false)
  })

  it("false: no profile configured (env unset) — a plain deployment is not a failure", () => {
    config.EDITION = "cloud"
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    expect(surfaceProfileFailedToLoad()).toBe(false)
  })

  it("false: community ignores the profile (gate closed) — nothing to fail closed on", () => {
    config.EDITION = "community"
    process.env.NODARO_SURFACE_PROFILE = "{ not valid json"
    __resetSurfaceProfileCacheForTests()
    expect(surfaceProfileFailedToLoad()).toBe(false)
  })
})

describe("billing — the display-unit trio is coherent or absent (Phase B, §3.5)", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { spy, calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())

  it("stock default: inherit + self-serve on, no unit", () => {
    expect(SURFACE_PROFILE_DEFAULT.billing).toEqual({ costTab: "inherit", selfServe: true })
    expect(parseSurfaceProfile(JSON.stringify({})).billing).toEqual({ costTab: "inherit", selfServe: true })
  })

  it("keeps a coherent trio (label + rate, optional decimals) and trims the label", () => {
    const p = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: " קרדיטים ", unitRate: 2000, selfServe: false, costTab: "hidden" } }))
    expect(p.billing).toEqual({ costTab: "hidden", selfServe: false, unitLabel: "קרדיטים", unitRate: 2000 })
    const q = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 0.07, unitDecimals: 2 } }))
    expect(q.billing).toEqual({ costTab: "inherit", selfServe: true, unitLabel: "u", unitRate: 0.07, unitDecimals: 2 })
  })

  it("both-or-neither: a label without a rate (or vice versa) drops BOTH, loudly", () => {
    const { calls } = warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u" } })).billing).toEqual({ costTab: "inherit", selfServe: true })
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitRate: 2000 } })).billing).toEqual({ costTab: "inherit", selfServe: true })
    expect(calls().filter((m) => m.includes("both or neither")).length).toBe(2)
  })

  it("a rate that is not a finite positive NUMBER drops the trio (a stringified \"250\" included)", () => {
    const { calls } = warn()
    for (const unitRate of ["250", 0, -1, Number.POSITIVE_INFINITY, null]) {
      const p = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate } }))
      expect(p.billing.unitRate, String(unitRate)).toBeUndefined()
      expect(p.billing.unitLabel, String(unitRate)).toBeUndefined()
    }
    expect(calls().some((m) => m.includes("finite number > 0") || m.includes("both or neither"))).toBe(true)
  })

  it("decimals outside 0..4 or non-integer drop the trio", () => {
    warn()
    for (const unitDecimals of [5, -1, 1.5, "2"]) {
      const p = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 2000, unitDecimals } }))
      expect(p.billing.unitLabel, String(unitDecimals)).toBeUndefined()
    }
  })

  it("no-zero-lie: a configuration where 1 credit would display as 0 is rejected", () => {
    const { calls } = warn()
    const p = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 0.01, unitDecimals: 0 } }))
    expect(p.billing.unitLabel).toBeUndefined()
    expect(calls().some((m) => m.includes("no-zero-lie"))).toBe(true)
    // …but the same rate with enough decimals is fine.
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 0.01, unitDecimals: 2 } })).billing.unitRate).toBe(0.01)
  })

  it("lossless (H12): unitRate × 10^decimals must be an integer, so per-charge conversion sums exactly", () => {
    const { calls } = warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 0.07, unitDecimals: 1 } })).billing.unitLabel).toBeUndefined()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 2.5 } })).billing.unitLabel).toBeUndefined()
    expect(calls().some((m) => m.includes("must be an integer"))).toBe(true)
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 2.5, unitDecimals: 1 } })).billing.unitRate).toBe(2.5)
  })

  it("decimals without a label/rate is dropped; an empty label is dropped", () => {
    warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitDecimals: 2 } })).billing).toEqual({ costTab: "inherit", selfServe: true })
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "   ", unitRate: 2000 } })).billing.unitLabel).toBeUndefined()
  })

  it("selfServe is a fail-closed flag: a present \"false\" never flips open; absent → true", () => {
    warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { selfServe: "false" } })).billing.selfServe).toBe(false)
    expect(parseSurfaceProfile(JSON.stringify({ billing: { selfServe: false } })).billing.selfServe).toBe(false)
    expect(parseSurfaceProfile(JSON.stringify({ billing: { selfServe: "0" } })).billing.selfServe).toBe(false)
    expect(parseSurfaceProfile(JSON.stringify({ billing: {} })).billing.selfServe).toBe(true)
  })

  it("costTab: an unknown value degrades to inherit; a non-object billing block degrades to the default", () => {
    warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { costTab: "bogus" } })).billing.costTab).toBe("inherit")
    expect(parseSurfaceProfile(JSON.stringify({ billing: "x" })).billing).toEqual({ costTab: "inherit", selfServe: true })
    // …and never takes the rest of the profile down with it.
    expect(parseSurfaceProfile(JSON.stringify({ billing: "x", nav: { hide: ["gallery"] } })).nav.hide).toEqual(["gallery"])
  })
})
