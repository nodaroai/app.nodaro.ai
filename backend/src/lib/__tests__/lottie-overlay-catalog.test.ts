/**
 * Built-in Lottie Overlay catalog — asset + invariant guard.
 *
 * Locks the self-hosted catalog against the failure mode that motivated it:
 * a dead/unbaked asset, or the system prompt drifting back to the dead
 * lottie.host URLs. The asset files are the bytes that ship to R2 verbatim
 * (see scripts/mirror-lottie-catalog.ts), so validating them here is exactly
 * what the renderer will fetch in production.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  LOTTIE_OVERLAY_CATALOG,
  LEGACY_LOTTIE_HOST_REMAP,
  resolveLottieOverlaySrc,
} from "@nodaro/shared"
import { LOTTIE_OVERLAY_SYSTEM_PROMPT } from "../../prompts/lottie-overlay-system.js"

// backend/src/lib/__tests__ → backend/assets/lottie-catalog
const ASSET_DIR = join(__dirname, "..", "..", "..", "assets", "lottie-catalog")
const MAX_LOTTIE_BYTES = 131072
const URL_RE = /^https:\/\/cdn\.nodaro\.ai\/lottie-catalog\/[a-z0-9-]+\.json$/

describe("LOTTIE_OVERLAY_CATALOG", () => {
  it("has exactly 12 entries", () => {
    expect(LOTTIE_OVERLAY_CATALOG).toHaveLength(12)
  })

  it("has unique slugs", () => {
    const slugs = LOTTIE_OVERLAY_CATALOG.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  for (const entry of LOTTIE_OVERLAY_CATALOG) {
    describe(entry.slug, () => {
      it("url matches the CDN pattern and ends with <slug>.json", () => {
        expect(entry.url).toMatch(URL_RE)
        expect(entry.url.endsWith(`/${entry.slug}.json`)).toBe(true)
      })

      it("asset file exists, parses, is baked, and is a valid Lottie document", () => {
        const path = join(ASSET_DIR, `${entry.slug}.json`)
        expect(existsSync(path)).toBe(true)

        const raw = readFileSync(path, "utf-8")

        // Baked: no unresolved slot references survive into a shipped asset.
        expect(raw).not.toContain('"sid"')

        // Size cap (the renderer fetches these synchronously per overlay).
        expect(Buffer.byteLength(raw, "utf-8")).toBeLessThanOrEqual(MAX_LOTTIE_BYTES)

        const doc = JSON.parse(raw) as Record<string, unknown>

        // Non-empty layers + the canonical Bodymovin canvas/timing fields.
        expect(Array.isArray(doc.layers)).toBe(true)
        expect((doc.layers as unknown[]).length).toBeGreaterThan(0)
        for (const field of ["fr", "ip", "op", "w", "h"] as const) {
          expect(typeof doc[field]).toBe("number")
        }
      })
    })
  }
})

describe("LEGACY_LOTTIE_HOST_REMAP", () => {
  const catalogUrls = new Set(LOTTIE_OVERLAY_CATALOG.map((e) => e.url))
  const keys = Object.keys(LEGACY_LOTTIE_HOST_REMAP)

  it("has exactly 12 keys", () => {
    expect(keys).toHaveLength(12)
  })

  it("every key is a dead lottie.host URL", () => {
    for (const key of keys) {
      expect(key.startsWith("https://lottie.host/")).toBe(true)
    }
  })

  it("every value is a catalog CDN url", () => {
    for (const value of Object.values(LEGACY_LOTTIE_HOST_REMAP)) {
      expect(catalogUrls.has(value)).toBe(true)
    }
  })
})

describe("resolveLottieOverlaySrc", () => {
  it("rewrites a legacy lottie.host URL to its catalog replacement", () => {
    const [legacy, replacement] = Object.entries(LEGACY_LOTTIE_HOST_REMAP)[0]
    expect(resolveLottieOverlaySrc(legacy)).toBe(replacement)
  })

  it("passes through an unknown URL unchanged", () => {
    const unknown = "https://example.com/user-asset.json"
    expect(resolveLottieOverlaySrc(unknown)).toBe(unknown)
  })

  it("passes through an already-migrated catalog URL unchanged", () => {
    const url = LOTTIE_OVERLAY_CATALOG[0].url
    expect(resolveLottieOverlaySrc(url)).toBe(url)
  })
})

describe("LOTTIE_OVERLAY_SYSTEM_PROMPT", () => {
  it("contains every catalog URL (the LLM's live menu)", () => {
    for (const entry of LOTTIE_OVERLAY_CATALOG) {
      expect(LOTTIE_OVERLAY_SYSTEM_PROMPT).toContain(entry.url)
    }
  })

  it("contains NO lottie.host substring (drift guard — never regress to dead URLs)", () => {
    expect(LOTTIE_OVERLAY_SYSTEM_PROMPT).not.toContain("lottie.host")
  })

  it("names the catalog as self-hosted (not the dead third-party CDN)", () => {
    expect(LOTTIE_OVERLAY_SYSTEM_PROMPT).toContain("self-hosted")
    expect(LOTTIE_OVERLAY_SYSTEM_PROMPT).not.toContain("LottieFiles CDN")
  })
})
