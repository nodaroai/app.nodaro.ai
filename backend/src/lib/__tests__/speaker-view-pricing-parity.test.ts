/**
 * Speaker View's reserve, as a CROSS-REPO fixture (C4, decided 2026-10-10).
 *
 * Two sites reserve a Speaker View render and must agree: the cloud plugin's
 * route (`POST /v1/speaker-view`: its own copy of the tier rule, its own
 * `edlDurationMs` from the `@nodaro/shared` it pins, its own rates) and the
 * workflow run here (`speakerViewPriceTier` + `speakerViewCreditOverride`).
 * This app is the source of truth for the price: every case below is computed
 * by this repo's code and committed as `fixtures/speaker-view-pricing-cases.json`;
 * the plugin's `app-pricing-parity.test.ts` runs its route's pricing over the
 * same file and fails on any difference (tier, row, minutes, base credits) —
 * including a drift of the overlap-aware duration between the two
 * `@nodaro/shared` versions.
 *
 * Here: the committed fixture must equal what this code computes (so it can
 * never go stale against the app), and every case must be an edit the plugin
 * renders (the rule's verdict), since a refused edit is never priced.
 *
 * Regenerate after a pricing change: `SV_PRICING_WRITE=1 npx vitest run
 * src/lib/__tests__/speaker-view-pricing-parity.test.ts`, then land the
 * plugin's matching change after this one (its check reads `dev`).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { edlDurationMs, type Edl } from "@nodaro/shared/edl"
import { speakerViewCreditId } from "@nodaro/shared/credits"
import { coerceSpeakerViewEdl, findSpeakerViewIssues, speakerViewPriceBasis, type SpeakerViewWireSettings } from "@nodaro/render-rules"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE, speakerViewBaseCredits, speakerViewReserveMinutes } from "../speaker-view-plan.js"

const FIXTURE = join(__dirname, "fixtures", "speaker-view-pricing-cases.json")

interface PricingCase {
  readonly name: string
  readonly edl: Edl
  readonly transcript?: unknown
  /** The route body's settings (`speakerViewWireSettings`' shape). */
  readonly settings: SpeakerViewWireSettings
  readonly quality: "proxy" | "final"
}

interface PricedCase extends PricingCase {
  readonly expected: {
    readonly durationMs: number
    readonly minutes: number
    readonly tier: "standard" | "complex"
    readonly maxTiles: number
    readonly zoom: boolean
    readonly creditId: string
    readonly creditsPerMinute: number
    readonly baseCredits: number
  }
}

// ── The edits ────────────────────────────────────────────────────────────────
const MIC = { id: "mic", url: "https://media.example/mic.wav", kind: "audio" as const, role: "master-audio" as const }
const cam = (id: string, extra: Record<string, unknown> = {}) => ({ id, url: `https://media.example/${id}.mp4`, kind: "video" as const, ...extra })
const IDS = ["a", "b", "c", "d", "e", "f"]

/** `n` named speakers on `n` cameras taking turns in `segMs` segments to `totalMs`. */
function turns(n: number, totalMs: number, segMs = 20_000, extra: (i: number) => Record<string, unknown> = () => ({})): Edl {
  const ids = IDS.slice(0, n)
  const count = Math.ceil(totalMs / segMs)
  return {
    version: 1,
    clock: "master",
    sources: [MIC, ...ids.map((id) => cam(id))],
    segments: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      inMs: i * segMs,
      outMs: Math.min(totalMs, (i + 1) * segMs),
      video: ids[i % n]!,
      speaker: `S${i % n}`,
      ...extra(i),
    })),
  } as Edl
}

const slots = (mode: string, ...pairs: Array<[string, string]>) => ({ mode, slots: pairs.map(([source, speaker]) => ({ source, speaker })) })

/** Camera Switch's crosstalk hints: every fourth segment shows `k` speakers at once. */
const hinted = (k: number, totalMs: number) =>
  turns(3, totalMs, 20_000, (i) => (i % 4 === 3 ? { layout: slots(k === 2 ? "side-by-side" : "grid", ...IDS.slice(0, k).map((id, j) => [id, `S${j}`] as [string, string])) } : {}))

