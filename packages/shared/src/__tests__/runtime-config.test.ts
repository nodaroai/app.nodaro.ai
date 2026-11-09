import { describe, expect, it } from "vitest"
import {
  RUNTIME_CONFIG_GLOBAL,
  RUNTIME_SURFACE_DEFAULT,
  UI_STRING_PRODUCTS,
  WORLD_IDS,
  buildUiStringManifest,
  uiStringManifestFile,
  uiStringPlaceholders,
  WORLD_REQUIRED_NODE_TYPES,
  isBrandLogoRef,
  isSameSitePath,
  isHttpsOrigin,
  isSsoOnly,
  isWorldId,
  orderWorlds,
  parseRuntimeConfig,
  parseRuntimeStrings,
  parseRuntimeSurface,
  readRuntimeConfig,
  resolveRuntimeApiBase,
  resolveRuntimeSupabaseUrl,
  surfaceRequiresSignIn,
  surfaceStringOverride,
  surfaceUnitLabel,
  worldAllowed,
} from "../entries/runtime-config.js"

describe("worlds", () => {
  it("lists every world once, in the shared header's display order", () => {
    expect([...WORLD_IDS]).toEqual(["explore", "image", "video", "music", "trends", "motion", "voice", "app", "studio"])
    expect(Object.keys(WORLD_REQUIRED_NODE_TYPES).sort()).toEqual([...WORLD_IDS].sort())
    expect(isWorldId("image")).toBe(true)
    expect(isWorldId("ads")).toBe(false)
    expect(isWorldId(undefined)).toBe(false)
  })

  it("names the node types each world runs", () => {
    expect(WORLD_REQUIRED_NODE_TYPES).toEqual({
      explore: [],
      image: ["generate-image"],
      video: ["generate-video", "text-to-video"],
      music: ["suno-generate"],
      trends: ["cast-swap"],
      motion: ["cast-swap"],
      voice: ["voice-changer-pro"],
      app: [],
      studio: [],
    })
    expect(Object.isFrozen(WORLD_REQUIRED_NODE_TYPES)).toBe(true)
    expect(Object.isFrozen(WORLD_REQUIRED_NODE_TYPES.video)).toBe(true)
  })

  it("an absent allowlist lets every world through; a present one exactly its members — [] none", () => {
    expect(worldAllowed(undefined, "explore")).toBe(true)
    expect(worldAllowed({}, "explore")).toBe(true)
    expect(worldAllowed({ allow: ["image"] }, "image")).toBe(true)
    expect(worldAllowed({ allow: ["image"] }, "explore")).toBe(false)
    expect(worldAllowed({ allow: [] }, "image")).toBe(false)
  })

  it("orders the deployment's choice first, then the rest canonically, each world once", () => {
    expect(orderWorlds(undefined)).toEqual([...WORLD_IDS])
    expect(orderWorlds(["voice", "image", "voice", "bogus"])).toEqual(["voice", "image", "explore", "video", "music", "trends", "motion", "app", "studio"])
  })
})

describe("sign-in rules", () => {
  it("SSO-only means SSO is the one method offered", () => {
    expect(isSsoOnly(["sso"])).toBe(true)
    expect(isSsoOnly(["sso", "email"])).toBe(false)
    expect(isSsoOnly([])).toBe(false)
  })

  it("an explicit requireSignIn wins; absent, it follows SSO-only", () => {
    expect(surfaceRequiresSignIn({ methods: ["sso"] })).toBe(true)
    expect(surfaceRequiresSignIn({ methods: ["email", "sso"] })).toBe(false)
    expect(surfaceRequiresSignIn({ methods: ["sso"], requireSignIn: false })).toBe(false)
    expect(surfaceRequiresSignIn({ methods: [], requireSignIn: true })).toBe(true)
    expect(surfaceRequiresSignIn(undefined)).toBe(false)
  })
})

describe("isBrandLogoRef — a path on the page's own site, or an https URL", () => {
  it.each(["/brand/logo.svg", "/logo.png?v=2", "https://media.example.com/logo.svg"])("accepts %s", (ref) => {
    expect(isBrandLogoRef(ref)).toBe(true)
  })

  it.each([
    "//evil.example/logo.svg",
    "/\\evil.example/logo.svg",
    "http://media.example.com/logo.svg",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "javascript:alert(1)",
    "logo.svg",
    "https://user:pass@media.example.com/logo.svg",
    " /logo.svg",
    "/logo .svg",
    "",
    42,
    undefined,
  ])("refuses %j", (ref) => {
    expect(isBrandLogoRef(ref)).toBe(false)
  })
})

