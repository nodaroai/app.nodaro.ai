// @test-watches frontend/src/lib/i18n/en.{ts,js} frontend/src/lib/i18n/platform-languages.{ts,js}
import { describe, it, expect, afterEach, vi } from "vitest"
import { buildUiStringManifest } from "@nodaro/shared/runtime-config"
import { en } from "../../../../frontend/src/lib/i18n/en.js"
import { PLATFORM_LANGUAGES } from "../../../../frontend/src/lib/i18n/platform-languages.js"
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
    const p = parseSurfaceProfile(JSON.stringify({ nav: { hide: ["gallery"] }, brand: { productName: "Studio Acme" } }))
    expect(p.nav.hide).toEqual(["gallery"])
    expect(p.brand.productName).toBe("Studio Acme")
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
      nodes: { deny: ["social-publish"], allow: [] },
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
    expect(SURFACE_PROFILE_DEFAULT.billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
    expect(parseSurfaceProfile(JSON.stringify({})).billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
  })

  it("keeps a coherent trio (label + rate, optional decimals) and trims the label", () => {
    const p = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: " קרדיטים ", unitRate: 2000, selfServe: false, costTab: "hidden" } }))
    expect(p.billing).toEqual({ costTab: "hidden", sidebarCard: "inherit", selfServe: false, unitLabel: "קרדיטים", unitRate: 2000 })
    const q = parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u", unitRate: 0.07, unitDecimals: 2 } }))
    expect(q.billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "u", unitRate: 0.07, unitDecimals: 2 })
  })

  it("both-or-neither: a label without a rate (or vice versa) drops BOTH, loudly", () => {
    const { calls } = warn()
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "u" } })).billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitRate: 2000 } })).billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
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
    expect(parseSurfaceProfile(JSON.stringify({ billing: { unitDecimals: 2 } })).billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
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
    expect(parseSurfaceProfile(JSON.stringify({ billing: "x" })).billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
    // …and never takes the rest of the profile down with it.
    expect(parseSurfaceProfile(JSON.stringify({ billing: "x", nav: { hide: ["gallery"] } })).nav.hide).toEqual(["gallery"])
  })

  it("sidebarCard: \"hidden\" survives the parse (does not vanish in coherentBilling); unknown/absent degrade to inherit", () => {
    warn()
    // The trap: coherentBilling constructs its output explicitly — a field
    // parsed but not threaded through would validate and then silently vanish.
    const p = parseSurfaceProfile(JSON.stringify({ billing: { sidebarCard: "hidden", selfServe: false } }))
    expect(p.billing.sidebarCard).toBe("hidden")
    // …also alongside a coherent unit trio (the hosted-instance shape).
    const q = parseSurfaceProfile(JSON.stringify({ billing: { sidebarCard: "hidden", unitLabel: "u", unitRate: 2000 } }))
    expect(q.billing).toEqual({ costTab: "inherit", sidebarCard: "hidden", selfServe: true, unitLabel: "u", unitRate: 2000 })
    expect(parseSurfaceProfile(JSON.stringify({ billing: { sidebarCard: "bogus" } })).billing.sidebarCard).toBe("inherit")
    expect(parseSurfaceProfile(JSON.stringify({ billing: {} })).billing.sidebarCard).toBe("inherit")
  })
})