/** An Edit Plan cut: segments jump over dropped stretches and join with crossfades. */
const crossfaded = (): Edl => ({
  version: 1,
  clock: "master",
  sources: [MIC, cam("a"), cam("b")],
  segments: Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    inMs: i * 30_000,
    outMs: i * 30_000 + 25_000,
    video: i % 2 ? "b" : "a",
    speaker: i % 2 ? "Guest" : "Host",
    ...(i > 0 ? { transition: { type: "crossfade", durationMs: 500 } } : {}),
  })),
} as Edl)

/** Speaker View's own `xfade:*` switches written at the jumps (a drawn edit given back as input). */
const layoutXfaded = (): Edl => ({
  version: 1,
  clock: "master",
  sources: [MIC, cam("a"), cam("b")],
  segments: Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    inMs: i * 40_000,
    outMs: i * 40_000 + 30_000,
    video: i % 2 ? "b" : "a",
    speaker: i % 2 ? "Guest" : "Host",
    ...(i > 0 ? { layout: { mode: "single", transition: { type: "xfade:wipe-left", durationMs: 400 } } } : {}),
  })),
} as Edl)

const TRANSCRIPT_ABC = {
  version: 1,
  words: [
    { text: "one", startMs: 100, endMs: 400, speaker: "A" },
    { text: "two", startMs: 20_100, endMs: 20_400, speaker: "B" },
    { text: "three", startMs: 40_100, endMs: 40_400, speaker: "C" },
  ],
}
/** One wide camera, no speaker named on any segment: the transcript's labels fill the tiles. */
const unnamedWide = (): Edl => ({
  version: 1,
  clock: "master",
  sources: [MIC, cam("w")],
  segments: [0, 1, 2].map((i) => ({ id: `s${i}`, inMs: i * 20_000, outMs: (i + 1) * 20_000, video: "w" })),
} as Edl)

const both = (c: Omit<PricingCase, "quality">): PricingCase[] => [
  { ...c, name: `${c.name} — final`, quality: "final" },
  { ...c, name: `${c.name} — preview`, quality: "proxy" },
]

const CASES: readonly PricingCase[] = [
  ...both({ name: "two cameras, one at a time (auto, no hints), 12:00", edl: turns(2, 12 * 60_000), settings: {} }),
  ...both({ name: "side by side, two speakers, 12:00.001", edl: turns(2, 12 * 60_000 + 1), settings: { layout: "side-by-side", targetAspect: "16:9" } }),
  ...both({ name: "side by side asked at 9:16 draws stacked, 3:10", edl: turns(2, 190_000), settings: { layout: "side-by-side", targetAspect: "9:16" } }),
  ...both({ name: "pip, two speakers, 1:00 exactly", edl: turns(2, 60_000), settings: { layout: "pip" } }),
  ...both({ name: "grid of two draws side by side, 0:30", edl: turns(2, 30_000), settings: { layout: "grid" } }),
  ...both({ name: "grid of three, 45:30", edl: turns(3, 45 * 60_000 + 30_000), settings: { layout: "grid" } }),
  ...both({ name: "grid of six, 10:00", edl: turns(6, 10 * 60_000), settings: { layout: "grid", emphasis: { style: "scale+border+dim", durationMs: 300 } } }),
  ...both({ name: "auto, Camera Switch two-up hints, 6:00", edl: hinted(2, 6 * 60_000), settings: { layout: "auto" } }),
  ...both({ name: "auto, Camera Switch three-up hints, 6:00", edl: hinted(3, 6 * 60_000), settings: { layout: "auto" } }),
  ...both({ name: "single with a Zoom switch, 8:10", edl: turns(2, 8 * 60_000 + 10_000), settings: { layout: "single", switch: { type: "zoom", durationMs: 600 } } }),
  ...both({ name: "single with a Pan switch, 8:10", edl: turns(2, 8 * 60_000 + 10_000), settings: { layout: "single", switch: { type: "pan", durationMs: 600 } } }),
  ...both({ name: "side by side with a Zoom switch (nothing to zoom), 2:00", edl: turns(2, 120_000), settings: { layout: "side-by-side", switch: { type: "zoom", durationMs: 600 } } }),
  ...both({ name: "auto with a segment's own zoom, 2:00", edl: turns(2, 120_000, 20_000, (i) => (i === 3 ? { layout: { mode: "single", transition: { type: "zoom", durationMs: 400 } } } : {})), settings: {} }),
  ...both({ name: "Edit Plan crossfades (overlap shortens the output), 12 × 25 s", edl: crossfaded(), settings: { layout: "side-by-side" } }),
  ...both({ name: "xfade switches on the edit as given (overlap), 10 × 30 s", edl: layoutXfaded(), settings: {} }),
  ...both({ name: "one wide camera naming no one: a grid of the transcript's three labels", edl: unnamedWide(), transcript: TRANSCRIPT_ABC, settings: { layout: "grid" } }),
  ...both({ name: "the same, its transcript as a JSON string", edl: unnamedWide(), transcript: JSON.stringify(TRANSCRIPT_ABC), settings: { layout: "grid" } }),
  ...both({ name: "one wide camera naming no one, single", edl: unnamedWide(), transcript: TRANSCRIPT_ABC, settings: { layout: "single" } }),
  ...both({
    name: "a late third camera: the grid draws two tiles until it begins, three after",
    edl: { ...turns(3, 90_000), sources: [MIC, cam("a"), cam("b"), cam("c", { offsetMs: 30_000 })] } as Edl,
    settings: { layout: "grid" },
  }),
]

