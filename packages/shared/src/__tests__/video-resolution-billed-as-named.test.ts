/**
 * A video model whose runner normalizes its resolution lever (Wan 3.0, Vidu Q4,
 * Kling 4.0, PixVerse V6 Max, …) bills — through the very normalizer the runner
 * sends — each of its catalog tiers on the 480p / 720p / 1080p / 4k ladder as
 * that tier. Generate Video Pro offers exactly those tiers (`@nodaro/render-rules`
 * `gvpOfferedResolutions`), so this is what makes each of them render as named.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { GVP_SUPPORTED_PROVIDERS, RESOLUTION_DURATION_PRICING } from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

const LADDER = ["480p", "720p", "1080p", "4k"]

describe("a Generate Video Pro model bills each ladder tier of its catalog as named", () => {
  it("holds for every pro model priced by (seconds × resolution)", () => {
    const checked: string[] = []
    for (const p of GVP_SUPPORTED_PROVIDERS) {
      const tiers = RESOLUTION_DURATION_PRICING[p]
      if (!tiers) continue
      for (const r of (MODEL_CATALOG[p]?.resolutions ?? []) as readonly string[]) {
        if (!LADDER.includes(r) || !tiers.includes(r)) continue
        expect(buildVideoCreditModelIdentifier(p, 8, false, "image-to-video", undefined, r, false), `${p} ${r}`).toMatch(new RegExp(`:${r}(?::|-|$)`))
        checked.push(p)
      }
    }
    // The families whose runner normalizes are all among them.
    for (const p of ["wan-3", "vidu-q4", "kling-4", "kling-4-flash", "pixverse-v6-max"]) expect(checked, p).toContain(p)
  })
})
