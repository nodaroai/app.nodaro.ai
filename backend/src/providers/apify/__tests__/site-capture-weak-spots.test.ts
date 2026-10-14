/**
 * Three weak spots of the page script, each with a regression fixture:
 *  - sections a page paints only on screen (a fade-in on scroll, a canvas, a lazy image) were shot from the top of
 *    the page and came back blank, or were never planned because their heading is faded out at rest;
 *  - a still that is mostly one empty band (a heading over an image that never loaded) was kept;
 *  - the page text the facts are read from (collectPageSummary's leafText and bodyText cut).
 * Everything runs offline against stand-ins; nothing loads a real page.
 */
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
  scrollToStill,
  stillHeadingShown,
  STILL_ASPECT,
  type CaptureContextLike,
  type CapturePage,
  type PageFunctionOptions,
  type PageSummary,
  type Rect,
} from "../site-capture-page.js"
import { LANDING, summaryOf, VH, type SectionSpec } from "./fixtures/site-capture-summaries.js"

const OPTS: PageFunctionOptions = { maxStills: 8, stillAspect: STILL_ASPECT, fullPageMaxCssPx: 20_000, stillFormat: "png", timing: { settleMs: 0, reshootMs: 0, stillsBudgetMs: 45_000 } }
const FNS = { collectPageSummary, hideConsentOverlays, scrollThroughPage, hideFixedForStill, planSections, computeVerdict, measureStillShare, planFallbackStills, scrollToStill, stillHeadingShown }

/**
 * A page that paints a section only while it is on screen, the way a fade-in-on-scroll page does: a still comes back
 * as content (dominantShare 0.4) only when the last scroll put its rectangle inside the viewport, and as one flat
 * colour otherwise. `headings` answers stillHeadingShown per label; a label not listed answers "not found".
 */
function onScreenPage(summary: PageSummary, headings: Record<string, { found: boolean; shown: boolean }> = {}) {
  let scrollY = 0
  const shots: Array<{ rect: Rect; onScreen: boolean }> = []
  const flat = new Set<number>()
  const fake = {
    url: () => summary.finalUrl,
    waitForLoadState: vi.fn(async () => undefined),
    screenshot: vi.fn(async (o: Record<string, unknown>) => {
      const rect = o.clip as Rect | undefined
      const onScreen = rect !== undefined && rect.y >= scrollY && rect.y + rect.height <= scrollY + VH
      shots.push({ rect: rect ?? { x: 0, y: 0, width: 0, height: 0 }, onScreen })
      if (rect !== undefined && !onScreen) flat.add(shots.length)
      return new Uint8Array([shots.length])
    }),
    evaluate: vi.fn(async (fn: { name?: string }, arg?: Record<string, unknown>) => {
      if (fn.name === "hideConsentOverlays") return { leftCovering: false }
      if (fn.name === "scrollThroughPage") return { timedOut: false }
      if (fn.name === "collectPageSummary") return summary
      if (fn.name === "hideFixedForStill") return 0
      if (fn.name === "scrollToStill") {
        const y = arg!.y as number
        const height = arg!.height as number
        scrollY = Math.max(0, Math.round(y + height / 2 - VH / 2))
        return scrollY
      }
      if (fn.name === "stillHeadingShown") return headings[arg!.label as string] ?? { found: false, shown: false }
      if (fn.name === "measureStillShare") {
        const shot = Buffer.from(arg!.base64 as string, "base64")[0]!
        return { dominantShare: flat.has(shot) ? 1 : 0.4, flatBand: 0 }
      }
      return undefined
    }),
  }
  const writes: string[] = []
  const context: CaptureContextLike = {
    page: fake as unknown as CapturePage,
    response: { status: () => 200 },
    Actor: { setValue: vi.fn(async (key: string) => { writes.push(key) }) },
  }
  return { context, shots, writes }
}