describe("sidebar surface additions — integrations nav key, studio tab key, brand wordmark", () => {
  it("nav.hide accepts \"integrations\"", () => {
    const p = parseSurfaceProfile(JSON.stringify({ nav: { hide: ["integrations", "pricing"] } }))
    expect(p.nav.hide).toEqual(["integrations", "pricing"])
  })

  it("dashboard.tabs accepts \"studio\" (the workspace strip's Studio list is narrowable)", () => {
    const p = parseSurfaceProfile(JSON.stringify({ dashboard: { tabs: ["workflows", "projects", "studio"] } }))
    expect(p.dashboard.tabs).toEqual(["workflows", "projects", "studio"])
  })

  it("brand.wordmark survives beside productName; absent stays absent (text-only lockup)", () => {
    const p = parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme Studio", wordmark: "Studio" } }))
    expect(p.brand.productName).toBe("Acme Studio")
    expect(p.brand.wordmark).toBe("Studio")
    expect(parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme Studio" } })).brand.wordmark).toBeUndefined()
  })
})

describe("billing — the allowance keys (Track A / WS0): defaultAllowanceUnits + allowances", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { spy, calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    vi.restoreAllMocks()
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  const withTrio = (extra: Record<string, unknown>) =>
    parseSurfaceProfile(JSON.stringify({ billing: { unitLabel: "קרדיטים", unitRate: 2000, ...extra } })).billing

  it("BOTH keys are absent from the stock default — mainline carries no allowance surface at all", () => {
    expect(SURFACE_PROFILE_DEFAULT.billing.defaultAllowanceUnits).toBeUndefined()
    expect(SURFACE_PROFILE_DEFAULT.billing.allowances).toBeUndefined()
    const b = parseSurfaceProfile(JSON.stringify({})).billing
    expect(b).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
    expect("allowances" in b).toBe(false)
    expect("defaultAllowanceUnits" in b).toBe(false)
  })

  it("keeps a coherent pair beside a coherent trio (the hosted deployment shape)", () => {
    expect(withTrio({ defaultAllowanceUnits: 400000, allowances: "enforce" })).toEqual({
      costTab: "inherit",
      sidebarCard: "inherit",
      selfServe: true,
      unitLabel: "קרדיטים",
      unitRate: 2000,
      defaultAllowanceUnits: 400000,
      allowances: "enforce",
    })
    expect(withTrio({ allowances: "off" }).allowances).toBe("off")
  })

  it("defaultAllowanceUnits must be a whole number of CREDITS at unitRate — a remainder drops it, loudly", () => {
    const { calls } = warn()
    // 400000 / 2000 = 200 credits — kept.
    expect(withTrio({ defaultAllowanceUnits: 400000 }).defaultAllowanceUnits).toBe(400000)
    // 400001 / 2000 = 200.0005 credits — the ledger is in credits (D1/R3), so drop.
    expect(withTrio({ defaultAllowanceUnits: 400001 }).defaultAllowanceUnits).toBeUndefined()
    expect(calls().some((m) => m.includes("defaultAllowanceUnits"))).toBe(true)
  })

  it("defaultAllowanceUnits must be finite and > 0; a string, zero, negative, NaN and Infinity all drop", () => {
    warn()
    for (const v of ["400000", 0, -2000, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      expect(withTrio({ defaultAllowanceUnits: v }).defaultAllowanceUnits, String(v)).toBeUndefined()
    }
  })

  it("allowances accepts ONLY \"off\" | \"enforce\"; anything else drops (⇒ enforcement off, fail-safe)", () => {
    warn()
    for (const v of ["ENFORCE", "on", true, 1, null, {}]) {
      expect(withTrio({ allowances: v }).allowances, String(v)).toBeUndefined()
    }
  })

  it("the two drop INDEPENDENTLY — a bogus one never takes the other down", () => {
    warn()
    const a = withTrio({ defaultAllowanceUnits: 400001, allowances: "enforce" })
    expect(a.defaultAllowanceUnits).toBeUndefined()
    expect(a.allowances).toBe("enforce")
    const b = withTrio({ defaultAllowanceUnits: 400000, allowances: "bogus" })
    expect(b.defaultAllowanceUnits).toBe(400000)
    expect(b.allowances).toBeUndefined()
  })

  it("both are members of the UNIT FAMILY (§11): no coherent trio ⇒ both drop with a warning", () => {
    const { calls } = warn()
    // No trio at all.
    const none = parseSurfaceProfile(JSON.stringify({ billing: { defaultAllowanceUnits: 400000, allowances: "enforce" } })).billing
    expect(none).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true })
    // A trio that fails its own coherence (rate without a label) takes them too.
    const incoherent = parseSurfaceProfile(
      JSON.stringify({ billing: { unitRate: 2000, defaultAllowanceUnits: 400000, allowances: "enforce" } }),
    ).billing
    expect(incoherent.defaultAllowanceUnits).toBeUndefined()
    expect(incoherent.allowances).toBeUndefined()
    expect(calls().filter((m) => m.includes("defaultAllowanceUnits/allowances")).length).toBe(2)
  })

  it("neither key EVER reaches /config.js — the browser learns enforcement from its own balance", async () => {
    const { renderSurfaceProfileForRuntimeConfig } = await import("../surface-profile-runtime-config.js")
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      billing: {
        unitLabel: "קרדיטים",
        unitRate: 2000,
        selfServe: false,
        defaultAllowanceUnits: 400000,
        allowances: "enforce",
        payerAccount: "billing@acme.example",
      },
    })
    __resetSurfaceProfileCacheForTests()

    const backend = runtimeSurfaceProfile()
    // The backend KEEPS both (the boot seed and allowanceEnforcementActive read them)…
    expect(backend.billing.defaultAllowanceUnits).toBe(400000)
    expect(backend.billing.allowances).toBe("enforce")

    const out = renderSurfaceProfileForRuntimeConfig()
    // …and the render strips them, by key AND by value.
    expect(out).not.toContain("defaultAllowanceUnits")
    expect(out).not.toContain("400000")
    expect(out).not.toContain("allowances")
    expect(out).not.toContain("enforce")
    expect(out).not.toContain("payerAccount")
    const parsed = JSON.parse(out)
    // Everything else survives, resolved.
    expect(parsed.billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: false, unitLabel: "קרדיטים", unitRate: 2000 })
  })
})


