import vm from "node:vm"
import { describe, expect, it, vi } from "vitest"
import {
  buildPageFunctionSource,
  collectPageSummary,
  computeVerdict,
  hideConsentOverlays,
  hideFixedForStill,
  measureStillShare,
  planFallbackStills,
  planSections,
  runCapture,
  scrollThroughPage,
  STILL_ASPECT,
  type CaptureContextLike,
  type CapturePage,
  type PageFunctionOptions,
  type PageSummary,
} from "../site-capture-page.js"
import { LANDING, summaryOf, VW } from "./fixtures/site-capture-summaries.js"

const OPTS: PageFunctionOptions = { maxStills: 8, stillAspect: STILL_ASPECT, fullPageMaxCssPx: 20_000, stillFormat: "png" }
const FNS = { collectPageSummary, hideConsentOverlays, scrollThroughPage, hideFixedForStill, planSections, computeVerdict, measureStillShare, planFallbackStills }

/** A page whose n-th screenshot (1 = the full page) comes back as the byte [n]; `blank` lists the shots that measure as one flat colour. */
function pageOf(summary: PageSummary, blank: readonly number[], measured: "share" | "null" = "share") {
  const shots: Array<Record<string, unknown>> = []
  const fake = {
    url: () => summary.finalUrl,
    waitForLoadState: vi.fn(async () => undefined),
    screenshot: vi.fn(async (o: Record<string, unknown>) => {
      shots.push(o)
      return new Uint8Array([shots.length])
    }),
    evaluate: vi.fn(async (fn: { name?: string }, arg?: { base64?: string }) => {
      if (fn.name === "hideConsentOverlays") return { leftCovering: false }
      if (fn.name === "scrollThroughPage") return { timedOut: false }
      if (fn.name === "collectPageSummary") return summary
      if (fn.name === "hideFixedForStill") return 0
      if (fn.name === "measureStillShare") {
        if (measured === "null") return null
        const shot = Buffer.from(arg!.base64!, "base64")[0]!
        return { dominantShare: blank.includes(shot) ? 1 : 0.42 }
      }
      return true
    }),
  }
  const writes: Array<{ key: string; bytes: number[] }> = []
  const context: CaptureContextLike = {
    page: fake as unknown as CapturePage,
    response: { status: () => 200 },
    Actor: { setValue: vi.fn(async (key: string, v: unknown) => { writes.push({ key, bytes: Array.from(v as Uint8Array) }) }) },
  }
  return { context, shots, writes }
}

