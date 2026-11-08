// @test-watches tools/build-runtime-config.mjs
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { RUNTIME_CONFIG_KEYS, parseRuntimeConfig } from "@nodaro/shared/runtime-config"
// @ts-expect-error — untyped .mjs tooling module (the container's /config.js writer)
import { buildRuntimeConfig } from "../../../../tools/build-runtime-config.mjs"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"

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
    // "true" satisfies every flag and is a non-blank string for every URL; the surface needs a JSON object.
    const env = Object.fromEntries(inputs.map((name) => [name, name === "RUNTIME_SURFACE_PROFILE" ? "{}" : "true"]))
    const written = Object.keys(buildRuntimeConfig(env) as Record<string, unknown>).sort()
    expect(written).toEqual([...RUNTIME_CONFIG_KEYS].sort())
    // …and a reader keeps each one.
    expect(Object.keys(parseRuntimeConfig(buildRuntimeConfig(env))).sort()).toEqual([...RUNTIME_CONFIG_KEYS].sort())
  })
})

describe("the backend's surface projection reaches a reader whole", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  /** What a reader gets from what this backend renders into /config.js. */
  function readerView(profile: unknown): { rendered: Record<string, unknown>; read: unknown } {
    config.EDITION = "cloud"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
    const rendered = JSON.parse(renderSurfaceProfileForRuntimeConfig()) as Record<string, unknown>
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
      brand: { productName: "Acme", description: "Acme studio", wordmark: "Studio", platformLinks: false, logo: "/brand/logo.svg" },
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
        payerAccount: "billing@acme.example",
        defaultAllowanceUnits: 400000,
        allowances: "enforce",
      },
      catalogs: { required: true, factoryPresets: false, images: "none" },
      catalogPolicy: { reviewed: true },
      worlds: { allow: ["image", "video", "app"], home: "app", order: ["app", "image"] },
      imports: { links: false },
      header: "white-label",
    })
    expect(read).toEqual(rendered)
    // The server-only billing keys were stripped before either side saw them.
    expect(JSON.stringify(read)).not.toMatch(/payerAccount|defaultAllowanceUnits|allowances|billing@acme/)
  })

  it("a profile that sets none of the new keys: the reader adds only their defaults", () => {
    const { rendered, read } = readerView({ auth: { methods: ["sso"], ssoLabel: "Continue" } })
    expect(rendered).not.toHaveProperty("worlds")
    expect(rendered).not.toHaveProperty("imports")
    expect(rendered).not.toHaveProperty("header")
    expect(read).toEqual({
      ...rendered,
      auth: { methods: ["sso"], ssoLabel: "Continue", requireSignIn: true },
      catalogs: { ...(rendered.catalogs as object), images: "default" },
      imports: { links: true },
      header: "default",
      worlds: {},
    })
  })
})