it("round-trips hidden platform links without losing the deployment brand", () => {
  expect(parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme", platformLinks: false } })).brand)
    .toEqual({ productName: "Acme", platformLinks: false })
  expect(parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme", platformLinks: "invalid" } })).brand)
    .toEqual({ productName: "Acme", platformLinks: false })
  expect(parseSurfaceProfile("{}").brand.platformLinks).toBeUndefined()
})

it("preserves required catalogs and disabled factory presets, with safe malformed values", () => {
  expect(parseSurfaceProfile("{}").catalogs).toEqual({ required: false, factoryPresets: true })
  expect(parseSurfaceProfile(JSON.stringify({ catalogs: { required: true, factoryPresets: false } })).catalogs)
    .toEqual({ required: true, factoryPresets: false })
  expect(parseSurfaceProfile(JSON.stringify({ catalogs: { required: "invalid", factoryPresets: "invalid" } })).catalogs)
    .toEqual({ required: true, factoryPresets: false })
})

describe("siblings.apps[].urlByHost — per-studio-host sibling URL", () => {
  const parse = (urlByHost: unknown) =>
    parseSurfaceProfile(JSON.stringify({ siblings: { apps: [{ label: "Chat", url: "https://a.example", urlByHost }] } })).siblings.apps[0]

  it("keeps a valid host → URL map", () => {
    expect(parse({ "studio.b.example": "https://b.example" })).toEqual({
      label: "Chat",
      url: "https://a.example",
      urlByHost: { "studio.b.example": "https://b.example" },
    })
  })

  it("drops only the bad entries (mis-cased or ported key, non-URL or non-http value)", () => {
    expect(
      parse({
        "studio.b.example": "https://b.example",
        "Studio.C.example": "https://c.example",
        "studio.d.example:443": "https://d.example",
        "studio.e.example": "javascript:alert(1)",
        "studio.f.example": "not a url",
        "studio.g.example": 7,
      })?.urlByHost,
    ).toEqual({ "studio.b.example": "https://b.example" })
  })

  it.each([undefined, null, "https://b.example", ["x"], { "Bad Key": "https://b.example" }])(
    "leaves the key absent when nothing usable is given (%j)",
    (urlByHost) => {
      expect(parse(urlByHost)).toEqual({ label: "Chat", url: "https://a.example" })
    },
  )
})

describe("siblings without urlByHost — existing profiles", () => {
  it("parse exactly as before", () => {
    const apps = [{ label: "SAI Chat", url: "https://sai.example" }]
    expect(parseSurfaceProfile(JSON.stringify({ siblings: { apps } })).siblings.apps).toEqual(apps)
  })
})

// ── The deployment keys the thin client apps read (runtime-config contract) ──
//
// Every new key is ABSENT from the stock default and from a profile that does
// not set it, so an already-configured deployment's /config.js stays
// byte-identical; readers apply the defaults (@nodaro/shared/runtime-config).
// Each one degrades ALONE — a bad value never takes a sibling key down — and a
// malformed SAFETY control falls to its restrictive side.

describe("new keys — absent unless configured", () => {
  it("the stock default and an empty profile carry none of them", () => {
    for (const p of [SURFACE_PROFILE_DEFAULT, parseSurfaceProfile("{}")]) {
      expect(p.worlds).toBeUndefined()
      expect(p.imports).toBeUndefined()
      expect(p.header).toBeUndefined()
      expect(p.catalogs?.images).toBeUndefined()
      expect(p.locale.offered).toBeUndefined()
      expect(p.brand.logo).toBeUndefined()
      expect(p.brand.favicon).toBeUndefined()
      expect(p.auth.requireSignIn).toBeUndefined()
      expect(p.strings).toBeUndefined()
    }
    expect(JSON.stringify(parseSurfaceProfile("{}"))).not.toMatch(/"worlds"|"imports"|"header"|"images"|"offered"|"logo"|"favicon"|"requireSignIn"|"strings"/)
  })
})

describe("worlds — an allowlist where presence narrows", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const worlds = (value: unknown) => parseSurfaceProfile(JSON.stringify({ worlds: value, nav: { hide: ["gallery"] } }))

  it("keeps a valid allowlist, home and order", () => {
    expect(worlds({ allow: ["image", "video", "app"], home: "app", order: ["app", "image"] }).worlds).toEqual({
      allow: ["image", "video", "app"],
      home: "app",
      order: ["app", "image"],
    })
  })

  it("drops unknown ids loudly — and a list whose ids are ALL unknown offers no world, never every world", () => {
    const { calls } = warn()
    expect(worlds({ allow: ["image", "imge"] }).worlds).toEqual({ allow: ["image"] })
    expect(worlds({ allow: ["imge"] }).worlds).toEqual({ allow: [] })
    expect(calls().some((m) => m.includes("worlds.allow") && m.includes("imge"))).toBe(true)
  })

  it("[] offers no world; leaving allow out offers every one", () => {
    expect(worlds({ allow: [] }).worlds).toEqual({ allow: [] })
    expect(worlds({ order: ["voice"] }).worlds).toEqual({ order: ["voice"] })
  })

  it("a malformed allowlist or worlds block fails closed, and never takes a sibling key down", () => {
    const { calls } = warn()
    expect(worlds({ allow: "image" }).worlds).toEqual({ allow: [] })
    expect(worlds("image").worlds).toEqual({ allow: [] })
    expect(worlds(["image"]).worlds).toEqual({ allow: [] })
    expect(worlds("image").nav.hide).toEqual(["gallery"])
    expect(calls().filter((m) => m.includes("[surface-profile] worlds")).length).toBeGreaterThanOrEqual(3)
  })

  it("a home the allowlist does not let through, or an unknown one, is dropped", () => {
    const { calls } = warn()
    expect(worlds({ allow: ["image"], home: "explore" }).worlds).toEqual({ allow: ["image"] })
    expect(worlds({ home: "nowhere" }).worlds).toEqual({})
    expect(calls().filter((m) => m.includes("worlds.home")).length).toBe(2)
  })

  it("order keeps known ids once each", () => {
    warn()
    expect(worlds({ order: ["voice", "bogus", "voice", "image"] }).worlds).toEqual({ order: ["voice", "image"] })
  })
})

describe("imports.links — a safety switch: a present false never flips open", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const links = (imports: unknown) => parseSurfaceProfile(JSON.stringify({ imports, brand: { productName: "Acme" } }))

  it("accepts the boolean and string forms", () => {
    for (const v of [false, "false", "0"]) expect(links({ links: v }).imports, String(v)).toEqual({ links: false })
    for (const v of [true, "true", "1"]) expect(links({ links: v }).imports, String(v)).toEqual({ links: true })
  })

  it("an unparseable value, or a block that is not an object, refuses links — loudly", () => {
    const { calls } = warn()
    expect(links({ links: "no" }).imports).toEqual({ links: false })
    expect(links({ links: 42 }).imports).toEqual({ links: false })
    expect(links("off").imports).toEqual({ links: false })
    expect(calls().filter((m) => m.includes("imports")).length).toBe(3)
    expect(links("off").brand.productName).toBe("Acme")
  })

  it("an empty block configures nothing", () => {
    expect(links({}).imports).toBeUndefined()
  })
})

