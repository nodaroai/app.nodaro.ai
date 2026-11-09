import { describe, it, expect, afterEach } from "vitest"
import {
  surfaceNavHidden,
  surfaceTemplatesVisible,
  surfacePlatformLinks,
  surfaceTabs,
  surfaceSiblings,
  surfaceBrandName,
  surfaceAuthMethods,
  surfaceOutputsAllowPublic,
  surfaceLocalePicker,
} from "../surface-selectors"

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("surface selectors — empty means inherit, non-empty means narrow", () => {
  it("nav: default hides nothing; profile hides the named key only", () => {
    expect(surfaceNavHidden("gallery")).toBe(false)
    window.__NODARO_RUNTIME__ = { surface: { nav: { hide: ["gallery"] } } }
    expect(surfaceNavHidden("gallery")).toBe(true)
    expect(surfaceNavHidden("pricing")).toBe(false)
  })

  it("tabs: empty profile → code default; non-empty → the whitelist in its order", () => {
    expect(surfaceTabs(["workflows", "projects"])).toEqual(["workflows", "projects"])
    window.__NODARO_RUNTIME__ = { surface: { dashboard: { tabs: ["workflows"] } } }
    expect(surfaceTabs(["workflows", "projects"])).toEqual(["workflows"])
  })

  it("siblings: empty → code default; non-empty → replacement", () => {
    const dflt = [{ label: "Studio", url: "https://studio.nodaro.ai" }]
    expect(surfaceSiblings(dflt)).toEqual(dflt)
    window.__NODARO_RUNTIME__ = { surface: { siblings: { apps: [{ label: "Acme", url: "https://acme.example" }] } } }
    expect(surfaceSiblings(dflt)).toEqual([{ label: "Acme", url: "https://acme.example" }])
  })

  it("brand / outputs / auth / picker read through", () => {
    expect(surfaceBrandName()).toBe("Nodaro")
    expect(surfaceOutputsAllowPublic()).toBe(true)
    expect(surfaceLocalePicker()).toBe(true)
    expect(surfaceAuthMethods(["email", "google"])).toEqual(["email", "google"])
    window.__NODARO_RUNTIME__ = {
      surface: {
        brand: { productName: "Acme" },
        outputs: { allowPublic: false },
        // N3: "sso" is NOT in the code default and no longer widens through; the
        // login page renders no SSO button, so an empty intersection falls back
        // to the code default (S4) rather than stranding login with no method.
        auth: { methods: ["sso"], ssoLabel: "IdP" },
      },
    }
    expect(surfaceBrandName()).toBe("Acme")
    expect(surfaceOutputsAllowPublic()).toBe(false)
    expect(surfaceAuthMethods(["email", "google"])).toEqual(["email", "google"])
  })

  it("auth: narrows to the intersection when it is non-empty", () => {
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["google"] } } }
    expect(surfaceAuthMethods(["email", "google"])).toEqual(["google"])
  })

  it("auth (S4): an EMPTY intersection falls back to the code default, never []", () => {
    // cloud default is ["google"]; a profile asking for ["email"] intersects to
    // nothing — the login page must not be left with zero auth methods.
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["email"] } } }
    expect(surfaceAuthMethods(["google"])).toEqual(["google"])
  })

  it("auth (N3): a method absent from the code default is dropped, not widened", () => {
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["email", "sso"], ssoLabel: "IdP" } } }
    expect(surfaceAuthMethods(["email", "google"])).toEqual(["email"])
  })
})

import {
  surfaceCreditUnitLabel,
  surfaceCreditUnitRate,
  surfaceCreditUnitDecimals,
  surfaceCreditsToUnits,
  surfaceBillingSelfServe,
  surfaceCostTabHidden,
  surfaceSidebarCreditCardHidden,
  surfaceBrandWordmark,
} from "../surface-selectors"