describe("runCapture — every still is shot with its section on screen", () => {
  it("a page that paints only what is on screen gives a still per planned section, none blank", async () => {
    const summary = summaryOf(LANDING)
    const planned = planSections(summary, OPTS).stills.length
    const { context, shots } = onScreenPage(summary)
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills).toHaveLength(planned)
    expect(item.warnings.filter((w) => w.startsWith("still_blank_skipped"))).toEqual([])
    // Every still shot (all but the full page) had its rectangle inside the viewport.
    expect(shots.slice(1).every((s) => s.onScreen)).toBe(true)
  })

  it("scrolls back to the top once the stills are shot", async () => {
    const { context } = onScreenPage(summaryOf(LANDING))
    await runCapture(context, OPTS, FNS)
    const calls = (context.page as unknown as { evaluate: ReturnType<typeof vi.fn> }).evaluate.mock.calls
    const last = calls[calls.length - 1]![0] as { toString(): string }
    expect(last.toString()).toMatch(/scrollTo\(0, 0\)/)
  })
})

describe("runCapture — sections whose heading is faded out at rest", () => {
  // A fade-in page: every section below the hero has its heading at opacity 0 until it scrolls into view.
  const FADING: SectionSpec[] = LANDING.map((s, i) => (i === 0 ? s : { ...s, hidden: true }))

  it("the planner alone gives the hero only (the rule that keeps a pinned story's chapters out)", () => {
    expect(planSections(summaryOf(FADING), OPTS).stills.map((s) => s.category)).toEqual(["hero"])
  })

  it("a heading that shows once its section is on screen gets its still", async () => {
    const summary = summaryOf(FADING)
    const shown = Object.fromEntries(FADING.map((s) => [s.title, { found: true, shown: true }]))
    const { context } = onScreenPage(summary, shown)
    const item = await runCapture(context, OPTS, FNS)
    const asIfShown = planSections(summaryOf(LANDING), OPTS).stills.map((s) => s.label)
    expect(item.stills.map((s) => s.label)).toEqual(asIfShown)
    expect(item.stills.length).toBeGreaterThan(1)
  })

  it("a heading that stays faded, or shows elsewhere, is never shot under its label (a carousel slide, a pinned chapter)", async () => {
    const summary = summaryOf(FADING)
    const headings = Object.fromEntries(FADING.map((s, i) => [s.title, { found: true, shown: i !== 2 }]))
    const { context } = onScreenPage(summary, headings)
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills.map((s) => s.label)).not.toContain(FADING[2]!.title)
    expect(item.warnings).toContain("still_hidden_skipped:2")
  })

  it("a page with no faded heading plans exactly as before", async () => {
    const summary = summaryOf(LANDING)
    const { context } = onScreenPage(summary)
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills.map((s) => s.sectionOrder)).toEqual(planSections(summary, OPTS).stills.map((s) => s.sectionOrder))
  })

  it("the run budget, counted from the script's start, stops the stills too", async () => {
    const { context } = onScreenPage(summaryOf(LANDING))
    const item = await runCapture(context, { ...OPTS, timing: { settleMs: 0, reshootMs: 0, stillsBudgetMs: 45_000, runBudgetMs: -1 } }, FNS)
    expect(item.stills).toEqual([])
    expect(item.warnings).toContain("stills_time_budget")
  })

  it("the time budget stops the stills and keeps what was shot", async () => {
    const summary = summaryOf(LANDING)
    const { context } = onScreenPage(summary)
    const item = await runCapture(context, { ...OPTS, timing: { settleMs: 0, reshootMs: 0, stillsBudgetMs: -1 } }, FNS)
    expect(item.stills).toEqual([])
    expect(item.warnings).toContain("stills_time_budget")
  })
})

