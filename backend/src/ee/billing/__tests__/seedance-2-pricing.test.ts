import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("seedance-2 4k + 1080p static credits", () => {
  const expected: Record<string, number> = {
    "seedance-2:4s:4k": 208, "seedance-2:8s:4k": 416, "seedance-2:12s:4k": 624, "seedance-2:15s:4k": 780,
    "seedance-2:4s:4k-ref": 128, "seedance-2:8s:4k-ref": 256, "seedance-2:12s:4k-ref": 384, "seedance-2:15s:4k-ref": 480,
    "seedance-2:4s:1080p": 102, "seedance-2:8s:1080p": 204, "seedance-2:12s:1080p": 306, "seedance-2:15s:1080p": 383,
    "seedance-2:4s:1080p-ref": 62, "seedance-2:8s:1080p-ref": 124, "seedance-2:12s:1080p-ref": 186, "seedance-2:15s:1080p-ref": 233,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})

describe("seedance-2-fast has NO 1080p tier (KIE sells 480p/720p only)", () => {
  // KIE pricing page verified 2026-06-25: seedance-2-fast = 4 SKUs (480p/720p,
  // ±video-ref), no 1080p. The previously-seeded 1080p composites were guessed
  // (1.5× of 720p) with no matching KIE SKU — removed.
  const phantom1080p = [
    "seedance-2-fast:4s:1080p", "seedance-2-fast:8s:1080p",
    "seedance-2-fast:12s:1080p", "seedance-2-fast:15s:1080p",
    "seedance-2-fast:4s:1080p-ref", "seedance-2-fast:8s:1080p-ref",
    "seedance-2-fast:12s:1080p-ref", "seedance-2-fast:15s:1080p-ref",
  ]
  for (const id of phantom1080p) {
    it(`${id} is undefined`, () => { expect(STATIC_CREDIT_COSTS[id]).toBeUndefined() })
  }
})

describe("seedance-2-fast 480p-ref corrected to 9 KIE cr/s", () => {
  // Was underpriced at 8 KIE cr/s; KIE pricing page shows 9 cr/s.
  // Nodaro credits = ceil(9 × duration / 4).
  const expected: Record<string, number> = {
    "seedance-2-fast:4s:480p-ref": 9,
    "seedance-2-fast:8s:480p-ref": 18,
    "seedance-2-fast:12s:480p-ref": 27,
    "seedance-2-fast:15s:480p-ref": 34,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})