describe("isHttpsOrigin — an https origin, spelled exactly as a browser spells one", () => {
  it.each(["https://media.example.com", "https://media.example.com:8443", "https://xn--mnchen-3ya.example"])("accepts %s", (value) => {
    expect(isHttpsOrigin(value)).toBe(true)
  })

  it.each([
    "http://media.example.com",
    "https://media.example.com/",
    "https://media.example.com/bucket",
    "https://media.example.com?x=1",
    "https://media.example.com#x",
    "https://user:pass@media.example.com",
    "https://MEDIA.example.com",
    "https://media.example.com:443",
    " https://media.example.com",
    "https://media.example.com ",
    "//media.example.com",
    "media.example.com",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "",
    42,
    null,
    undefined,
  ])("refuses %j", (value) => {
    expect(isHttpsOrigin(value)).toBe(false)
  })
})

describe("the same-origin sentinels never become an absolute URL", () => {
  it('apiUrl "/" resolves to relative (""); absent to undefined; anything else verbatim', () => {
    expect(resolveRuntimeApiBase({ apiUrl: "/" })).toBe("")
    expect(resolveRuntimeApiBase({ apiUrl: "  /  " })).toBe("")
    expect(resolveRuntimeApiBase({})).toBeUndefined()
    expect(resolveRuntimeApiBase({ apiUrl: "   " })).toBeUndefined()
    expect(resolveRuntimeApiBase(undefined)).toBeUndefined()
    expect(resolveRuntimeApiBase({ apiUrl: "https://api.example.com" })).toBe("https://api.example.com")
    expect(resolveRuntimeApiBase({ apiUrl: "/api" })).toBe("/api")
  })

  it('supabaseUrl "/supabase" resolves against the page origin it is given', () => {
    expect(resolveRuntimeSupabaseUrl({ supabaseUrl: "/supabase" }, "https://studio.example.com")).toBe("https://studio.example.com/supabase")
    expect(resolveRuntimeSupabaseUrl({ supabaseUrl: "/supabase" }, "https://studio.example.com/")).toBe("https://studio.example.com/supabase")
    expect(resolveRuntimeSupabaseUrl({ supabaseUrl: "https://x.supabase.co" }, "https://studio.example.com")).toBe("https://x.supabase.co")
    expect(resolveRuntimeSupabaseUrl({}, "https://studio.example.com")).toBeUndefined()
  })
})

describe("parseRuntimeConfig — typed, lenient, never throws", () => {
  it("keeps each top-level key only with its expected type", () => {
    expect(
      parseRuntimeConfig({
        apiUrl: "/",
        supabaseUrl: " /supabase ",
        supabaseAnonKey: "anon",
        defaultLocale: "",
        freecutUrl: 7,
        moderation: { uploadImage: true },
        previewStopRule: "true",
        unknownKey: "x",
      }),
    ).toEqual({ apiUrl: "/", supabaseUrl: "/supabase", supabaseAnonKey: "anon", moderation: { uploadImage: true } })
  })

  it.each([undefined, null, "x", 42, [1, 2]])("anything but an object is an empty config (%j)", (raw) => {
    expect(() => parseRuntimeConfig(raw)).not.toThrow()
    expect(parseRuntimeConfig(raw)).toEqual({})
  })

  it("keeps mediaOrigin only when it is an https origin", () => {
    expect(parseRuntimeConfig({ apiUrl: "/", mediaOrigin: "https://media.example.com" })).toEqual({ apiUrl: "/", mediaOrigin: "https://media.example.com" })
    for (const malformed of ["http://media.example.com", "https://media.example.com/", "https://media.example.com/bucket", "media.example.com", "", "  ", 7, null, ["https://media.example.com"]]) {
      expect(parseRuntimeConfig({ apiUrl: "/", mediaOrigin: malformed })).toEqual({ apiUrl: "/" })
    }
  })

  it("no mediaOrigin key ⇒ no mediaOrigin (a deployment that is not white-label)", () => {
    expect("mediaOrigin" in parseRuntimeConfig({ apiUrl: "/" })).toBe(false)
    expect("mediaOrigin" in parseRuntimeConfig({})).toBe(false)
  })

  it("no surface key ⇒ no surface (the deployment configured none)", () => {
    expect("surface" in parseRuntimeConfig({ apiUrl: "/" })).toBe(false)
    expect(parseRuntimeConfig({ surface: "x" }).surface).toBeUndefined()
  })

  it("readRuntimeConfig reads the global /config.js sets", () => {
    expect(readRuntimeConfig({ [RUNTIME_CONFIG_GLOBAL]: { apiUrl: "/" } })).toEqual({ apiUrl: "/" })
    expect(readRuntimeConfig({})).toEqual({})
    expect(readRuntimeConfig(undefined)).toEqual({})
  })
})