describe("runCapture — a blank still is shot once more before it is skipped", () => {
  function page(blank: readonly number[], share: { dominantShare: number; flatBand?: number } | null = null) {
    const summary = summaryOf(LANDING)
    const shots: number[] = []
    const fake = {
      url: () => summary.finalUrl,
      waitForLoadState: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => {
        shots.push(shots.length + 1)
        return new Uint8Array([shots.length])
      }),
      evaluate: vi.fn(async (fn: { name?: string }, arg?: { base64?: string }) => {
        if (fn.name === "collectPageSummary") return summary
        if (fn.name === "hideConsentOverlays") return { leftCovering: false }
        if (fn.name === "scrollThroughPage") return { timedOut: false }
        if (fn.name === "measureStillShare") {
          if (share) return share
          const shot = Buffer.from(arg!.base64!, "base64")[0]!
          return { dominantShare: blank.includes(shot) ? 1 : 0.4, flatBand: 0 }
        }
        return undefined
      }),
    }
    const context: CaptureContextLike = { page: fake as unknown as CapturePage, response: { status: () => 200 }, Actor: { setValue: vi.fn(async () => undefined) } }
    return { context, shots, planned: planSections(summary, OPTS).stills.length }
  }

  it("lazy content that arrives by the second try keeps the section", async () => {
    // Shot 1 is the full page, shot 2 the hero, shot 3 the second still; shot 4 is its second try.
    const { context, shots, planned } = page([3])
    const item = await runCapture(context, OPTS, FNS)
    expect(item.stills).toHaveLength(planned)
    expect(item.stills[1]!.sectionOrder).toBe(planSections(summaryOf(LANDING), OPTS).stills[1]!.sectionOrder)
    expect(item.warnings.filter((w) => w.startsWith("still_blank_skipped"))).toEqual([])
    expect(shots).toHaveLength(1 + planned + 1)
  })

  it("a still that is mostly one empty band is blank at flatBand 0.5, not before", async () => {
    expect((await runCapture(page([], { dominantShare: 0.9, flatBand: 0.49 }).context, OPTS, FNS)).stills.length).toBeGreaterThan(0)
    expect((await runCapture(page([], { dominantShare: 0.9, flatBand: 0.5 }).context, OPTS, FNS)).stills).toEqual([])
  })

  it("an older measurement with no flatBand is read by its dominant share alone", async () => {
    expect((await runCapture(page([], { dominantShare: 0.9 }).context, OPTS, FNS)).stills.length).toBeGreaterThan(0)
  })
})

describe("measureStillShare — flatBand, the tallest run of flat rows", () => {
  /** A browser stand-in decoding to a w x h image whose pixel at (x, y) is `pixel(x, y)`. */
  function browser(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...pixel(x, y), 255], (y * w + x) * 4)
    return vm.createContext({
      atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
      Blob: class { constructor(readonly parts: unknown[]) {} },
      createImageBitmap: async () => ({ width: w, height: h, close() {} }),
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) },
    })
  }
  const run = (ctx: vm.Context) =>
    vm.runInContext(`(${measureStillShare.toString()})({ base64: "AAAA", mime: "image/png" })`, ctx) as Promise<{ dominantShare: number; flatBand: number } | null>
  const BLACK: [number, number, number] = [0, 0, 0]
  const WHITE: [number, number, number] = [255, 255, 255]
  /** Text: alternate 2 px white strokes with black inside a line box. */
  const text = (x: number): [number, number, number] => (x % 6 < 2 ? WHITE : BLACK)

  it("a heading and one line over an empty black band (a lazy image that never loaded) is about 0.77", async () => {
    // 100 rows: lines of text in rows 8–20, then empty black to the bottom.
    const r = await run(browser(120, 100, (x, y) => (y >= 8 && y < 21 && y % 4 !== 3 ? text(x) : BLACK)))
    expect(r!.flatBand).toBeCloseTo(0.79, 2)
    expect(r!.dominantShare).toBeGreaterThan(0.85)
  })

  it("a dark page whose content runs down the whole still stays far under 0.5", async () => {
    // A line of text every 12 rows: no empty band taller than the gap between lines.
    const r = await run(browser(120, 120, (x, y) => (y % 12 < 6 ? text(x) : BLACK)))
    expect(r!.flatBand).toBeLessThan(0.1)
  })

  it("an empty vertical gradient (no content, a different colour per row) is all one band", async () => {
    const r = await run(browser(60, 100, (_x, y) => [y * 2, y * 2, 255]))
    expect(r!.flatBand).toBe(1)
    expect(r!.dominantShare).toBeLessThan(0.1)
  })

  it("a thin loading bar at the top of a flat page is still one band below it", async () => {
    const r = await run(browser(100, 400, (_x, y) => (y < 2 ? [20, 20, 20] : [240, 235, 225])))
    expect(r!.flatBand).toBe(1)
  })

  it("a row with one stray pixel in a hundred is still flat; two in a hundred is not", async () => {
    const one = await run(browser(100, 10, (x) => (x === 0 ? WHITE : BLACK)))
    const two = await run(browser(100, 10, (x) => (x < 2 ? WHITE : BLACK)))
    expect(one!.flatBand).toBe(1)
    expect(two!.flatBand).toBe(0)
  })
})