describe("catalogs.images", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())

  it("keeps a known mode beside the other catalog switches", () => {
    for (const images of ["default", "none", "own"]) {
      expect(parseSurfaceProfile(JSON.stringify({ catalogs: { required: true, factoryPresets: false, images } })).catalogs).toEqual({
        required: true,
        factoryPresets: false,
        images,
      })
    }
  })

  it("an unknown mode shows no pictures, loudly, and leaves the other switches alone", () => {
    const { calls } = warn()
    expect(parseSurfaceProfile(JSON.stringify({ catalogs: { required: false, factoryPresets: true, images: "None" } })).catalogs).toEqual({
      required: false,
      factoryPresets: true,
      images: "none",
    })
    expect(calls().some((m) => m.includes("catalogs.images"))).toBe(true)
  })

  it("a malformed catalogs block fails closed with no pictures", () => {
    expect(parseSurfaceProfile(JSON.stringify({ catalogs: "x" })).catalogs).toEqual({ required: true, factoryPresets: false, images: "none" })
  })
})

describe("locale.offered", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const locale = (value: unknown) => parseSurfaceProfile(JSON.stringify({ locale: value })).locale

  it("keeps known locale ids in their canonical spelling, each once", () => {
    expect(locale({ default: "he", picker: true, offered: ["he", "en", "pt-br", "he"] })).toEqual({ default: "he", picker: true, offered: ["he", "en", "pt-BR"] })
  })

  it("drops unknown ids loudly; nothing usable leaves the key out (every language stays offered)", () => {
    const { calls } = warn()
    expect(locale({ picker: true, offered: ["he", "klingon"] })).toEqual({ picker: true, offered: ["he"] })
    expect(locale({ picker: true, offered: ["klingon"] })).toEqual({ picker: true })
    expect(locale({ picker: true, offered: "he" })).toEqual({ picker: true })
    expect(calls().filter((m) => m.includes("locale.offered")).length).toBe(3)
  })

  it("a default the list does not offer is warned about (readers resolve it); a bad list never takes default or picker down", () => {
    const { calls } = warn()
    expect(locale({ default: "fr", picker: false, offered: ["he", "en"] })).toEqual({ default: "fr", picker: false, offered: ["he", "en"] })
    expect(calls().some((m) => m.includes("locale.default"))).toBe(true)
    expect(locale({ default: "he", picker: false, offered: 42 })).toEqual({ default: "he", picker: false })
  })

  it("picker may be left out beside the other locale keys (it defaults to shown)", () => {
    expect(locale({ default: "he", offered: ["he", "en"] })).toEqual({ default: "he", picker: true, offered: ["he", "en"] })
  })
})

