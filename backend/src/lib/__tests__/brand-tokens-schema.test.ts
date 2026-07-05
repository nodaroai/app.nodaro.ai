import { describe, it, expect, vi } from "vitest"

// Mirror download.test.ts's config mock so R2_PUBLIC_URL is set for the
// logo.image refine (isOurCdnUrl reads config at parse time).
vi.mock("../config.js", async (orig) => {
  const actual = (await orig()) as { config: Record<string, unknown> }
  return { config: { ...actual.config, R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})

import { brandTokensSchema } from "../plan-schemas.js"
import { BRAND_PRESETS } from "@nodaro/shared"

describe("brandTokensSchema", () => {
  it("accepts a full preset", () => {
    expect(brandTokensSchema.safeParse(BRAND_PRESETS["midnight-violet"]).success).toBe(true)
  })

  it("accepts the minimal shape (palette bg/text/accent + fonts)", () => {
    const min = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } }
    expect(brandTokensSchema.safeParse(min).success).toBe(true)
  })

  it("rejects an unsupported font", () => {
    const bad = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Comic Sans", body: "Inter" } }
    expect(brandTokensSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a non-hex palette color", () => {
    const bad = { palette: { bg: "rgb(0,0,0)", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } }
    expect(brandTokensSchema.safeParse(bad).success).toBe(false)
  })

  describe("typography (headingType/bodyType)", () => {
    const base = { palette: { bg: "#000", text: "#fff", accent: "#f00" } }

    it("accepts a valid typography spec", () => {
      const withType = {
        ...base,
        fonts: {
          heading: "Anton",
          body: "Inter",
          headingType: { weight: 700, casing: "uppercase", tracking: -0.03 },
        },
      }
      expect(brandTokensSchema.safeParse(withType).success).toBe(true)
    })

    it("rejects an invalid casing value", () => {
      const bad = {
        ...base,
        fonts: { heading: "Anton", body: "Inter", headingType: { casing: "slanted" } },
      }
      expect(brandTokensSchema.safeParse(bad).success).toBe(false)
    })

    it("rejects a weight outside the 100-900 range", () => {
      const bad = {
        ...base,
        fonts: { heading: "Anton", body: "Inter", headingType: { weight: 1000 } },
      }
      expect(brandTokensSchema.safeParse(bad).success).toBe(false)
    })

    it("still validates when no typography is present", () => {
      const noType = { ...base, fonts: { heading: "Anton", body: "Inter" } }
      expect(brandTokensSchema.safeParse(noType).success).toBe(true)
    })
  })
})

describe("brandTokensSchema — logo.image (Phase 3c)", () => {
  const base = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } }

  it("RETAINS logo.image + imageBackdrop through parse (drift guard does NOT cover optional fields)", () => {
    const url = "https://pub-test.r2.dev/logos/x.png"
    const parsed = brandTokensSchema.parse({ ...base, logo: { name: "X", image: url, imageBackdrop: "#111" } })
    expect(parsed.logo?.image).toBe(url) // value SURVIVES — not just .success
    expect(parsed.logo?.imageBackdrop).toBe("#111")
  })
  it("rejects a non-our-CDN logo.image", () => {
    expect(brandTokensSchema.safeParse({ ...base, logo: { name: "X", image: "https://evil.com/x.png" } }).success).toBe(false)
  })
  it("still accepts a logo with no image (byte-identical path)", () => {
    expect(brandTokensSchema.parse({ ...base, logo: { name: "X" } }).logo?.image).toBeUndefined()
  })
})
