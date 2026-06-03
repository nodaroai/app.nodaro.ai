import { describe, it, expect } from "vitest"

// ---------------------------------------------------------------------------
// SSRF parity for WI-1b `connectedReferences[].url`.
//
// This suite deliberately does NOT mock `@/lib/url-validator.js` — it exercises
// the REAL `safeUrlSchema` so we prove the structured-path reference URLs go
// through the exact same syntactic SSRF gate as the flat `referenceImageUrls`.
// (The main generate-image.test.ts mocks safeUrlSchema down to `z.string().url()`
// for convenience, which would mask SSRF rejection — hence this dedicated file.)
//
// Pure Zod parse: no Fastify / supabase / queue needed.
// ---------------------------------------------------------------------------

import { generateImageBody } from "../generate-image.js"

const PUBLIC_URL = "https://r2.nodaro.ai/ref.png"
const PRIVATE_URLS = [
  "http://127.0.0.1/x.png",
  "http://localhost/x.png",
  "http://169.254.169.254/latest/meta-data", // cloud metadata endpoint
  "http://10.0.0.5/x.png",
  "http://192.168.1.1/x.png",
  "file:///etc/passwd",
  "ftp://example.com/x.png",
]

describe("WI-1b connectedReferences SSRF parity", () => {
  function mkRef(url: string) {
    return { id: "m0", defaultName: "ref", source: "manual" as const, url }
  }

  it("accepts a connectedReferences[].url that is a public https URL", () => {
    const result = generateImageBody.safeParse({
      prompt: "x",
      connectedReferences: [mkRef(PUBLIC_URL)],
    })
    expect(result.success).toBe(true)
  })

  it.each(PRIVATE_URLS)(
    "rejects a connectedReferences[].url pointing at %s (same gate as referenceImageUrls)",
    (badUrl) => {
      const viaConnected = generateImageBody.safeParse({
        prompt: "x",
        connectedReferences: [mkRef(badUrl)],
      })
      const viaFlat = generateImageBody.safeParse({
        prompt: "x",
        referenceImageUrls: [badUrl],
      })
      // BOTH channels must reject identically — that's the parity guarantee.
      expect(viaConnected.success, `connectedReferences should reject ${badUrl}`).toBe(false)
      expect(viaFlat.success, `referenceImageUrls should reject ${badUrl}`).toBe(false)
    },
  )

  it("rejects the whole body when ANY connectedReferences[].url is private", () => {
    const result = generateImageBody.safeParse({
      prompt: "x",
      connectedReferences: [mkRef(PUBLIC_URL), mkRef("http://127.0.0.1/x.png")],
    })
    expect(result.success).toBe(false)
  })
})