describe("header", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())

  it("keeps the two modes", () => {
    expect(parseSurfaceProfile(JSON.stringify({ header: "white-label" })).header).toBe("white-label")
    expect(parseSurfaceProfile(JSON.stringify({ header: "default" })).header).toBe("default")
  })

  it("any other value set means the deployment wanted its own header: white-label, loudly", () => {
    const { calls } = warn()
    expect(parseSurfaceProfile(JSON.stringify({ header: "whitelabel" })).header).toBe("white-label")
    expect(parseSurfaceProfile(JSON.stringify({ header: true, nav: { hide: ["gallery"] } })).nav.hide).toEqual(["gallery"])
    expect(calls().filter((m) => m.includes("[surface-profile] header")).length).toBe(2)
  })
})

describe("brand.logo — a same-site path or an https URL", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const brand = (logo: unknown) => parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme", wordmark: "Studio", logo } })).brand

  it("keeps a path or an https URL, trimmed", () => {
    expect(brand(" /brand/logo.svg ").logo).toBe("/brand/logo.svg")
    expect(brand("https://media.example.com/logo.svg").logo).toBe("https://media.example.com/logo.svg")
  })

  it.each(["//evil.example/x.svg", "/\\evil.example/x.svg", "http://media.example.com/x.svg", "data:image/png;base64,AAAA", "javascript:alert(1)", "logo.svg", 42])(
    "drops %j alone — the rest of the brand stays",
    (logo) => {
      const { calls } = warn()
      expect(brand(logo)).toEqual({ productName: "Acme", wordmark: "Studio" })
      expect(calls().some((m) => m.includes("brand.logo"))).toBe(true)
    },
  )
})

