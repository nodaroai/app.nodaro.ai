import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier, PRICING_DEFAULT_RESOLUTION } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Wan 3.0 / Wan 3.0 Prime (KIE wan/3-0-video, wan/3-0-video-prime) — true
 * per-second billing at three published resolution rates. KIE cr/s at
 * 480P/720P/1080P: wan-3 8 / 16 / 32, wan-3-prime 12.2 / 25.2 / 50.4.
 * Nodaro credits = ceil(KIE cr/s × duration / 4) × 10 — the same conversion as
 * minimax-h3 and happyhorse.
 *
 * Why one row per second (2-30s) rather than a coarse ladder: the tier lookup
 * snaps UP and falls back to the LAST tier, and commit_credits only refunds a
 * surplus, so a coarse ladder would under-bill every long render permanently.
 *
 * The formula sweep below is the durable half — a reprice stays safe as long as
 * the rates move together with the table. The literal table is the transcription
 * check.
 */

// Integer-tenths arithmetic on purpose: 12.2 / 25.2 / 50.4 in binary floats can
// land a product a hair under an integer boundary and shift the ceil by a step.
const rate = (kieRateX10: number, d: number) => Math.ceil((kieRateX10 * d) / 40) * 10

const KIE_RATE_X10: Record<string, Record<string, number>> = {
  "wan-3": { "480p": 80, "720p": 160, "1080p": 320 },
  "wan-3-prime": { "480p": 122, "720p": 252, "1080p": 504 },
}