describe("parseRuntimeSurface — every default applied", () => {
  it("the stock surface: nothing narrowed, the new keys at their defaults", () => {
    expect(RUNTIME_SURFACE_DEFAULT).toEqual({
      nav: { hide: [] },
      features: { hide: [] },
      dashboard: { tabs: [] },
      nodes: { deny: [], allow: [] },
      models: { deny: [], allow: [] },
      auth: { methods: [], requireSignIn: false },
      siblings: { apps: [] },
      brand: { productName: "Nodaro" },
      locale: { picker: true },
      outputs: { allowPublic: true },
      voice: { allowedGenders: [] },
      billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true },
      catalogs: { required: false, factoryPresets: true, images: "default" },
      imports: { links: true },
      header: "default",
      worlds: {},
      strings: {},
    })
    expect(Object.isFrozen(RUNTIME_SURFACE_DEFAULT.auth)).toBe(true)
  })

  it("keeps a deployment's values, and derives requireSignIn from SSO-only when it is absent", () => {
    const s = parseRuntimeSurface({
      auth: { methods: ["sso"], ssoLabel: "Continue" },
      brand: { productName: "Acme", platformLinks: false, logo: "/brand/logo.svg" },
      locale: { default: "he", picker: true, offered: ["he", "en"] },
      catalogs: { required: true, factoryPresets: false, images: "own" },
      imports: { links: false },
      header: "white-label",
      worlds: { allow: ["image", "app"], home: "app", order: ["app", "image"] },
    })
    expect(s.auth).toEqual({ methods: ["sso"], ssoLabel: "Continue", requireSignIn: true })
    expect(s.brand).toEqual({ productName: "Acme", platformLinks: false, logo: "/brand/logo.svg" })
    expect(s.locale).toEqual({ default: "he", picker: true, offered: ["he", "en"] })
    expect(s.catalogs).toEqual({ required: true, factoryPresets: false, images: "own" })
    expect(s.imports).toEqual({ links: false })
    expect(s.header).toBe("white-label")
    expect(s.worlds).toEqual({ allow: ["image", "app"], home: "app", order: ["app", "image"] })
  })

  it("never carries the server-only billing keys, even if they were sent", () => {
    const s = parseRuntimeSurface({
      billing: { unitLabel: "units", unitRate: 2000, selfServe: false, payerAccount: "billing@acme.example", defaultAllowanceUnits: 400000, allowances: "enforce" },
    })
    expect(s.billing).toEqual({ costTab: "inherit", sidebarCard: "inherit", selfServe: false, unitLabel: "units", unitRate: 2000 })
    expect(JSON.stringify(s)).not.toMatch(/payerAccount|defaultAllowanceUnits|allowances|billing@acme/)
  })

  it("the unit label and rate come both or neither", () => {
    expect(parseRuntimeSurface({ billing: { unitLabel: "units" } }).billing.unitLabel).toBeUndefined()
    expect(parseRuntimeSurface({ billing: { unitRate: 2000 } }).billing.unitRate).toBeUndefined()
  })

  it("the unit's per-language words ride beside a coherent unit, are dropped without one, and keep text only", () => {
    const unit = { unitLabel: "units", unitRate: 2000 }
    const words = { en: "units", he: "יחידות", "pt-BR": "unidades" }
    expect(parseRuntimeSurface({ billing: { ...unit, unitLabels: words } }).billing.unitLabels).toEqual(words)
    // Nothing to stand beside: a word without a coherent label and rate is no unit.
    expect(parseRuntimeSurface({ billing: { unitLabels: words } }).billing).toEqual(RUNTIME_SURFACE_DEFAULT.billing)
    expect(parseRuntimeSurface({ billing: { unitLabel: "units", unitLabels: words } }).billing).not.toHaveProperty("unitLabels")
    // Only text survives; nothing left, no key. Built from entries: a "__proto__" key stays an ordinary key.
    expect(parseRuntimeSurface({ billing: { ...unit, unitLabels: { en: "units", he: 7, ja: "" } } }).billing.unitLabels).toEqual({ en: "units" })
    expect(parseRuntimeSurface({ billing: { ...unit, unitLabels: "units" } }).billing).not.toHaveProperty("unitLabels")
    const parsed = parseRuntimeSurface({ billing: { ...unit, unitLabels: JSON.parse('{"__proto__": "x", "he": "יחידות"}') } }).billing.unitLabels
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["__proto__", "he"])
  })

  it("surfaceUnitLabel: the viewer's word, else the single label", () => {
    const words = { en: "units", he: "יחידות" }
    expect(surfaceUnitLabel(words, "he", "single")).toBe("יחידות")
    expect(surfaceUnitLabel(words, "ja", "single")).toBe("single")
    expect(surfaceUnitLabel(undefined, "he", "single")).toBe("single")
    expect(surfaceUnitLabel(words, undefined, "single")).toBe("single")
    // Not fooled by an inherited key or a blank word.
    expect(surfaceUnitLabel(words, "__proto__", "single")).toBe("single")
    expect(surfaceUnitLabel(words, "constructor", "single")).toBe("single")
    expect(surfaceUnitLabel({ he: "" }, "he", "single")).toBe("single")
  })

  it("a value it does not know falls to the restrictive side, never to more", () => {
    // A reader older than its platform must not show what a newer value hides.
    expect(parseRuntimeSurface({ catalogs: { images: "reviewed" } }).catalogs.images).toBe("none")
    expect(parseRuntimeSurface({ imports: { links: "no" } }).imports.links).toBe(false)
    expect(parseRuntimeSurface({ imports: "off" }).imports.links).toBe(false)
    expect(parseRuntimeSurface({ header: "minimal" }).header).toBe("white-label")
    expect(parseRuntimeSurface({ worlds: "image" }).worlds).toEqual({ allow: [] })
    expect(parseRuntimeSurface({ worlds: { allow: "image" } }).worlds).toEqual({ allow: [] })
  })

  it("a home the allowlist does not let through is dropped; unknown order ids too", () => {
    expect(parseRuntimeSurface({ worlds: { allow: ["image"], home: "explore" } }).worlds).toEqual({ allow: ["image"] })
    expect(parseRuntimeSurface({ worlds: { home: "nowhere", order: ["bogus"] } }).worlds).toEqual({})
  })

  it("an unsafe logo is dropped and the rest of the brand stays", () => {
    expect(parseRuntimeSurface({ brand: { productName: "Acme", logo: "//evil.example/x.svg" } }).brand).toEqual({ productName: "Acme" })
  })

  it("is idempotent: parsing what it returned changes nothing", () => {
    const once = parseRuntimeSurface({ auth: { methods: ["sso"] }, worlds: { allow: ["image"] }, catalogPolicy: { a: 1 } })
    expect(parseRuntimeSurface(once)).toEqual(once)
  })
})

