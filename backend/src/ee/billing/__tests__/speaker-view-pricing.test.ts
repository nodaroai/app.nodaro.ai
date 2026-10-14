/**
 * Speaker View's four price rows (C4, decided 2026-10-10), per minute of
 * rendered output, chosen by `speakerViewCreditId(quality, tier)`:
 *
 *   | tier                         | preview | final |
 *   | `standard` (1–2 tiles)       | 2       | 10    |
 *   | `complex` (3–6 tiles, zoom)  | 3       | 12    |
 *
 * Each row is one value of `SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE`
 * (`lib/speaker-view-plan.ts`); migration 503's rows are pinned to the same
 * values by `credit-pricing-migration-sync.test.ts`, the editor's cold-cache
 * rows by `lib/__tests__/frontend-credit-fallback-parity.test.ts`, and the
 * worked examples in `docs/nodes/processing-video/speaker-view.md` by the
 * last block here.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { SPEAKER_VIEW_CREDIT_IDS, SPEAKER_VIEW_PRICE_TIERS, speakerViewCreditId } from "@nodaro/shared/credits"
import type { Edl } from "@nodaro/shared/edl"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS, CreditsService } from "../credits.js"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE, speakerViewBaseCredits, speakerViewReserveMinutes } from "../../../lib/speaker-view-plan.js"

describe("speaker-view price rows", () => {
  it("each row is its one constant, and the four are the decided figures", () => {
    for (const id of SPEAKER_VIEW_CREDIT_IDS) expect(STATIC_CREDIT_COSTS[id], id).toBe(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[id])
    expect(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE).toEqual({
      "speaker-view": 10,
      "speaker-view:proxy": 2,
      "speaker-view:complex": 12,
      "speaker-view:complex:proxy": 3,
    })
  })

  it("every id the builder can name has a row", () => {
    for (const quality of ["proxy", "final", undefined, "high"]) {
      for (const tier of [...SPEAKER_VIEW_PRICE_TIERS, undefined, "x"]) {
        expect(STATIC_CREDIT_COSTS[speakerViewCreditId(quality, tier)], `${quality}/${tier}`).toBeDefined()
      }
    }
  })

  it("a preview costs less than its final, and the complex tier more than the standard, per minute", () => {
    const r = SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE
    expect(r["speaker-view:proxy"]).toBeLessThan(r["speaker-view"])
    expect(r["speaker-view:complex:proxy"]).toBeLessThan(r["speaker-view:complex"])
    expect(r["speaker-view"]).toBeLessThan(r["speaker-view:complex"])
    expect(r["speaker-view:proxy"]).toBeLessThan(r["speaker-view:complex:proxy"])
  })

  it("the request-shaped resolver names the route's row (CREDIT_COSTS)", () => {
    const resolve = CREDIT_COSTS["speaker-view"]!
    expect(resolve({ quality: "proxy", edl: edit(2, 60_000), layout: "side-by-side" })).toBe("speaker-view:proxy")
    expect(resolve({ edl: edit(3, 60_000), layout: "grid" })).toBe("speaker-view:complex")
    expect(resolve({ quality: "proxy", edl: edit(2, 60_000), layout: "single", switch: { type: "zoom" } })).toBe("speaker-view:complex:proxy")
    // No edit to read: the dearer row, never under the run.
    expect(resolve({ quality: "proxy" })).toBe("speaker-view:complex:proxy")
  })
})

const cam = (id: string) => ({ id, url: `https://media.test/${id}.mp4`, kind: "video" as const })
const MIC = { id: "mic", url: "https://media.test/mic.wav", kind: "audio" as const, role: "master-audio" }
function edit(n: number, totalMs: number): Edl {
  const ids = ["a", "b", "c", "d", "e", "f"].slice(0, n)
  return {
    version: 1,
    clock: "master",
    sources: [MIC, ...ids.map(cam)],
    segments: Array.from({ length: Math.ceil(totalMs / 20_000) }, (_, i) => ({
      id: `s${i}`, inMs: i * 20_000, outMs: Math.min(totalMs, (i + 1) * 20_000), video: ids[i % n]!, speaker: `S${i % n}`,
    })),
  } as Edl
}

describe("the workflow estimate quotes the row of the node's quality and tier, × its minutes", () => {
  const est = (data: Record<string, unknown>, edges: Array<{ source: string; target: string; targetHandle: string }> | undefined = [], extra: Array<{ id: string; type: string; data: Record<string, unknown> }> = []) =>
    CreditsService.estimateWorkflowBaseCredits([...extra, { id: "v", type: "speaker-view", data }], edges)

  it.each([
    { name: "single, nothing wired: the standard row, one minute", data: { layout: "single" }, credits: 10 },
    { name: "a preview of the same", data: { layout: "single", quality: "proxy" }, credits: 2 },
    { name: "auto with no edit known: the complex row (the edit decides its tiles)", data: { layout: "auto" }, credits: 12 },
    { name: "a Zoom switch: the complex row", data: { layout: "single", switchType: "zoom", quality: "proxy" }, credits: 3 },
  ])("$name", ({ data, credits }) => {
    expect(est(data)).toBe(credits)
  })

  it("an inline edit: its tier and its minutes", () => {
    expect(est({ layout: "grid", edl: edit(3, 45 * 60_000 + 30_000) })).toBe(46 * 12)
    expect(est({ layout: "side-by-side", quality: "proxy", edl: edit(2, 12 * 60_000) })).toBe(12 * 2)
  })

  it("the edit Camera Switch holds: its tiles and its length, when the switch does not re-run", () => {
    const wire = [{ source: "sw", target: "v", targetHandle: "edl" }]
    const sw = (n: number) => ({ id: "sw", type: "camera-switch", data: { generatedJson: { edl: edit(n, 10 * 60_000) } } })
    const onlyTheRender = { runNodeIds: new Set(["v"]) }
    const run = (n: number, data: Record<string, unknown>) =>
      CreditsService.estimateWorkflowBaseCredits([sw(n), { id: "v", type: "speaker-view", data }], wire, onlyTheRender)
    expect(run(6, { layout: "grid" })).toBe(10 * 12)
    expect(run(2, { layout: "grid" })).toBe(10 * 10)
    expect(run(2, { layout: "auto", quality: "proxy" })).toBe(10 * 2)
  })

  it("a switch that re-runs leaves the edit unknown: the settings decide the tier", () => {
    const wire = [{ source: "sw", target: "v", targetHandle: "edl" }]
    const sw = { id: "sw", type: "camera-switch", data: { generatedJson: { edl: edit(2, 10 * 60_000) } } }
    const both = (data: Record<string, unknown>) => CreditsService.estimateWorkflowBaseCredits([sw, { id: "v", type: "speaker-view", data }], wire, { runNodeIds: new Set(["sw", "v"]) })
    const rate = (data: Record<string, unknown>) => both(data) - CreditsService.estimateWorkflowBaseCredits([sw], [], { runNodeIds: new Set(["sw"]) })
    const minutes = rate({ layout: "single" }) / 10
    expect(rate({ layout: "grid" })).toBe(minutes * 12)
  })

  it("a render with no id cannot be placed in its graph: the 180-minute ceiling of the dearer row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "speaker-view", data: {} }])).toBe(180 * 12)
  })
})

describe("the worked examples in docs/nodes/processing-video/speaker-view.md", () => {
  // backend/src/ee/billing/__tests__/ → up 5 → repo root
  const doc = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "docs", "nodes", "processing-video", "speaker-view.md"), "utf8")

  it.each([
    { what: "12:00, two speakers side by side, final", ms: 12 * 60_000, n: 2, id: "speaker-view", minutes: 12, credits: 120 },
    { what: "12:00, two speakers side by side, preview", ms: 12 * 60_000, n: 2, id: "speaker-view:proxy", minutes: 12, credits: 24 },
    { what: "12:00.5 rounds up to 13 minutes", ms: 12 * 60_000 + 500, n: 2, id: "speaker-view", minutes: 13, credits: 130 },
    { what: "45:30, a grid of three, final", ms: 45 * 60_000 + 30_000, n: 3, id: "speaker-view:complex", minutes: 46, credits: 552 },
    { what: "45:30, a grid of three, preview", ms: 45 * 60_000 + 30_000, n: 3, id: "speaker-view:complex:proxy", minutes: 46, credits: 138 },
    { what: "8:10, single with Zoom, final", ms: 8 * 60_000 + 10_000, n: 2, id: "speaker-view:complex", minutes: 9, credits: 108 },
    { what: "8:10, single with Zoom, preview", ms: 8 * 60_000 + 10_000, n: 2, id: "speaker-view:complex:proxy", minutes: 9, credits: 27 },
    { what: "0:40, the one-minute floor", ms: 40_000, n: 2, id: "speaker-view", minutes: 1, credits: 10 },
  ] as const)("$what → $credits", ({ ms, n, id, minutes, credits }) => {
    const e = edit(n, ms)
    expect(speakerViewReserveMinutes(e)).toBe(minutes)
    expect(speakerViewBaseCredits(e, id)).toBe(credits)
    // The page states the charged price of these minutes (docs-charged-prices.test.ts holds the figure);
    // the annotation's units are what this rule reserves.
    expect(doc).toContain(`<!-- credits: ${minutes === 1 ? id : `${id}@${minutes}`} -->`)
  })

  it("states the charge on the render with the plugin handler's own example (its handler.test: 20:00 → 18:44 → 19 minutes)", () => {
    expect(doc).toMatch(/an edit of 20 min 00 s whose 19 crossfade switches of 4 s render 18 min 44 s, at Final in Standard, reserves 20 × [\d.]+ = \d+<!-- credits: speaker-view@20 --> and is charged 19 × [\d.]+ = \d+<!-- credits: speaker-view@19 -->\./)
    expect(Math.ceil((18 * 60 + 44) / 60) * SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE["speaker-view"]).toBe(190)
  })

  it("states the four rates and the formula", () => {
    expect(doc).toMatch(/ceil\(output seconds ÷ 60\)/)
    for (const id of ["speaker-view", "speaker-view:proxy", "speaker-view:complex", "speaker-view:complex:proxy"]) expect(doc).toContain(`<!-- credits-rate: ${id} -->`)
  })
})
