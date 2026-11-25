// @test-watches tools/build-runtime-config.mjs frontend/src/lib/i18n/en.{ts,js} frontend/src/lib/i18n/platform-languages.{ts,js}
import { describe, it, expect, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { RUNTIME_CONFIG_KEYS, RUNTIME_SURFACE_DEFAULT, buildUiStringManifest, isSameSitePath, parseRuntimeConfig } from "@nodaro/shared/runtime-config"
import { en } from "../../../../frontend/src/lib/i18n/en.js"
import { PLATFORM_LANGUAGES } from "../../../../frontend/src/lib/i18n/platform-languages.js"
import {
  PLATFORM_PRODUCT_NAME,
  brandHeadRequest,
  buildRuntimeConfig,
  isSameSitePath as writerIsSameSitePath,
  // @ts-expect-error — untyped .mjs tooling module (the container's /config.js writer)
} from "../../../../tools/build-runtime-config.mjs"
import { config } from "../config.js"
import { SURFACE_PROFILE_DEFAULT, __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { renderMediaOriginForRuntimeConfig, renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"

/**
 * /config.js is read by products outside this repo through the contract in
 * @nodaro/shared/runtime-config. These hold its two producers to it: the
 * container's writer (tools/build-runtime-config.mjs) emits no key the
 * contract lacks, and the backend's surface projection reaches a reader whole.
 * A key added on one side and forgotten on the other fails here.
 */

const WRITER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tools", "build-runtime-config.mjs")

describe("the /config.js writer and the contract agree on every key", () => {
  it("every RUNTIME_* input the writer reads lands on a contract key, and every contract key can be written", () => {
    const inputs = [...new Set([...readFileSync(WRITER, "utf8").matchAll(/env\.(RUNTIME_[A-Z_]+)/g)].map((m) => m[1]))]
    expect(inputs.length).toBeGreaterThan(0)
    // "true" satisfies every flag and is a non-blank string for every URL; the surface needs a JSON object,
    // and a reader keeps a media origin only when it is one.
    const inputValue = (name: string) => (name === "RUNTIME_SURFACE_PROFILE" ? "{}" : name === "RUNTIME_MEDIA_ORIGIN" ? "https://media.example.com" : name === "RUNTIME_FLOW_UI_ORIGIN" ? "https://flow.example.com" : name === "RUNTIME_LINK_ORIGIN" ? "https://app.example.com" : "true")
    const env = Object.fromEntries(inputs.map((name) => [name, inputValue(name)]))
    const written = Object.keys(buildRuntimeConfig(env) as Record<string, unknown>).sort()
    expect(written).toEqual([...RUNTIME_CONFIG_KEYS].sort())
    // …and a reader keeps each one.
    expect(Object.keys(parseRuntimeConfig(buildRuntimeConfig(env))).sort()).toEqual([...RUNTIME_CONFIG_KEYS].sort())
  })
})

describe("the backend's surface projection reaches a reader whole", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  const REAL_MEDIA_URL = config.R2_PUBLIC_URL
  afterEach(() => {
    config.EDITION = REAL_EDITION
    config.R2_PUBLIC_URL = REAL_MEDIA_URL
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  /** What a reader gets from what this backend renders into /config.js. */
  function readerView(profile: unknown): { rendered: Record<string, unknown>; read: unknown } {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
    const manifest = buildUiStringManifest("flow", en, PLATFORM_LANGUAGES)
    const rendered = JSON.parse(renderSurfaceProfileForRuntimeConfig(() => ({ manifest }))) as Record<string, unknown>
    // The writer passes the printed profile through verbatim (build-runtime-config.test.mjs).
    const read = parseRuntimeConfig(buildRuntimeConfig({ RUNTIME_SURFACE_PROFILE: JSON.stringify(rendered) })).surface
    return { rendered, read }
  }

  it("a profile that sets every key: the reader keeps exactly what was rendered — nothing dropped, nothing added", () => {
    const { rendered, read } = readerView({
      nav: { hide: ["gallery"] },
      features: { hide: ["copilot"] },
      dashboard: { tabs: ["workflows", "projects"] },
      nodes: { deny: ["social-publish"], allow: ["generate-image"] },
      models: { deny: ["veo3"], allow: [] },
      auth: { methods: ["sso"], ssoLabel: "Continue", requireSignIn: true },
      siblings: { apps: [{ label: "Chat", url: "https://chat.example", urlByHost: { "studio.b.example": "https://chat.b.example" } }] },
      brand: { productName: "Acme", description: "Acme studio", wordmark: "Studio", platformLinks: false, logo: "/brand/logo.svg", favicon: ["/brand/favicon.svg", "/brand/favicon.png"] },
      locale: { default: "he", picker: true, offered: ["he", "en"] },
      outputs: { allowPublic: false },
      voice: { allowedGenders: ["male"] },
      billing: {
        costTab: "hidden",
        sidebarCard: "hidden",
        selfServe: false,
        unitLabel: "units",
        unitRate: 2000,
        unitDecimals: 0,
        unitLabels: { en: "units", he: "יחידות" },
        payerAccount: "billing@acme.example",
        defaultAllowanceUnits: 400000,
        allowances: "enforce",
      },
      catalogs: { required: true, factoryPresets: false, images: "none" },
      catalogPolicy: { reviewed: true },
      worlds: { allow: ["image", "video", "app"], home: "app", order: ["app", "image"], soon: ["music"] },
      imports: { links: false },
      header: "white-label",
      toolApps: {
        menus: true,
        pages: true,
        pictures: { "image-upscale": "/brand/apps/upscale.webp", "tile:image:createImage": "https://media.acme.example/create.png" },
        apps: ["image-upscale", "video-captions"],
        examples: {
          "image-upscale": [
            { before: "/brand/examples/room-before.webp", after: "https://media.acme.example/room-after.webp", ask: "make it sharper", title: "A sharper room", text: "One picture in, one out." },
            { before: "/brand/examples/street-before.webp", after: "/brand/examples/street-after.webp" },
          ],
        },
      },
      samples: {
        image: [{ prompt: "a lighthouse at dusk", picture: "/brand/samples/lighthouse.webp", model: "model-a", aspectRatio: "16:9", center: true }],
        video: [
          {
            title: "The harbour",
            prompt: "a harbour at dawn",
            video: "/brand/samples/harbour.mp4",
            picture: "/brand/samples/harbour.webp",
            original: "https://media.acme.example/harbour.mp4",
            model: "model-b",
            duration: 12,
            aspectRatio: "16:9",
            resolution: "720p",
            references: ["/brand/samples/sheet.webp"],
          },
        ],
      },
      strings: { flow: { he: { "credits.allowanceExceeded": "נגמרה לכם המכסה." }, en: { "credits.allowanceExceeded": "Your allowance is used up." } } },
      jobs: { errorDetail: "admin" },
      mcp: { byPath: true, path: "/v1/mcp" },
    })
    expect(rendered.strings).toEqual({ flow: { he: { "credits.allowanceExceeded": "נגמרה לכם המכסה." }, en: { "credits.allowanceExceeded": "Your allowance is used up." } } })
    expect(read).toEqual(rendered)
    // The server-only keys (the payer's billing keys, `jobs`, `mcp`) were stripped before either side saw them.
    expect(JSON.stringify(read)).not.toMatch(/payerAccount|defaultAllowanceUnits|allowances|billing@acme/)
    expect(rendered).not.toHaveProperty("jobs")
    expect(rendered).not.toHaveProperty("mcp")
  })

  it("the media origin the backend prints is what a reader keeps", () => {
    config.EDITION = "cloud"
    config.R2_PUBLIC_URL = "https://media.acme.example/bucket"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ header: "white-label" })
    __resetSurfaceProfileCacheForTests()
    const written = buildRuntimeConfig({ RUNTIME_MEDIA_ORIGIN: renderMediaOriginForRuntimeConfig() })
    expect(parseRuntimeConfig(written).mediaOrigin).toBe("https://media.acme.example")
  })

  it("a profile that sets none of the new keys: the reader adds only their defaults", () => {
    const { rendered, read } = readerView({ auth: { methods: ["sso"], ssoLabel: "Continue" } })
    expect(rendered).not.toHaveProperty("worlds")
    expect(rendered).not.toHaveProperty("imports")
    expect(rendered).not.toHaveProperty("header")
    expect(rendered).not.toHaveProperty("toolApps")
    expect(rendered).not.toHaveProperty("samples")
    expect(rendered).not.toHaveProperty("strings")
    expect(read).toEqual({
      ...rendered,
      auth: { methods: ["sso"], ssoLabel: "Continue", requireSignIn: true },
      catalogs: { ...(rendered.catalogs as object), images: "default" },
      imports: { links: true },
      header: "default",
      worlds: {},
      toolApps: { menus: false, pages: false, pictures: {}, examples: {} },
      samples: { image: [], video: [] },
      strings: {},
    })
  })

  it("an app's own examples: an authored profile's reach a reader as the backend kept them, and a profile with none gives a reader none", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const kept = { before: "/brand/examples/room-before.webp", after: "https://media.acme.example/room-after.webp", ask: "make it sharper", title: "A sharper room", text: "One picture in, one out." }
    const { rendered, read } = readerView({
      header: "white-label",
      toolApps: {
        pages: true,
        examples: {
          "image-upscale": [{ ...kept, before: ` ${kept.before} `, title: `  ${kept.title}  `, note: "a key no reader knows" }, { before: "/brand/examples/alone.webp" }],
          "Bad Id": [kept],
          "video-captions": "none",
        },
      },
    })
    expect(rendered.toolApps).toEqual({ menus: false, pages: true, examples: { "image-upscale": [kept] } })
    expect((read as { toolApps: unknown }).toolApps).toEqual({ menus: false, pages: true, pictures: {}, examples: { "image-upscale": [kept] } })

    // The key is the deployment's to set whatever its header: it reaches a page as `toolApps.pictures` does.
    const plain = readerView({ toolApps: { examples: { "image-upscale": [kept] } } })
    expect(plain.rendered.toolApps).toEqual({ menus: false, pages: false, examples: { "image-upscale": [kept] } })

    const none = readerView({ header: "white-label", toolApps: { pages: true, examples: { "image-upscale": [{ before: "/brand/examples/alone.webp" }] } } })
    expect(none.rendered.toolApps).toEqual({ menus: false, pages: true })
    expect((none.read as { toolApps: unknown }).toolApps).toEqual({ menus: false, pages: true, pictures: {}, examples: {} })

    // Past both limits, with a key that is no app id and an app with no example among them: the reader keeps what was rendered.
    const many = Array.from({ length: 9 }, (_, i) => ({ before: `/brand/examples/${i}-before.webp`, after: `/brand/examples/${i}-after.webp` }))
    const apps = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`app-${i}`, many]))
    const full = readerView({ toolApps: { examples: { "Bad Id": many, "app-none": [], 9: many, ...apps } } })
    const atLimits = (full.rendered.toolApps as { examples: Record<string, unknown[]> }).examples
    expect(Object.keys(atLimits)).toHaveLength(200)
    expect(Object.keys(atLimits).slice(0, 2)).toEqual(["9", "app-0"])
    expect(atLimits["app-0"]).toEqual(many.slice(0, 6))
    expect((full.read as { toolApps: { examples: unknown } }).toolApps.examples).toEqual(atLimits)
    warn.mockRestore()
  })

  it("community: the profile is ignored, so no example reaches a page", () => {
    config.EDITION = "community"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ toolApps: { pages: true, examples: { "image-upscale": [{ before: "/b.webp", after: "/a.webp" }] } } })
    __resetSurfaceProfileCacheForTests()
    expect(renderSurfaceProfileForRuntimeConfig()).toBe("")
    expect(parseRuntimeConfig(buildRuntimeConfig({ RUNTIME_SURFACE_PROFILE: renderSurfaceProfileForRuntimeConfig() }))).not.toHaveProperty("surface")
  })
})