describe("isSameSitePath — a brand.favicon entry", () => {
  it.each(["/brand/favicon.svg", "/icon.png?v=2", "/favicon.ico"])("accepts %s", (path) => {
    expect(isSameSitePath(path)).toBe(true)
  })

  it.each([
    "https://media.example.com/favicon.svg",
    "//evil.example/favicon.svg",
    "/\\evil.example/favicon.svg",
    "favicon.svg",
    '/brand/"onload="x.svg',
    "/brand/<x>.svg",
    "/brand/'x'.svg",
    "/brand/`x`.svg",
    "/brand/fav icon.svg",
    "",
    7,
    undefined,
  ])("refuses %j", (path) => {
    expect(isSameSitePath(path)).toBe(false)
  })

  it("the brand keeps its same-site icons, each once, and drops the rest", () => {
    expect(parseRuntimeSurface({ brand: { productName: "Example Studio", favicon: ["/brand/a.svg", "https://x.example/b.png", "/brand/a.svg"] } }).brand).toEqual({
      productName: "Example Studio",
      favicon: ["/brand/a.svg"],
    })
    expect(parseRuntimeSurface({ brand: { productName: "Example Studio", favicon: "/brand/a.svg" } }).brand.favicon).toEqual(["/brand/a.svg"])
    expect(parseRuntimeSurface({ brand: { productName: "Example Studio", favicon: ["//x.example/a.svg"] } }).brand).toEqual({ productName: "Example Studio" })
  })
})