describe("auth.requireSignIn — explicit, or absent (readers then derive it from SSO-only)", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const auth = (requireSignIn: unknown) =>
    parseSurfaceProfile(JSON.stringify({ auth: { methods: ["email", "sso"], ssoLabel: "Continue", requireSignIn } })).auth

  it("accepts the boolean and string forms; absent stays absent", () => {
    for (const v of [true, "true", "1"]) expect(auth(v).requireSignIn, String(v)).toBe(true)
    for (const v of [false, "false", "0"]) expect(auth(v).requireSignIn, String(v)).toBe(false)
    expect(auth(undefined).requireSignIn).toBeUndefined()
  })

  it("an unparseable value requires sign-in, loudly, and keeps methods and the SSO label", () => {
    const { calls } = warn()
    expect(auth("yes")).toEqual({ methods: ["email", "sso"], ssoLabel: "Continue", requireSignIn: true })
    expect(calls().some((m) => m.includes("auth.requireSignIn"))).toBe(true)
  })
})

describe("the new keys reach /config.js; the server-only billing keys still never do", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  it("renders them resolved", async () => {
    const { renderSurfaceProfileForRuntimeConfig } = await import("../surface-profile-runtime-config.js")
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      worlds: { allow: ["image", "app"], home: "app" },
      imports: { links: "false" },
      catalogs: { required: true, factoryPresets: false, images: "none" },
      locale: { default: "he", picker: true, offered: ["he", "en"] },
      header: "white-label",
      brand: { productName: "Acme", logo: "/brand/logo.svg" },
      auth: { methods: ["sso"], ssoLabel: "Continue", requireSignIn: true },
      billing: { unitLabel: "units", unitRate: 2000, payerAccount: "billing@acme.example" },
    })
    __resetSurfaceProfileCacheForTests()
    const out = JSON.parse(renderSurfaceProfileForRuntimeConfig())
    expect(out.worlds).toEqual({ allow: ["image", "app"], home: "app" })
    expect(out.imports).toEqual({ links: false })
    expect(out.catalogs.images).toBe("none")
    expect(out.locale.offered).toEqual(["he", "en"])
    expect(out.header).toBe("white-label")
    expect(out.brand.logo).toBe("/brand/logo.svg")
    expect(out.auth.requireSignIn).toBe(true)
    expect(out.billing.payerAccount).toBeUndefined()
  })
})