describe("planFallbackStills — the next candidate sections, in the order the plan would have taken them", () => {
  const summary = summaryOf(LANDING)
  const plan = planSections(summary, { stillAspect: STILL_ASPECT, maxStills: 8 })
  const geometry = { viewportWidth: VW, pageHeight: summary.pageHeight }

  it("lists only sections that have no still, as full-width card rectangles", () => {
    const more = planFallbackStills(plan, geometry, { stillAspect: STILL_ASPECT })
    const taken = new Set(plan.stills.map((s) => s.sectionOrder))
    for (const s of more) {
      expect(taken.has(s.sectionOrder)).toBe(false)
      expect(s.rect).toMatchObject({ x: 0, width: VW, height: Math.round(VW / STILL_ASPECT) })
    }
  })

  it("never overlaps a planned still, or an earlier fallback, by more than 40 %", () => {
    const more = planFallbackStills(plan, geometry, { stillAspect: STILL_ASPECT })
    const all = [...plan.stills, ...more]
    const share = (a: { y: number; height: number }, b: { y: number; height: number }) => {
      const inter = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      return inter <= 0 ? 0 : inter / Math.min(a.height, b.height)
    }
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => expect(share(a.rect, b.rect)).toBeLessThanOrEqual(0.4)))
  })

  it("takes key sections first (page order), then filler with the FAQ last", () => {
    const sections = [
      { order: 0, label: "Hero", category: "hero", kind: "key", rect: { x: 0, y: 0, width: VW, height: 900 }, text: "", stillIndex: 0 },
      { order: 1, label: "Questions", category: "faq", kind: "filler", rect: { x: 0, y: 1000, width: VW, height: 600 }, text: "", stillIndex: null },
      { order: 2, label: "Go", category: "cta", kind: "filler", rect: { x: 0, y: 1700, width: VW, height: 600 }, text: "", stillIndex: null },
      { order: 3, label: "Prices", category: "pricing", kind: "key", rect: { x: 0, y: 2400, width: VW, height: 600 }, text: "", stillIndex: null },
      { order: 4, label: "Proof", category: "proof", kind: "key", rect: { x: 0, y: 3100, width: VW, height: 600 }, text: "", stillIndex: null },
    ] as const
    const only = { sections: [...sections], stills: [{ index: 0, sectionOrder: 0, label: "Hero", category: "hero" as const, rect: { x: 0, y: 0, width: VW, height: 490 } }] }
    const more = planFallbackStills(only, { viewportWidth: VW, pageHeight: 3700 }, { stillAspect: STILL_ASPECT })
    expect(more.map((s) => s.label)).toEqual(["Prices", "Proof", "Go", "Questions"])
    expect(more[0]!.rect.y).toBe(2400 - 24)
  })

  it("clamps the rectangle at the page bottom", () => {
    const only = {
      sections: [{ order: 0, label: "Last", category: "feature" as const, kind: "key" as const, rect: { x: 0, y: 3500, width: VW, height: 200 }, text: "", stillIndex: null }],
      stills: [],
    }
    const [last] = planFallbackStills(only, { viewportWidth: VW, pageHeight: 3700 }, { stillAspect: STILL_ASPECT })
    expect(last!.rect.y + last!.rect.height).toBeLessThanOrEqual(3700)
  })

  it("is empty when every section already has a still", () => {
    const one = { sections: plan.sections.slice(0, 1), stills: plan.stills.slice(0, 1) }
    expect(planFallbackStills(one, geometry, { stillAspect: STILL_ASPECT })).toEqual([])
  })
})