describe("billing display-unit selectors (Phase B) — mainline literals by default", () => {
  it("unconfigured: label \"CR\", rate 1, 0 decimals, self-serve on, cost tab inherited — conversion is identity", () => {
    expect(surfaceCreditUnitLabel()).toBe("CR")
    expect(surfaceCreditUnitRate()).toBe(1)
    expect(surfaceCreditUnitDecimals()).toBe(0)
    expect(surfaceBillingSelfServe()).toBe(true)
    expect(surfaceCostTabHidden()).toBe(false)
    for (const n of [0, 1, 12, 500, 123456]) expect(surfaceCreditsToUnits(n)).toBe(n)
  })

  it("configured: relabels and converts, rounding once at the configured decimals", () => {
    window.__NODARO_RUNTIME__ = {
      surface: { billing: { costTab: "hidden", sidebarCard: "inherit", selfServe: false, unitLabel: "קרדיטים", unitRate: 2000 } },
    }
    expect(surfaceCreditUnitLabel()).toBe("קרדיטים")
    expect(surfaceCreditUnitRate()).toBe(2000)
    expect(surfaceCreditsToUnits(12)).toBe(24000)
    expect(surfaceCreditsToUnits(0)).toBe(0)
    expect(surfaceBillingSelfServe()).toBe(false)
    expect(surfaceCostTabHidden()).toBe(true)

    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "u", unitRate: 0.5, unitDecimals: 1 } } }
    expect(surfaceCreditUnitDecimals()).toBe(1)
    expect(surfaceCreditsToUnits(3)).toBe(1.5)
    expect(surfaceCreditsToUnits(1)).toBe(0.5)
  })

  it("null / undefined / non-finite never become a number (§5.2 rule 1)", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "u", unitRate: 2000 } } }
    expect(surfaceCreditsToUnits(null)).toBeNull()
    expect(surfaceCreditsToUnits(undefined)).toBeNull()
    expect(surfaceCreditsToUnits(Number.NaN)).toBeNull()
    expect(surfaceCreditsToUnits(Number.POSITIVE_INFINITY)).toBeNull()
    delete window.__NODARO_RUNTIME__
    expect(surfaceCreditsToUnits(null)).toBeNull()
  })

  it("sidebar credit card: hidden only when the profile says \"hidden\"", () => {
    expect(surfaceSidebarCreditCardHidden()).toBe(false)
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "hidden", selfServe: false } } }
    expect(surfaceSidebarCreditCardHidden()).toBe(true)
  })
})

describe("brand wordmark — tile+text lockup opt-in", () => {
  it("undefined when unconfigured or blank; the trimmed text when set", () => {
    expect(surfaceBrandWordmark()).toBeUndefined()
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme Studio", wordmark: "  Studio  " } } }
    expect(surfaceBrandWordmark()).toBe("Studio")
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme Studio", wordmark: "   " } } }
    expect(surfaceBrandWordmark()).toBeUndefined()
  })
})


describe("deployment discovery gates", () => {
  it("defaults to platform links and templates, and honors both ways to hide templates", () => {
    expect(surfacePlatformLinks()).toBe(true)
    expect(surfaceTemplatesVisible()).toBe(true)
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme", platformLinks: false }, nav: { hide: ["templates"] } } }
    expect(surfacePlatformLinks()).toBe(false)
    expect(surfaceTemplatesVisible()).toBe(false)
    window.__NODARO_RUNTIME__ = { surface: { dashboard: { tabs: ["tutorials"] } } }
    expect(surfaceTemplatesVisible()).toBe(false)
  })
})

describe("the keys the client apps read — absent means today's behaviour", () => {
  it("an unconfigured deployment reads every default", async () => {
    const s = await import("../surface-selectors")
    expect(s.surfaceRequireSignIn()).toBe(false)
    expect(s.surfaceLinkImportsAllowed()).toBe(true)
    expect(s.surfaceCatalogImages()).toBe("default")
    expect(s.surfaceLocaleOffered()).toBeUndefined()
    expect(s.surfaceHeaderMode()).toBe("default")
    expect(s.surfaceBrandLogo()).toBeUndefined()
    expect(s.surfaceWorldAllowed("explore")).toBe(true)
  })

  it("a configured deployment reads its values", async () => {
    const s = await import("../surface-selectors")
    window.__NODARO_RUNTIME__ = {
      surface: {
        imports: { links: false },
        catalogs: { required: true, factoryPresets: false, images: "none" },
        locale: { default: "he", picker: true, offered: ["he", "en"] },
        header: "white-label",
        brand: { productName: "Acme", logo: "/brand/logo.svg" },
        worlds: { allow: ["image"] },
      },
    }
    expect(s.surfaceLinkImportsAllowed()).toBe(false)
    expect(s.surfaceCatalogImages()).toBe("none")
    expect(s.surfaceLocaleOffered()).toEqual(["he", "en"])
    expect(s.surfaceHeaderMode()).toBe("white-label")
    expect(s.surfaceBrandLogo()).toBe("/brand/logo.svg")
    expect(s.surfaceWorldAllowed("image")).toBe(true)
    expect(s.surfaceWorldAllowed("explore")).toBe(false)
  })

  it("requireSignIn: explicit wins; absent, it follows SSO-only sign-in", async () => {
    const s = await import("../surface-selectors")
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["sso"], ssoLabel: "Continue" } } }
    expect(s.surfaceRequireSignIn()).toBe(true)
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["email", "sso"], ssoLabel: "Continue" } } }
    expect(s.surfaceRequireSignIn()).toBe(false)
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["sso"], ssoLabel: "Continue", requireSignIn: false } } }
    expect(s.surfaceRequireSignIn()).toBe(false)
    window.__NODARO_RUNTIME__ = { surface: { auth: { methods: ["email"], requireSignIn: true } } }
    expect(s.surfaceRequireSignIn()).toBe(true)
  })

  it("worlds: an allowlist that is present but empty offers none", async () => {
    const s = await import("../surface-selectors")
    window.__NODARO_RUNTIME__ = { surface: { worlds: { allow: [] } } }
    expect(s.surfaceWorldAllowed("app")).toBe(false)
  })
})
