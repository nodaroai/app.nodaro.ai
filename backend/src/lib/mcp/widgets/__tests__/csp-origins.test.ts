import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * WIDGET_MEDIA_ORIGINS is derived from the deployment's media config so
 * self-hosted media renders inline in MCP widgets. Invariants locked here:
 * the Nodaro Cloud defaults always survive (unset env = Cloud behavior),
 * configured hosts are appended as clean origins (path stripped, bare hosts
 * get https://), and duplicates/garbage never widen or corrupt the list.
 */

const ENV_KEYS = ["R2_PUBLIC_URL", "R2_PUBLIC_FALLBACK_DOMAIN"] as const
const ORIGINAL: Record<string, string | undefined> = {}

const CLOUD_DEFAULTS = [
  "https://cdn.nodaro.ai",
  "https://assets.nodaro.ai",
  "https://*.r2.cloudflarestorage.com",
]

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k]
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL[k]
  }
})

describe("WIDGET_MEDIA_ORIGINS", () => {
  it("keeps exactly the Cloud defaults when media env is unset", async () => {
    delete process.env.R2_PUBLIC_URL
    delete process.env.R2_PUBLIC_FALLBACK_DOMAIN
    const { WIDGET_MEDIA_ORIGINS } = await import("../csp-origins.js")
    expect(WIDGET_MEDIA_ORIGINS).toEqual(CLOUD_DEFAULTS)
  })

  it("appends the R2_PUBLIC_URL origin (path stripped) and a bare-host fallback domain", async () => {
    process.env.R2_PUBLIC_URL = "https://media.example.com/assets"
    process.env.R2_PUBLIC_FALLBACK_DOMAIN = "pub-abc123.r2.dev"
    const { WIDGET_MEDIA_ORIGINS } = await import("../csp-origins.js")
    expect(WIDGET_MEDIA_ORIGINS).toEqual([
      ...CLOUD_DEFAULTS,
      "https://media.example.com",
      "https://pub-abc123.r2.dev",
    ])
  })

  it("dedupes values already covered by the defaults and drops unparseable ones", async () => {
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.ai"
    process.env.R2_PUBLIC_FALLBACK_DOMAIN = "http://"
    const { WIDGET_MEDIA_ORIGINS } = await import("../csp-origins.js")
    expect(WIDGET_MEDIA_ORIGINS).toEqual(CLOUD_DEFAULTS)
  })
})
