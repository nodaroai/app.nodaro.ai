import { describe, it, expect, vi } from "vitest"

// Mirror characters.test.ts mocks EXCEPT url-validator — we want the REAL
// safeUrlSchema here so this test actually exercises the SSRF gate on the
// character asset URL fields. (characters.test.ts mocks safeUrlSchema down to
// a bare z.string().url(), which would neuter this test.)
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

import { upsertCharacterBody } from "../characters.js"

// Each of these is later fetched server-side by character-lora.ts
// (zipImagesToR2Buffer) and the result is downloadable by the requesting user
// → a non-blind SSRF read-oracle if the field accepts internal targets.
const UNSAFE_URLS = [
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://127.0.0.1/x.jpg", // loopback
  "http://10.0.0.5/x.jpg", // private range
  "http://[::1]/x.jpg", // ipv6 loopback
  "file:///etc/passwd", // non-http protocol
]

const ASSET_URL_FIELDS = [
  "expressions",
  "poses",
  "angles",
  "bodyAngles",
  "lightingVariations",
  "motions",
] as const

describe("character upsert — SSRF gate on asset image URLs", () => {
  it.each(ASSET_URL_FIELDS)(
    "rejects private/reserved/metadata/non-http URLs in %s[].url",
    (field) => {
      for (const url of UNSAFE_URLS) {
        const result = upsertCharacterBody.safeParse({
          nodeId: "node-1",
          [field]: [{ name: "x", url }],
        })
        expect(result.success, `expected ${field} url "${url}" to be rejected`).toBe(false)
      }
    },
  )

  it("accepts normal public https image URLs", () => {
    const result = upsertCharacterBody.safeParse({
      nodeId: "node-1",
      expressions: [{ name: "smiling", url: "https://cdn.example.com/a.jpg" }],
    })
    expect(result.success).toBe(true)
  })
})