describe("stillHeadingShown — runs in the page", () => {
  interface Node {
    tagName: string
    textContent: string
    parentElement: Node | null
    opacity: string
    visibility: string
    box: { top: number; height: number; width: number }
  }
  /** A stand-in DOM: elements with a box (viewport coordinates) and text, each with one text node. */
  function dom(scrollY: number, els: Array<{ text: string; top: number; opacity?: string; visibility?: string; parentOpacity?: string }>) {
    const html: Node = { tagName: "HTML", textContent: "", parentElement: null, opacity: "1", visibility: "visible", box: { top: 0, height: 0, width: 0 } }
    const body: Node = { tagName: "BODY", textContent: els.map((e) => e.text).join(""), parentElement: html, opacity: "1", visibility: "visible", box: { top: 0, height: 0, width: 0 } }
    const nodes = els.map((e) => {
      const wrap: Node = { tagName: "DIV", textContent: e.text, parentElement: body, opacity: e.parentOpacity ?? "1", visibility: "visible", box: { top: e.top, height: 40, width: 380 } }
      const h: Node = { tagName: "H2", textContent: e.text, parentElement: wrap, opacity: e.opacity ?? "1", visibility: e.visibility ?? "visible", box: { top: e.top, height: 40, width: 380 } }
      return { h, wrap }
    })
    const textNodes = nodes.map(({ h }) => ({ textContent: h.textContent, parentElement: h }))
    const contains = (a: Node, b: Node): boolean => {
      for (let n: Node | null = b; n; n = n.parentElement) if (n === a) return true
      return false
    }
    const decorate = (n: Node) =>
      Object.assign(n, {
        getBoundingClientRect: () => ({ top: n.box.top, height: n.box.height, width: n.box.width }),
        contains: (o: Node) => contains(n, o),
      })
    ;[html, body, ...nodes.flatMap((x) => [x.h, x.wrap])].forEach(decorate)
    return vm.createContext({
      window: { scrollY, getComputedStyle: (n: Node) => ({ opacity: n.opacity, visibility: n.visibility, display: "block" }) },
      document: {
        body,
        documentElement: html,
        createTreeWalker: () => {
          let i = -1
          return { nextNode: () => (++i < textNodes.length ? textNodes[i] : null) }
        },
      },
    })
  }
  const check = (ctx: vm.Context, rect: Rect, label: string) =>
    vm.runInContext(`(${stillHeadingShown.toString()})(${JSON.stringify({ rect, label })})`, ctx) as { found: boolean; shown: boolean }
  const RECT: Rect = { x: 0, y: 3000, width: 412, height: 490 }

  it("an opaque heading inside the still's rectangle shows", () => {
    // Scrolled to 2800: a heading 300 px down the viewport is at 3,100 in the page.
    expect(check(dom(2800, [{ text: "Meet Callie, your AI assistant", top: 300 }]), RECT, "Meet Callie, your AI assistant")).toEqual({ found: true, shown: true })
  })

  it("a heading still faded out (its own or an ancestor's opacity) does not show", () => {
    expect(check(dom(2800, [{ text: "Meet Callie", top: 300, opacity: "0" }]), RECT, "Meet Callie")).toEqual({ found: true, shown: false })
    expect(check(dom(2800, [{ text: "Meet Callie", top: 300, parentOpacity: "0.2" }]), RECT, "Meet Callie")).toEqual({ found: true, shown: false })
    expect(check(dom(2800, [{ text: "Meet Callie", top: 300, visibility: "hidden" }]), RECT, "Meet Callie")).toEqual({ found: true, shown: false })
  })

  it("a heading that shows somewhere else on screen (a pinned stage) does not show for this still", () => {
    expect(check(dom(2800, [{ text: "One prompt. Every model.", top: 20 }]), RECT, "One prompt. Every model.")).toEqual({ found: true, shown: false })
  })

  it("matches regardless of case and spacing (a heading set in capitals by CSS), and a 60-character label by its start", () => {
    const long = "The product development system for teams and agents, purpose-built for planning"
    expect(check(dom(2800, [{ text: "ONE  PROMPT.\nEVERY MODEL.", top: 300 }]), RECT, "one prompt. every model.").shown).toBe(true)
    expect(check(dom(2800, [{ text: long, top: 300 }]), RECT, Array.from(long).slice(0, 60).join("")).shown).toBe(true)
  })

  it("a label no element carries is not found, so the still is shot", () => {
    expect(check(dom(2800, [{ text: "Something else", top: 300 }]), RECT, "Meet Callie")).toEqual({ found: false, shown: false })
  })
})