describe("UI-string overrides — surface.strings", () => {
  it("names the products that read their own namespace", () => {
    expect([...UI_STRING_PRODUCTS]).toEqual(["flow", "tools", "voice"])
    expect(Object.isFrozen(UI_STRING_PRODUCTS)).toBe(true)
  })

  it("keeps text only, and leaves out a level the parse empties", () => {
    expect(
      parseRuntimeStrings({
        flow: { he: { "credits.allowanceExceeded": "טקסט", "common.cancel": 7 }, en: { "common.cancel": null }, ja: "x" },
        tools: "x",
        voice: {},
      }),
    ).toEqual({ flow: { he: { "credits.allowanceExceeded": "טקסט" } } })
    expect(parseRuntimeStrings(undefined)).toEqual({})
    expect(parseRuntimeStrings([1])).toEqual({})
  })

  it("a __proto__ key stays an ordinary key and changes no prototype", () => {
    const parsed = parseRuntimeStrings(JSON.parse('{"flow":{"__proto__":{"common.cancel":"x"},"en":{"__proto__":"y"}}}'))
    expect(Object.getPrototypeOf(parsed.flow)).toBe(Object.prototype)
    expect(Object.keys(parsed.flow)).toEqual(["__proto__", "en"])
    expect(surfaceStringOverride(parsed, "flow", "en", "__proto__")).toBe("y")
  })

  it("reads one override, and nothing an object inherits", () => {
    const strings = parseRuntimeStrings({ flow: { he: { "credits.allowanceExceeded": "טקסט" } } })
    expect(surfaceStringOverride(strings, "flow", "he", "credits.allowanceExceeded")).toBe("טקסט")
    expect(surfaceStringOverride(strings, "flow", "en", "credits.allowanceExceeded")).toBeUndefined()
    expect(surfaceStringOverride(strings, "flow", "he", "toString")).toBeUndefined()
    expect(surfaceStringOverride(strings, "voice", "he", "credits.allowanceExceeded")).toBeUndefined()
    expect(surfaceStringOverride(undefined, "flow", "he", "credits.allowanceExceeded")).toBeUndefined()
  })

  it("rides parseRuntimeSurface, and a surface that sets none has none", () => {
    expect(parseRuntimeSurface({ strings: { flow: { en: { "common.cancel": "Back out" } } } }).strings).toEqual({ flow: { en: { "common.cancel": "Back out" } } })
    expect(parseRuntimeSurface({ nav: { hide: ["gallery"] } }).strings).toEqual({})
  })
})

describe("the UI-string key manifest", () => {
  it("names one file per product", () => {
    expect(uiStringManifestFile("flow")).toBe("ui-strings-manifest.flow.json")
    expect(uiStringManifestFile("tools")).toBe("ui-strings-manifest.tools.json")
    expect(uiStringManifestFile("voice")).toBe("ui-strings-manifest.voice.json")
  })

  it("reads {name} placeholders only, each once, sorted", () => {
    expect(uiStringPlaceholders("{b} and {a} and {b}")).toEqual(["a", "b"])
    expect(uiStringPlaceholders("no placeholders")).toEqual([])
    expect(uiStringPlaceholders("{image:1} and { spaced } stay text")).toEqual([])
    expect(uiStringPlaceholders("{{now}}")).toEqual(["now"])
  })

  it("keeps every key with visible text and its placeholders, and no text", () => {
    const manifest = buildUiStringManifest("flow", { "a.plain": "Plain", "a.one": "{n} left of {max}", "a.gender": "", "a.gap": " " }, ["en", "he"])
    expect(manifest).toEqual({ product: "flow", locales: ["en", "he"], keys: { "a.plain": [], "a.one": ["max", "n"] } })
    expect(JSON.stringify(manifest)).not.toContain("left of")
  })
})