describe("brand.favicon — the page's icons, paths on this site", () => {
  const warn = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map((c) => String(c[0])) }
  }
  afterEach(() => vi.restoreAllMocks())
  const brand = (favicon: unknown) =>
    parseSurfaceProfile(JSON.stringify({ brand: { productName: "Example Studio", description: "Example Studio workflows", favicon } })).brand

  it("takes one path or a list, trimmed, each once", () => {
    expect(brand("/brand/favicon.svg").favicon).toEqual(["/brand/favicon.svg"])
    expect(brand([" /brand/favicon.svg ", "/brand/favicon.png?v=2", "/brand/favicon.svg"]).favicon).toEqual(["/brand/favicon.svg", "/brand/favicon.png?v=2"])
  })

  it.each([
    ["another site", "https://cdn.example.com/favicon.svg"],
    ["a protocol-relative URL", "//evil.example/favicon.svg"],
    ["a relative path", "favicon.svg"],
    ["an attribute breaker", '/brand/x".svg'],
    ["a tag breaker", "/brand/<x>.svg"],
    ["a number", 7],
  ])("drops %s alone, loudly; the rest of the brand stays", (_label, favicon) => {
    const { calls } = warn()
    expect(brand(["/brand/favicon.svg", favicon])).toEqual({ productName: "Example Studio", description: "Example Studio workflows", favicon: ["/brand/favicon.svg"] })
    expect(calls().some((m) => m.includes("brand.favicon dropped"))).toBe(true)
    expect(brand(favicon)).toEqual({ productName: "Example Studio", description: "Example Studio workflows" })
  })

  it("keeps the first four icons", () => {
    const { calls } = warn()
    expect(brand(["/a.svg", "/b.png", "/c.png", "/d.ico", "/e.png"]).favicon).toEqual(["/a.svg", "/b.png", "/c.png", "/d.ico"])
    expect(calls().some((m) => m.includes("first 4 icons"))).toBe(true)
  })
})