describe("wan-3 static credits — literal table", () => {
  const expected: Record<string, number> = {
    "wan-3": 200,
    "wan-3:2s:480p": 40,
    "wan-3:3s:480p": 60,
    "wan-3:4s:480p": 80,
    "wan-3:5s:480p": 100,
    "wan-3:6s:480p": 120,
    "wan-3:7s:480p": 140,
    "wan-3:8s:480p": 160,
    "wan-3:9s:480p": 180,
    "wan-3:10s:480p": 200,
    "wan-3:11s:480p": 220,
    "wan-3:12s:480p": 240,
    "wan-3:13s:480p": 260,
    "wan-3:14s:480p": 280,
    "wan-3:15s:480p": 300,
    "wan-3:16s:480p": 320,
    "wan-3:17s:480p": 340,
    "wan-3:18s:480p": 360,
    "wan-3:19s:480p": 380,
    "wan-3:20s:480p": 400,
    "wan-3:21s:480p": 420,
    "wan-3:22s:480p": 440,
    "wan-3:23s:480p": 460,
    "wan-3:24s:480p": 480,
    "wan-3:25s:480p": 500,
    "wan-3:26s:480p": 520,
    "wan-3:27s:480p": 540,
    "wan-3:28s:480p": 560,
    "wan-3:29s:480p": 580,
    "wan-3:30s:480p": 600,
    "wan-3:2s:720p": 80,
    "wan-3:3s:720p": 120,
    "wan-3:4s:720p": 160,
    "wan-3:5s:720p": 200,
    "wan-3:6s:720p": 240,
    "wan-3:7s:720p": 280,
    "wan-3:8s:720p": 320,
    "wan-3:9s:720p": 360,
    "wan-3:10s:720p": 400,
    "wan-3:11s:720p": 440,
    "wan-3:12s:720p": 480,
    "wan-3:13s:720p": 520,
    "wan-3:14s:720p": 560,
    "wan-3:15s:720p": 600,
    "wan-3:16s:720p": 640,
    "wan-3:17s:720p": 680,
    "wan-3:18s:720p": 720,
    "wan-3:19s:720p": 760,
    "wan-3:20s:720p": 800,
    "wan-3:21s:720p": 840,
    "wan-3:22s:720p": 880,
    "wan-3:23s:720p": 920,
    "wan-3:24s:720p": 960,
    "wan-3:25s:720p": 1000,
    "wan-3:26s:720p": 1040,
    "wan-3:27s:720p": 1080,
    "wan-3:28s:720p": 1120,
    "wan-3:29s:720p": 1160,
    "wan-3:30s:720p": 1200,
    "wan-3:2s:1080p": 160,
    "wan-3:3s:1080p": 240,
    "wan-3:4s:1080p": 320,
    "wan-3:5s:1080p": 400,
    "wan-3:6s:1080p": 480,
    "wan-3:7s:1080p": 560,
    "wan-3:8s:1080p": 640,
    "wan-3:9s:1080p": 720,
    "wan-3:10s:1080p": 800,
    "wan-3:11s:1080p": 880,
    "wan-3:12s:1080p": 960,
    "wan-3:13s:1080p": 1040,
    "wan-3:14s:1080p": 1120,
    "wan-3:15s:1080p": 1200,
    "wan-3:16s:1080p": 1280,
    "wan-3:17s:1080p": 1360,
    "wan-3:18s:1080p": 1440,
    "wan-3:19s:1080p": 1520,
    "wan-3:20s:1080p": 1600,
    "wan-3:21s:1080p": 1680,
    "wan-3:22s:1080p": 1760,
    "wan-3:23s:1080p": 1840,
    "wan-3:24s:1080p": 1920,
    "wan-3:25s:1080p": 2000,
    "wan-3:26s:1080p": 2080,
    "wan-3:27s:1080p": 2160,
    "wan-3:28s:1080p": 2240,
    "wan-3:29s:1080p": 2320,
    "wan-3:30s:1080p": 2400,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})

describe("wan-3-prime static credits — literal table", () => {
  const expected: Record<string, number> = {
    "wan-3-prime": 320,
    "wan-3-prime:2s:480p": 70,
    "wan-3-prime:3s:480p": 100,
    "wan-3-prime:4s:480p": 130,
    "wan-3-prime:5s:480p": 160,
    "wan-3-prime:6s:480p": 190,
    "wan-3-prime:7s:480p": 220,
    "wan-3-prime:8s:480p": 250,
    "wan-3-prime:9s:480p": 280,
    "wan-3-prime:10s:480p": 310,
    "wan-3-prime:11s:480p": 340,
    "wan-3-prime:12s:480p": 370,
    "wan-3-prime:13s:480p": 400,
    "wan-3-prime:14s:480p": 430,
    "wan-3-prime:15s:480p": 460,
    "wan-3-prime:16s:480p": 490,
    "wan-3-prime:17s:480p": 520,
    "wan-3-prime:18s:480p": 550,
    "wan-3-prime:19s:480p": 580,
    "wan-3-prime:20s:480p": 610,
    "wan-3-prime:21s:480p": 650,
    "wan-3-prime:22s:480p": 680,
    "wan-3-prime:23s:480p": 710,
    "wan-3-prime:24s:480p": 740,
    "wan-3-prime:25s:480p": 770,
    "wan-3-prime:26s:480p": 800,
    "wan-3-prime:27s:480p": 830,
    "wan-3-prime:28s:480p": 860,
    "wan-3-prime:29s:480p": 890,
    "wan-3-prime:30s:480p": 920,
    "wan-3-prime:2s:720p": 130,
    "wan-3-prime:3s:720p": 190,
    "wan-3-prime:4s:720p": 260,
    "wan-3-prime:5s:720p": 320,
    "wan-3-prime:6s:720p": 380,
    "wan-3-prime:7s:720p": 450,
    "wan-3-prime:8s:720p": 510,
    "wan-3-prime:9s:720p": 570,
    "wan-3-prime:10s:720p": 630,
    "wan-3-prime:11s:720p": 700,
    "wan-3-prime:12s:720p": 760,
    "wan-3-prime:13s:720p": 820,
    "wan-3-prime:14s:720p": 890,
    "wan-3-prime:15s:720p": 950,
    "wan-3-prime:16s:720p": 1010,
    "wan-3-prime:17s:720p": 1080,
    "wan-3-prime:18s:720p": 1140,
    "wan-3-prime:19s:720p": 1200,
    "wan-3-prime:20s:720p": 1260,
    "wan-3-prime:21s:720p": 1330,
    "wan-3-prime:22s:720p": 1390,
    "wan-3-prime:23s:720p": 1450,
    "wan-3-prime:24s:720p": 1520,
    "wan-3-prime:25s:720p": 1580,
    "wan-3-prime:26s:720p": 1640,
    "wan-3-prime:27s:720p": 1710,
    "wan-3-prime:28s:720p": 1770,
    "wan-3-prime:29s:720p": 1830,
    "wan-3-prime:30s:720p": 1890,
    "wan-3-prime:2s:1080p": 260,
    "wan-3-prime:3s:1080p": 380,
    "wan-3-prime:4s:1080p": 510,
    "wan-3-prime:5s:1080p": 630,
    "wan-3-prime:6s:1080p": 760,
    "wan-3-prime:7s:1080p": 890,
    "wan-3-prime:8s:1080p": 1010,
    "wan-3-prime:9s:1080p": 1140,
    "wan-3-prime:10s:1080p": 1260,
    "wan-3-prime:11s:1080p": 1390,
    "wan-3-prime:12s:1080p": 1520,
    "wan-3-prime:13s:1080p": 1640,
    "wan-3-prime:14s:1080p": 1770,
    "wan-3-prime:15s:1080p": 1890,
    "wan-3-prime:16s:1080p": 2020,
    "wan-3-prime:17s:1080p": 2150,
    "wan-3-prime:18s:1080p": 2270,
    "wan-3-prime:19s:1080p": 2400,
    "wan-3-prime:20s:1080p": 2520,
    "wan-3-prime:21s:1080p": 2650,
    "wan-3-prime:22s:1080p": 2780,
    "wan-3-prime:23s:1080p": 2900,
    "wan-3-prime:24s:1080p": 3030,
    "wan-3-prime:25s:1080p": 3150,
    "wan-3-prime:26s:1080p": 3280,
    "wan-3-prime:27s:1080p": 3410,
    "wan-3-prime:28s:1080p": 3530,
    "wan-3-prime:29s:1080p": 3660,
    "wan-3-prime:30s:1080p": 3780,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})

describe("wan-3 family — every seeded tier derives from the SAME ceil formula", () => {
  for (const model of ["wan-3", "wan-3-prime"]) {
    for (const res of ["480p", "720p", "1080p"]) {
      it(`${model} @${res} — 2s..30s all match ceil(rate × d / 4) × 10`, () => {
        for (let d = 2; d <= 30; d++) {
          expect(
            STATIC_CREDIT_COSTS[`${model}:${d}s:${res}`],
            `${model}:${d}s:${res}`,
          ).toBe(rate(KIE_RATE_X10[model]![res]!, d))
        }
      })
    }

    it(`${model} seeds exactly 87 composites (29 durations × 3 resolutions) and nothing else`, () => {
      const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.startsWith(`${model}:`))
      expect(keys.length).toBe(87)
    })
  }
})

describe("wan-3 family — the bare id IS the default render (render == billed)", () => {
  // The three-place agreement this pins: the catalog's ascending resolutions,
  // PRICING_DEFAULT_RESOLUTION + the credit-identifier fallback, and runWan3's
  // own "720P" default. If any one of them drifts, an intent-less request
  // reserves one tier and renders another — and commit_credits (refund-only)
  // can never collect the shortfall.
  for (const model of ["wan-3", "wan-3-prime"]) {
    it(`${model}: an intent-less request builds ${model}:5s:720p`, () => {
      expect(PRICING_DEFAULT_RESOLUTION[model]).toBe("720p")
      expect(
        buildVideoCreditModelIdentifier(model, undefined, undefined, "image-to-video", undefined, undefined, undefined),
      ).toBe(`${model}:5s:720p`)
      // text-to-video must resolve identically — neither SKU has a
      // T2V_CREDIT_OVERRIDES entry, and an override would silently reprice it.
      expect(
        buildVideoCreditModelIdentifier(model, undefined, undefined, "text-to-video", undefined, undefined, undefined),
      ).toBe(`${model}:5s:720p`)
    })

    it(`${model}: STATIC[bare] === STATIC[the default composite]`, () => {
      const id = buildVideoCreditModelIdentifier(model, undefined, undefined, "image-to-video", undefined, undefined, undefined)
      expect(STATIC_CREDIT_COSTS[model]).toBe(STATIC_CREDIT_COSTS[id])
    })

    it(`${model}: an UNSUPPORTED resolution also lands on the declared 720p default, not the cheapest tier`, () => {
      expect(
        buildVideoCreditModelIdentifier(model, 5, undefined, "image-to-video", undefined, "4k", undefined),
      ).toBe(`${model}:5s:720p`)
    })

    it(`${model}: an explicit resolution is honoured at both ends of the ladder`, () => {
      expect(buildVideoCreditModelIdentifier(model, 2, undefined, "image-to-video", undefined, "480p", undefined)).toBe(`${model}:2s:480p`)
      expect(buildVideoCreditModelIdentifier(model, 30, undefined, "image-to-video", undefined, "1080p", undefined)).toBe(`${model}:30s:1080p`)
    })

    it(`${model}: a reference video does NOT add a "-ref" dimension (output seconds only)`, () => {
      expect(
        buildVideoCreditModelIdentifier(model, 8, undefined, "image-to-video", undefined, "720p", true),
      ).toBe(`${model}:8s:720p`)
    })
  }
})

describe("wan-3 family — phantom identifiers stay unpriced", () => {
  const phantoms: string[] = []
  for (const model of ["wan-3", "wan-3-prime"]) {
    phantoms.push(
      `${model}:8s:480p-ref`, `${model}:8s:720p-ref`, `${model}:8s:1080p-ref`,
      `${model}:8s:4k`, `${model}:8s:2k`, `${model}:8s:360p`,
      `${model}:1s:720p`, `${model}:31s:720p`, `${model}:8s:720P`,
      `${model}:8s`, `${model}:audio`,
    )
  }
  for (const id of phantoms) {
    it(`${id} is NOT seeded`, () => { expect(STATIC_CREDIT_COSTS[id]).toBeUndefined() })
  }
})