describe("the assembled page function", () => {
  it("carries scrollToStill and stillHeadingShown and runs inside an empty vm", async () => {
    const source = buildPageFunctionSource(OPTS)
    expect(source).toContain("scrollToStill: async function scrollToStill")
    expect(source).toContain("stillHeadingShown: function stillHeadingShown")
    const pageFunction = vm.runInNewContext(`(${source})`, { setTimeout, Buffer, Date })
    const { context, shots } = onScreenPage(summaryOf(LANDING))
    const item = await pageFunction(context)
    expect(item.stills.length).toBeGreaterThan(0)
    expect(shots.slice(1).every((s) => s.onScreen)).toBe(true)
  })

  it("production waits are the defaults when no timing is passed", () => {
    const source = buildPageFunctionSource({ maxStills: 8, stillAspect: STILL_ASPECT, fullPageMaxCssPx: 20_000, stillFormat: "png" })
    expect(source).not.toContain('"timing"')
    expect(source).toMatch(/opts\.timing \? opts\.timing\.settleMs : 400/)
  })
})

describe("collectPageSummary — the page text is cut between words", () => {
  function page(bodyText: string) {
    const el = () => ({ setAttribute() {}, getAttribute: () => null, style: { setProperty() {} }, scrollHeight: 915, appendChild() {} })
    return vm.createContext({
      window: {
        innerWidth: 412,
        innerHeight: 915,
        scrollY: 0,
        devicePixelRatio: 2.625,
        getComputedStyle: () => ({ position: "static", display: "block", visibility: "visible", opacity: "1", fontSize: "16px", fontWeight: "400", direction: "ltr" }),
        matchMedia: () => ({ matches: true }),
      },
      document: { head: el(), body: { ...el(), innerText: bodyText, querySelectorAll: () => [] }, documentElement: el(), title: "", querySelectorAll: () => [] },
      navigator: { userAgent: "test" },
    })
  }
  const summarize = (ctx: vm.Context) => vm.runInContext(`(${collectPageSummary.toString()})({ status: 200, finalUrl: "https://example.com/" })`, ctx) as PageSummary

  it("a text over 12,000 characters never ends inside a word (a cut figure line read as \"23,100 Re\")", () => {
    const text = `${"lorem ".repeat(1998)}23,100 Resources and more`
    const s = summarize(page(text))
    expect(s.bodyText.length).toBeLessThanOrEqual(12_000)
    expect(s.bodyText.endsWith("23,100")).toBe(true)
    expect(s.visibleTextLength).toBe(text.length)
  })

  it("a text under the cap is kept whole", () => {
    expect(summarize(page("Only $6/month")).bodyText).toBe("Only $6/month")
  })
})