describe("strings — carried raw by the server, validated only on the way to /config.js", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
    vi.restoreAllMocks()
  })
  const KEY = "credits.allowanceExceeded"
  const EN_TEXT = "Your Example Studio allowance is used up. Ask your administrator for more."
  const HE_TEXT = "נגמרה לכם המכסה. פנו למנהל המערכת שלכם."
  const FLOW = buildUiStringManifest("flow", en, PLATFORM_LANGUAGES)
  const fromBuild = vi.fn(() => ({ manifest: FLOW }))

  async function render(profile: unknown, readManifest: typeof fromBuild | (() => { problem: string }) = fromBuild): Promise<{ text: string; out: Record<string, unknown> }> {
    const { renderSurfaceProfileForRuntimeConfig } = await import("../surface-profile-runtime-config.js")
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
    const text = renderSurfaceProfileForRuntimeConfig(readManifest)
    return { text, out: JSON.parse(text) as Record<string, unknown> }
  }

  it("the server's own profile keeps strings exactly as given, valid or not (it never reads them)", () => {
    const raw = { flow: { he: { [KEY]: "<b>x</b>" } }, junk: 1 }
    expect(parseSurfaceProfile(JSON.stringify({ strings: raw })).strings).toEqual(raw)
  })

  it("/config.js carries only what validates; every refused entry stays out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { text, out } = await render({
      locale: { default: "he", offered: ["he", "en"] },
      strings: { flow: { he: { [KEY]: HE_TEXT, "no.such.key": "x" }, en: { [KEY]: "<b>Call us</b>" }, ja: { [KEY]: "クレジットがありません。" } } },
    })
    expect(out.strings).toEqual({ flow: { he: { [KEY]: HE_TEXT } } })
    expect(text).not.toMatch(/no\.such\.key|<b>|クレジット/)
  })

  it("a profile whose every override is refused carries no strings key at all", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { out } = await render({ brand: { productName: "Example Studio" }, strings: { flow: { en: { "no.such.key": "x" } } } })
    expect(out).not.toHaveProperty("strings")
    expect(out.brand).toEqual({ productName: "Example Studio" })
  })

  it("INERT: without strings, /config.js is the same single JSON.stringify(profile) as before, and the manifest is never opened", async () => {
    fromBuild.mockClear()
    const { text } = await render({ nav: { hide: ["gallery"] }, brand: { productName: "Example Studio" } })
    expect(text).toBe(JSON.stringify(runtimeSurfaceProfile()))
    expect(text).not.toContain("strings")
    expect(fromBuild).not.toHaveBeenCalled()
  })

  it("a build with no manifest: every override dropped with a warning, every other key intact", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { out } = await render(
      { nav: { hide: ["gallery"] }, brand: { productName: "Example Studio" }, strings: { flow: { en: { [KEY]: EN_TEXT } } } },
      () => ({ problem: "there is no key manifest at /x (a local dev run, or a build that did not emit it)" }),
    )
    expect(out).not.toHaveProperty("strings")
    expect(out.nav).toEqual({ hide: ["gallery"] })
    expect(out.brand).toEqual({ productName: "Example Studio" })
    expect(warn).toHaveBeenCalledWith("[surface-profile] strings.flow: every override dropped — there is no key manifest at /x (a local dev run, or a build that did not emit it), so none can be checked")
  })

  it("a surface that would outgrow one environment variable sheds its strings, never the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { RUNTIME_SURFACE_MAX_BYTES } = await import("../surface-profile-runtime-config.js")
    const { UI_STRINGS_MAX_BYTES } = await import("../surface-strings.js")
    // Two products' worth is impossible today (one product), so fill Flow to its own
    // budget in two locales: each block passes, together they are over the surface limit.
    const plain = Object.entries(FLOW.keys).filter(([, names]) => names.length === 0).map(([key]) => key)
    const perLocale = Math.floor(UI_STRINGS_MAX_BYTES / 2 / 1000)
    const fill = (from: number) => Object.fromEntries(plain.slice(from, from + perLocale).map((key) => [key, "x".repeat(1000)]))
    const blocks = { en: fill(0), he: fill(perLocale) }
    expect(2 * perLocale * 1000).toBeLessThanOrEqual(UI_STRINGS_MAX_BYTES)
    const bigBrand = "y".repeat(RUNTIME_SURFACE_MAX_BYTES - UI_STRINGS_MAX_BYTES / 2)
    const { text, out } = await render({ nav: { hide: ["gallery"] }, brand: { productName: "Example Studio", description: bigBrand }, strings: { flow: blocks } })
    expect(out).not.toHaveProperty("strings")
    expect(out.nav).toEqual({ hide: ["gallery"] })
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(RUNTIME_SURFACE_MAX_BYTES)
    expect(warn.mock.calls.some((c) => /strings dropped — the surface with them is \d+ bytes/.test(String(c[0])))).toBe(true)
  })

  it("rides beside the billing redaction: both apply", async () => {
    const { out } = await render({
      billing: { unitLabel: "units", unitRate: 2000, payerAccount: "billing@example.com" },
      strings: { flow: { en: { [KEY]: EN_TEXT } } },
    })
    expect(out.strings).toEqual({ flow: { en: { [KEY]: EN_TEXT } } })
    expect(out.billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "units", unitRate: 2000 })
    expect(JSON.stringify(out)).not.toContain("billing@example.com")
  })
})