describe("runCapture — a still with no content is skipped and the budget moves on", () => {
  const summary = summaryOf(LANDING)
  const plannedCount = planSections(summary, { stillAspect: STILL_ASPECT, maxStills: 8 }).stills.length

  it("with no blank still, behaves exactly as before: STILL_0..n-1, no warning", async () => {
    const { context, writes } = pageOf(summary, [])
    const item = await runCapture(context, OPTS, FNS)
    expect(writes.map((w) => w.key)).toEqual(["FULL_PAGE", ...Array.from({ length: plannedCount }, (_, i) => `STILL_${i}`)])
    expect(item.warnings.filter((w) => w.startsWith("still_blank_skipped"))).toEqual([])
  })

  it("drops a blank still, never writes it, and tries the next candidate section", async () => {
    // Shot 1 is the full page; shot 3 is the second still.
    const { context, writes, shots } = pageOf(summary, [3])
    const item = await runCapture(context, OPTS, FNS)
    const stillWrites = writes.filter((w) => w.key !== "FULL_PAGE")
    expect(stillWrites.every((w) => w.bytes[0] !== 3)).toBe(true)
    // The budget is the planned count: a replacement was shot (one more screenshot than stills kept).
    expect(item.stills.length).toBe(Math.min(plannedCount, shots.length - 1 - 1))
    expect(item.warnings.some((w) => w.startsWith("still_blank_skipped:"))).toBe(true)
  })

  it("renumbers the kept stills 0..n-1 in page order and points the section map at them", async () => {
    const { context, writes } = pageOf(summary, [2])
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills.map((s) => s.index)).toEqual(item.stills.map((_, i) => i))
    expect(item.stills.map((s) => s.key)).toEqual(item.stills.map((_, i) => `STILL_${i}`))
    const orders = item.stills.map((s) => s.sectionOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    for (const s of item.stills) expect(item.sections[s.sectionOrder]!.stillIndex).toBe(s.index)
    expect(item.sections.filter((s) => s.stillIndex !== null)).toHaveLength(item.stills.length)
    expect(writes.filter((w) => w.key !== "FULL_PAGE")).toHaveLength(item.stills.length)
  })

  it("every still blank: no still is written, only the warnings say why, and the attempts are capped", async () => {
    const { context, shots, writes } = pageOf(summary, Array.from({ length: 40 }, (_, i) => i + 2))
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills).toEqual([])
    expect(writes.map((w) => w.key)).toEqual(["FULL_PAGE"])
    expect(shots.length - 1).toBeLessThanOrEqual(plannedCount + 6)
    expect(item.verdict).toBe("ok")
  })

  it("a measurement that cannot be taken keeps the still (a decode failure never costs a good one)", async () => {
    const { context, writes } = pageOf(summary, [], "null")
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills).toHaveLength(plannedCount)
    expect(writes).toHaveLength(plannedCount + 1)
  })

  it("a flat colour is blank at 99.5 % of the pixels, not before", async () => {
    const run = async (share: number) => {
      const { context } = pageOf(summary, [])
      ;(context.page as unknown as { evaluate: ReturnType<typeof vi.fn> }).evaluate.mockImplementation(async (fn: { name?: string }) => {
        if (fn.name === "collectPageSummary") return summary
        if (fn.name === "hideConsentOverlays") return { leftCovering: false }
        if (fn.name === "scrollThroughPage") return { timedOut: false }
        if (fn.name === "measureStillShare") return { dominantShare: share }
        return 0
      })
      return runCapture(context, OPTS, FNS)
    }
    expect((await run(0.994)).stills).toHaveLength(plannedCount)
    expect((await run(0.995)).stills).toEqual([])
  })

  it("the assembled page function carries the filter and runs inside an empty vm", async () => {
    const source = buildPageFunctionSource(OPTS)
    const pageFunction = vm.runInNewContext(`(${source})`, { setTimeout, Buffer })
    const { context, writes } = pageOf(summary, [3])
    const item = await pageFunction(context)
    expect(item.warnings.some((w: string) => w.startsWith("still_blank_skipped:"))).toBe(true)
    expect(writes.some((w) => w.bytes[0] === 3)).toBe(false)
  })
})

describe("measureStillShare — runs in the browser, on the still's own pixels", () => {
  /** A browser stand-in: an image of w x h whose pixels come from `rgba`. */
  function browser(w: number, h: number, pixel: (i: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = pixel(i)
      data.set([r, g, b, 255], i * 4)
    }
    return vm.createContext({
      atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
      Blob: class { constructor(readonly parts: unknown[]) {} },
      createImageBitmap: async () => ({ width: w, height: h, close() {} }),
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) },
    })
  }
  const run = (ctx: vm.Context) => vm.runInContext(`(${measureStillShare.toString()})({ base64: "AAAA", mime: "image/png" })`, ctx) as Promise<{ dominantShare: number } | null>

  it("a single flat colour is 1", async () => expect((await run(browser(100, 100, () => [250, 248, 240])))?.dominantShare).toBe(1))

  it("noise below the 5-bit quantisation does not break a flat colour", async () => {
    const r = await run(browser(100, 100, (i) => [250 - (i % 3), 248, 240]))
    expect(r!.dominantShare).toBe(1)
  })

  it("a thin bar across a flat page (the allbirds loading bar, under half a percent of the pixels) leaves the share above 0.995", async () => {
    const r = await run(browser(100, 400, (i) => (i < 100 * 1 ? [20, 20, 20] : [240, 235, 225])))
    expect(r!.dominantShare).toBeCloseTo(0.9975, 4)
  })

  it("a page with real content is far from 1", async () => {
    const r = await run(browser(100, 100, (i) => (i % 2 === 0 ? [255, 255, 255] : [0, 0, 0])))
    expect(r!.dominantShare).toBe(0.5)
  })

  it("returns null when the image cannot be decoded", async () => {
    const ctx = vm.createContext({
      atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
      Blob: class {},
      createImageBitmap: async () => { throw new Error("decode") },
      document: { createElement: () => ({}) },
    })
    expect(await run(ctx)).toBeNull()
  })
})