/**
 * The writer also puts the brand into index.html's head at boot. It imports no
 * package (the image copies it alone), so two of its rules are restated there;
 * these hold them to the originals.
 */
describe("the brand head the writer derives from what the backend renders", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  function renderedBrand(profile: unknown): unknown {
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
    const cfg = buildRuntimeConfig({ RUNTIME_SURFACE_PROFILE: renderSurfaceProfileForRuntimeConfig() }) as { surface?: { brand?: unknown } }
    return cfg.surface?.brand
  }

  it("the name it leaves alone is the platform's default product name", () => {
    expect(PLATFORM_PRODUCT_NAME).toBe(RUNTIME_SURFACE_DEFAULT.brand.productName)
    expect(PLATFORM_PRODUCT_NAME).toBe(SURFACE_PROFILE_DEFAULT.brand.productName)
  })

  it("its isSameSitePath is the contract's", () => {
    const cases: unknown[] = [
      "/brand/favicon.svg", "/icon.png?v=2", "/a/b/c.ico#x", "/", "/%2F%2Fevil", "/brand/../favicon.svg",
      "//evil.example/x.svg", "/\\evil.example", "https://x.example/a.svg", "http://x.example/a.svg", "a.svg", "./a.svg",
      '/a".svg', "/a'.svg", "/a<b>.svg", "/a`b`.svg", "/a b.svg", "/a\tb.svg", "/a\u0000b.svg", "/a\u007fb.svg", "", " /a.svg", 7, null, undefined, ["/a.svg"],
    ]
    for (const value of cases) expect(writerIsSameSitePath(value), JSON.stringify(value)).toBe(isSameSitePath(value))
  })

  it("INERT end to end: a profile that sets no brand asks nothing of the head", () => {
    expect(renderedBrand({ nav: { hide: ["gallery"] } })).toEqual({ productName: "Nodaro" })
    expect(brandHeadRequest(renderedBrand({ nav: { hide: ["gallery"] } }))).toBeUndefined()
    expect(brandHeadRequest(renderedBrand({ brand: { productName: "Nodaro" } }))).toBeUndefined()
  })

  it("a brand reaches the head as the backend resolved it — a refused icon never does", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(
      brandHeadRequest(renderedBrand({ brand: { productName: "Example Studio", description: "Workflows by Example Studio", favicon: ["/brand/favicon.svg", "https://cdn.example.com/x.png"] } })),
    ).toEqual({ title: "Example Studio", description: "Workflows by Example Studio", favicon: ["/brand/favicon.svg"] })
    warn.mockRestore()
  })
})