function price(c: PricingCase): PricedCase["expected"] {
  const basis = speakerViewPriceBasis({ edl: c.edl, ...(c.transcript !== undefined ? { transcript: c.transcript } : {}), settings: c.settings })
  const creditId = speakerViewCreditId(c.quality, basis.tier)
  return {
    durationMs: edlDurationMs(c.edl),
    minutes: speakerViewReserveMinutes(c.edl),
    tier: basis.tier,
    maxTiles: basis.maxTiles,
    zoom: basis.zoom,
    creditId,
    creditsPerMinute: SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[creditId],
    baseCredits: speakerViewBaseCredits(c.edl, creditId),
  }
}

const computed = (): { version: 1; cases: PricedCase[] } => ({ version: 1, cases: CASES.map((c) => ({ ...c, expected: price(c) })) })

if (process.env.SV_PRICING_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(computed(), null, 2)}\n`)

describe("speaker-view-pricing-cases.json — the app's prices, for the plugin's route to match", () => {
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as { version: 1; cases: PricedCase[] }

  it("is exactly what this code computes (regenerate with SV_PRICING_WRITE=1)", () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(computed())))
  })

  it("holds only edits the plugin renders: a refused edit is never priced", () => {
    for (const c of committed.cases) {
      const v = findSpeakerViewIssues({ edl: c.edl, transcript: c.transcript, settings: c.settings })
      expect(v.issues.map((i) => i.message), c.name).toEqual([])
      expect("edl" in coerceSpeakerViewEdl(c.edl), c.name).toBe(true)
    }
  })

  it("covers both tiers at both qualities, an overlap, the minute boundary and the one-minute floor", () => {
    const ids = new Set(committed.cases.map((c) => c.expected.creditId))
    expect([...ids].sort()).toEqual(["speaker-view", "speaker-view:complex", "speaker-view:complex:proxy", "speaker-view:proxy"])
    expect(committed.cases.some((c) => c.expected.durationMs < c.edl.segments.reduce((t, s) => t + (s.outMs - s.inMs), 0))).toBe(true)
    expect(committed.cases.some((c) => c.expected.durationMs === 60_000 && c.expected.minutes === 1)).toBe(true)
    expect(committed.cases.some((c) => c.expected.durationMs === 12 * 60_000 + 1 && c.expected.minutes === 13)).toBe(true)
    expect(committed.cases.some((c) => c.expected.durationMs < 60_000 && c.expected.minutes === 1)).toBe(true)
    expect(committed.cases.some((c) => c.expected.zoom)).toBe(true)
    expect(Math.max(...committed.cases.map((c) => c.expected.maxTiles))).toBe(6)
  })
})
