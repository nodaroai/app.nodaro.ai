import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, expect, it, vi } from "vitest"
import {
  assertNoTranspilerHelpers,
  buildPageFunctionSource,
  collectPageSummary,
  computeVerdict,
  FULL_PAGE_MAX_CSS_PX,
  hideConsentOverlays,
  hideFixedForStill,
  planSections,
  runCapture,
  scrollThroughPage,
  STILL_ASPECT,
  type CaptureContextLike,
  type CaptureItem,
  type CapturePage,
  type PageFunctionOptions,
  type PageSummary,
} from "../site-capture-page.js"
import { LANDING, summaryOf } from "./fixtures/site-capture-summaries.js"

const OPTS: PageFunctionOptions = { maxStills: 8, stillAspect: STILL_ASPECT, fullPageMaxCssPx: FULL_PAGE_MAX_CSS_PX, stillFormat: "png" }
const FNS = { collectPageSummary, hideConsentOverlays, scrollThroughPage, hideFixedForStill, planSections, computeVerdict }

/** Minimal DOM stand-ins: enough for each in-page function to run to its end on an empty page. */
function domStubs() {
  const el = () => ({ setAttribute() {}, getAttribute: () => null, style: { setProperty() {} }, scrollHeight: 915, appendChild() {} })
  const document = {
    head: el(),
    body: { ...el(), innerText: "", querySelectorAll: () => [] },
    documentElement: el(),
    title: "",
    createElement: el,
    querySelectorAll: () => [],
  }
  const window = {
    innerWidth: 412,
    innerHeight: 915,
    scrollY: 0,
    devicePixelRatio: 2.625,
    getComputedStyle: () => ({ position: "static", display: "block", visibility: "visible", opacity: "1", fontSize: "16px", fontWeight: "400", direction: "ltr", overflowY: "visible" }),
    matchMedia: () => ({ matches: true }),
    scrollBy() {},
    scrollTo() {},
  }
  return { window, document, navigator: { userAgent: "test" }, setTimeout }
}

/**
 * A one-section page: a <section> holding an h2, a paragraph, an image and a button, plus a fixed
 * cookie banner over the bottom third of the viewport. Enough DOM surface for every element branch
 * of collectPageSummary, hideConsentOverlays and hideFixedForStill to run.
 */
function oneSectionStubs() {
  type Box = { x: number; y: number; width: number; height: number }
  interface StubEl {
    tagName: string
    computed: Record<string, string>
    style: { props: Record<string, string>; setProperty(k: string, v: string): void }
    children: StubEl[]
    childNodes: unknown[]
    innerText: string
    textContent: string
    scrollHeight: number
    getAttribute(name: string): string | null
    setAttribute(): void
    appendChild(): void
    getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number }
    closest(selector: string): null
    contains(other: unknown): boolean
    parentElement: StubEl | null
  }
  const PROPS: Record<string, string> = { display: "display", visibility: "visibility", "overflow-y": "overflowY" }
  function make(tagName: string, box: Box, opts: { text?: string; attrs?: Record<string, string>; computed?: Record<string, string>; children?: StubEl[] } = {}): StubEl {
    const children = opts.children ?? []
    const props: Record<string, string> = {}
    const el: StubEl = {
      tagName,
      computed: { position: "static", fontSize: "16px", fontWeight: "400", ...opts.computed },
      style: { props, setProperty: (k: string, v: string) => { props[k] = v } },
      children,
      childNodes: opts.text ? [{ nodeType: 3, textContent: opts.text }, ...children] : children,
      innerText: opts.text ?? children.map((c) => c.innerText).filter(Boolean).join("\n"),
      textContent: opts.text ?? "",
      scrollHeight: 1800,
      getAttribute: (name: string) => opts.attrs?.[name] ?? null,
      setAttribute() {},
      appendChild() {},
      getBoundingClientRect: () => ({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height }),
      closest: (_selector: string) => null,
      contains: (other) => other === el || children.some((c) => c.contains(other)),
      parentElement: null,
    }
    for (const c of children) c.parentElement = el
    return el
  }
  const h2 = make("H2", { x: 16, y: 140, width: 380, height: 40 }, { text: "Pricing plans", computed: { fontSize: "32px", fontWeight: "700" } })
  const p = make("P", { x: 16, y: 200, width: 380, height: 60 }, { text: "Simple plans for every team" })
  const img = make("IMG", { x: 16, y: 280, width: 380, height: 200 })
  const button = make("BUTTON", { x: 16, y: 500, width: 200, height: 48 }, { text: "Start free" })
  // A scroll-linked story beat: its line is a 24 px / 500 paragraph (1.5 × the 16 px body, medium weight)
  // inside a wrapper the page fades out until the visitor scrolls to it. Two decoys sit beside it.
  const storyLine = make("P", { x: 16, y: 560, width: 380, height: 30 }, { text: "One prompt. Every model.", computed: { fontSize: "24px", fontWeight: "500" } })
  const beat = make("DIV", { x: 0, y: 540, width: 412, height: 80 }, { computed: { opacity: "0" }, children: [storyLine] })
  const subtitle = make("P", { x: 16, y: 630, width: 380, height: 24 }, { text: "A medium subtitle line", computed: { fontSize: "20px", fontWeight: "500" } })
  const lightLine = make("P", { x: 16, y: 660, width: 380, height: 30 }, { text: "A large but light line", computed: { fontSize: "24px", fontWeight: "400" } })
  const section = make("SECTION", { x: 0, y: 100, width: 412, height: 600 }, { children: [h2, p, img, button, beat, subtitle, lightLine] })
  const banner = make("DIV", { x: 0, y: 615, width: 412, height: 300 }, { text: "We use cookies to improve your visit", computed: { position: "fixed" } })
  const all = [section, h2, p, img, button, beat, storyLine, subtitle, lightLine, banner]
  const html = make("HTML", { x: 0, y: 0, width: 412, height: 1800 }, { attrs: { lang: "en" } })
  const body = { ...make("BODY", { x: 0, y: 0, width: 412, height: 1800 }, { children: [section, banner] }), querySelectorAll: (sel: string) => (sel === "*" ? all : []) }
  const document = {
    head: make("HEAD", { x: 0, y: 0, width: 0, height: 0 }),
    body,
    documentElement: html,
    title: "Acme pricing",
    createElement: (tag: string) => make(tag.toUpperCase(), { x: 0, y: 0, width: 0, height: 0 }),
    querySelectorAll: (sel: string) => (sel === "body *" ? all : sel.startsWith("section,") ? [section] : []),
  }
  const window = {
    innerWidth: 412,
    innerHeight: 915,
    scrollY: 0,
    devicePixelRatio: 2.625,
    getComputedStyle: (el: StubEl) => {
      const live = Object.fromEntries(Object.entries(el.style.props).filter(([k]) => k in PROPS).map(([k, v]) => [PROPS[k], v]))
      return { display: "block", visibility: "visible", opacity: "1", direction: "ltr", overflowY: "visible", ...el.computed, ...live }
    },
    matchMedia: () => ({ matches: true }),
    scrollBy() {},
    scrollTo() {},
  }
  return { globals: { window, document, navigator: { userAgent: "test" }, setTimeout }, banner }
}

/**
 * A Playwright-shaped page (or, with `puppeteer: true`, a Puppeteer-shaped one: only
 * `waitForNetworkIdle`) that records what it was asked and answers from a fixture summary.
 */
function fakePage(summary: PageSummary, extra: { lazyTimedOut?: boolean; leftCovering?: boolean; puppeteer?: boolean } = {}) {
  const shots: Array<Record<string, unknown>> = []
  const fake = {
    url: () => summary.finalUrl,
    ...(extra.puppeteer ? { waitForNetworkIdle: vi.fn(async () => undefined) } : { waitForLoadState: vi.fn(async () => undefined) }),
    screenshot: vi.fn(async (o: Record<string, unknown>) => {
      shots.push(o)
      return new Uint8Array([shots.length])
    }),
    evaluate: vi.fn(async (fn: { name?: string }) => {
      if (fn.name === "hideConsentOverlays") return { leftCovering: extra.leftCovering ?? false }
      if (fn.name === "scrollThroughPage") return { timedOut: extra.lazyTimedOut ?? false }
      if (fn.name === "collectPageSummary") return summary
      if (fn.name === "hideFixedForStill") return 0
      return true
    }),
  }
  return { page: fake as unknown as CapturePage, shots }
}

function fakeContext(summary: PageSummary, extra?: Parameters<typeof fakePage>[1]) {
  const writes: Array<{ key: string; contentType: string }> = []
  const { page, shots } = fakePage(summary, extra)
  const context: CaptureContextLike = {
    page,
    response: { status: () => summary.status ?? 200 },
    Actor: { setValue: vi.fn(async (key: string, _v: unknown, o: { contentType: string }) => { writes.push({ key, contentType: o.contentType }) }) },
  }
  return { writes, shots, page, context }
}

describe("self-containment — every stringified function runs in an empty vm context", () => {
  it.each(Object.entries(FNS))("%s compiles on its own", (_name, fn) => {
    const compiled = vm.runInNewContext(`(${fn.toString()})`, {})
    expect(typeof compiled).toBe("function")
  })

  it("planSections and computeVerdict give the same answer inside the vm", () => {
    const summary = summaryOf(LANDING)
    const plan = vm.runInNewContext(`(${planSections.toString()})(summary, opts)`, { summary: structuredClone(summary), opts: { stillAspect: STILL_ASPECT, maxStills: 8 } })
    expect(JSON.parse(JSON.stringify(plan))).toEqual(planSections(summary, { stillAspect: STILL_ASPECT, maxStills: 8 }))
    expect(vm.runInNewContext(`(${computeVerdict.toString()})(summary)`, { summary: structuredClone(summary) })).toBe("ok")
  })

  it("the in-page functions run to their end against DOM stubs and nothing else", async () => {
    const ctx = vm.createContext(domStubs())
    const summary = vm.runInContext(`(${collectPageSummary.toString()})({ status: 200, finalUrl: "https://example.com/" })`, ctx)
    expect(summary).toMatchObject({ status: 200, finalUrl: "https://example.com/", anchors: [], blocks: [], leaves: [], dpr: 2.625, coarsePointer: true })
    expect(vm.runInContext(`(${hideConsentOverlays.toString()})()`, ctx)).toEqual({ leftCovering: false })
    expect(vm.runInContext(`(${hideFixedForStill.toString()})({ keepTopHeader: true, headerMaxPx: 183 })`, ctx)).toBe(0)
    await expect(vm.runInContext(`(${scrollThroughPage.toString()})({ maxSteps: 2, pauseMs: 1, budgetMs: 1000 })`, ctx)).resolves.toEqual({ timedOut: false })
  })

  it("the in-page functions walk every element branch against a one-section page and nothing else", async () => {
    const { globals, banner } = oneSectionStubs()
    const ctx = vm.createContext(globals)
    const summary = vm.runInContext(`(${collectPageSummary.toString()})({ status: 200, finalUrl: "https://example.com/" })`, ctx) as PageSummary
    expect(summary.blocks).toEqual([{ tag: "section", role: null, rect: { x: 0, y: 100, width: 412, height: 600 } }])
    // 24 px / 500 is a heading (1.5 × body, medium weight); 20 px / 500 and 24 px / 400 are not. The line
    // inside the faded wrapper is flagged: a clip of it at rest would be blank.
    expect(summary.anchors).toEqual([
      { text: "Pricing plans", rect: { x: 16, y: 140, width: 380, height: 40 }, fontSize: 32, inChrome: false, landmarks: [0], hidden: false },
      { text: "One prompt. Every model.", rect: { x: 16, y: 560, width: 380, height: 30 }, fontSize: 24, inChrome: false, landmarks: [0], hidden: true },
    ])
    expect([...new Set(summary.leaves.map((l) => l.kind))].sort()).toEqual(["button", "image", "text"])
    expect(summary.leaves.find((l) => l.kind === "button")?.text).toBe("Start free")
    expect(summary).toMatchObject({ title: "Acme pricing", lang: "en", dir: "ltr", pageHeight: 1800, challenge: { markerCount: 0, coverage: 0 } })
    // The banner is fixed and below the top: hidden for a still even when the top header is kept.
    expect(vm.runInContext(`(${hideFixedForStill.toString()})({ keepTopHeader: true, headerMaxPx: 183 })`, ctx)).toBe(1)
    expect(banner.style.props.visibility).toBe("hidden")
    // It covers a third of the viewport and talks about cookies: the consent pass hides it.
    expect(vm.runInContext(`(${hideConsentOverlays.toString()})()`, ctx)).toEqual({ leftCovering: false })
    expect(banner.style.props.display).toBe("none")
  })

  it("the assembled page function compiles and runs end to end inside the vm", async () => {
    const source = buildPageFunctionSource(OPTS)
    expect(source.startsWith("async function pageFunction(context) {")).toBe(true)
    const pageFunction = vm.runInNewContext(`(${source})`, { setTimeout })
    const { context, writes } = fakeContext(summaryOf(LANDING))
    const item = (await pageFunction(context)) as CaptureItem
    expect(item.verdict).toBe("ok")
    expect(writes.map((w) => w.key)).toEqual(["FULL_PAGE", "STILL_0", "STILL_1", "STILL_2", "STILL_3"])
  })
})

describe("transpiler-helper guard — a tsx / esbuild keepNames build never reaches Apify or the browser", () => {
  // vitest's own transform does not inject __name; these pin the guard on the shape tsx emits
  // (`const g=__name(y=>y+1,"g")`), and the "dev build" block below runs it on the real output.
  it("throws on a source that calls __name(", () => {
    expect(() => assertNoTranspilerHelpers('async function pageFunction(context) { const g=__name(y=>y+1,"g"); }')).toThrow(/__name/)
    expect(() => assertNoTranspilerHelpers("const clip = __name((v) => v, \"clip\")")).toThrow(/tsc/)
  })

  it("passes a clean source through unchanged", () => {
    const clean = "async function pageFunction(context) { const g = (y) => y + 1; return g(1) }"
    expect(assertNoTranspilerHelpers(clean)).toBe(clean)
    expect(assertNoTranspilerHelpers("const my__name = 1; rename(x)")).toBe("const my__name = 1; rename(x)")
  })

  it("the assembled source under vitest is clean, so buildPageFunctionSource does not throw", () => {
    expect(() => buildPageFunctionSource(OPTS)).not.toThrow()
    expect(buildPageFunctionSource(OPTS)).not.toMatch(/\b__name\(/)
  })
})

/**
 * The dev build, reproduced: the module compiled by the esbuild that tsx itself loads, with keepNames
 * on as tsx sets it (`npm run dev` is `tsx watch src/server.ts`). The module has no runtime import,
 * so its CommonJS output evaluates in a bare vm context.
 */
function loadDevBuild(): typeof import("../site-capture-page.js") {
  const requireFromHere = createRequire(import.meta.url)
  const requireFromTsx = createRequire(requireFromHere.resolve("tsx/package.json"))
  const esbuild = requireFromTsx("esbuild") as typeof import("esbuild")
  const source = readFileSync(new URL("../site-capture-page.ts", import.meta.url), "utf8")
  const { code } = esbuild.transformSync(source, { loader: "ts", format: "cjs", target: "es2022", keepNames: true })
  const mod = { exports: {} as Record<string, unknown> }
  vm.runInNewContext(code, { module: mod, exports: mod.exports })
  return mod.exports as unknown as typeof import("../site-capture-page.js")
}

describe("the dev build (tsx / esbuild keepNames) — refused before it reaches Apify", () => {
  const dev = loadDevBuild()

  it("the dev build really carries __name in the stringified functions", () => {
    // Without this the two tests below could pass on a build that never had the helper.
    expect(dev.planSections.toString()).toMatch(/\b__name\(/)
    expect(dev.collectPageSummary.toString()).toMatch(/\b__name\(/)
    expect(dev.runCapture.toString()).toMatch(/\b__name\(/)
  })

  it("buildPageFunctionSource refuses the dev build with a message that names the fix", () => {
    expect(() => dev.buildPageFunctionSource(OPTS)).toThrow(/__name/)
    expect(() => dev.buildPageFunctionSource(OPTS)).toThrow(/tsc/)
  })

  it("unguarded, the dev build's page function would crash on its first line at Apify", async () => {
    const runCaptureDev = vm.runInNewContext(`(${dev.runCapture.toString()})`, { setTimeout }) as typeof runCapture
    const { context, writes } = fakeContext(summaryOf(LANDING))
    await expect(runCaptureDev(context, OPTS, FNS)).rejects.toThrow(/__name is not defined/)
    expect(writes).toEqual([])
  })
})

describe("runCapture — one page load", () => {
  it("writes the full page first, then one PNG per still, and returns the section map", async () => {
    const { context, writes, shots } = fakeContext(summaryOf(LANDING))
    const item = await runCapture(context, OPTS, FNS)
    expect(writes[0]).toEqual({ key: "FULL_PAGE", contentType: "image/jpeg" })
    expect(writes.slice(1).map((w) => w.contentType)).toEqual(["image/png", "image/png", "image/png", "image/png"])
    expect(shots[0]).toMatchObject({ fullPage: true, scale: "css", type: "jpeg", quality: 80 })
    expect(shots[1]).toMatchObject({ type: "png", clip: { x: 0, y: 0, width: 412, height: 490 } })
    expect(item).toMatchObject({ verdict: "ok", status: 200, dir: "ltr", device: { width: 412, height: 915, dpr: 2.625 }, fullPage: { key: "FULL_PAGE", truncated: false } })
    expect(item.stills.map((s) => [s.key, s.category])).toEqual([["STILL_0", "hero"], ["STILL_1", "feature"], ["STILL_2", "pricing"], ["STILL_3", "proof"]])
    expect(item.sections).toHaveLength(6)
  })

  it("a walled page writes the full page and no still", async () => {
    const { context, writes } = fakeContext({ ...summaryOf(LANDING), title: "Just a moment..." })
    const item = await runCapture(context, OPTS, FNS)
    expect(item.verdict).toBe("blocked")
    expect(writes.map((w) => w.key)).toEqual(["FULL_PAGE"])
    expect(item.stills).toEqual([])
    expect(item.sections).toEqual([])
  })

  it("a page taller than the cap is clipped and says so", async () => {
    const { context, shots } = fakeContext({ ...summaryOf(LANDING), pageHeight: 25_000 })
    const item = await runCapture(context, OPTS, FNS)
    expect(shots[0]).toMatchObject({ clip: { x: 0, y: 0, width: 412, height: FULL_PAGE_MAX_CSS_PX } })
    expect(item.fullPage.truncated).toBe(true)
    expect(item.warnings).toContain("full_page_truncated")
  })

  it("reports a consent overlay left behind and a lazy-content timeout", async () => {
    const { context } = fakeContext(summaryOf(LANDING), { leftCovering: true, lazyTimedOut: true })
    const item = await runCapture(context, OPTS, FNS)
    expect(item.warnings).toEqual(expect.arrayContaining(["consent_overlay_left", "lazy_content_timeout"]))
  })

  it("JPEG stills when the spike switched them", async () => {
    const { context, writes } = fakeContext(summaryOf(LANDING))
    await runCapture(context, { ...OPTS, stillFormat: "jpeg" }, FNS)
    expect(writes[1]).toEqual({ key: "STILL_0", contentType: "image/jpeg" })
  })

  it("uses the context's own setValue when there is no Actor object", async () => {
    const { page } = fakeContext(summaryOf(LANDING))
    const setValue = vi.fn(async () => undefined)
    await runCapture({ page, response: null, setValue }, OPTS, FNS)
    expect(setValue).toHaveBeenCalledWith("FULL_PAGE", expect.anything(), { contentType: "image/jpeg" })
  })
})

describe("runCapture on a Puppeteer page (apify/puppeteer-scraper, spike arm S-B2)", () => {
  // Puppeteer throws "'clip' and 'fullPage' are mutually exclusive" and has no scale option.
  it("waits with waitForNetworkIdle; every still carries clip with no fullPage and no scale", async () => {
    const { context, shots, page } = fakeContext(summaryOf(LANDING), { puppeteer: true })
    const item = await runCapture(context, OPTS, FNS)
    expect((page as unknown as { waitForNetworkIdle: ReturnType<typeof vi.fn> }).waitForNetworkIdle).toHaveBeenCalled()
    expect(shots[0]).toEqual({ fullPage: true, type: "jpeg", quality: 80 })
    expect(item.stills).toHaveLength(4)
    expect(shots.slice(1)).toHaveLength(4)
    expect(shots[1]).toEqual({ clip: { x: 0, y: 0, width: 412, height: 490 }, type: "png" })
    for (const shot of shots.slice(1)) {
      expect(shot).toHaveProperty("clip")
      expect(shot).not.toHaveProperty("fullPage")
      expect(shot).not.toHaveProperty("scale")
    }
  })

  it("a truncated full page is a clip with no fullPage and no scale", async () => {
    const { context, shots } = fakeContext({ ...summaryOf(LANDING), pageHeight: 25_000 }, { puppeteer: true })
    const item = await runCapture(context, OPTS, FNS)
    expect(shots[0]).toEqual({ clip: { x: 0, y: 0, width: 412, height: FULL_PAGE_MAX_CSS_PX }, type: "jpeg", quality: 80 })
    expect(item.fullPage.truncated).toBe(true)
    expect(item.warnings).toContain("full_page_truncated")
  })

  it("JPEG stills on Puppeteer keep their quality and still drop fullPage", async () => {
    const { context, shots } = fakeContext(summaryOf(LANDING), { puppeteer: true })
    await runCapture(context, { ...OPTS, stillFormat: "jpeg" }, FNS)
    expect(shots[1]).toEqual({ clip: { x: 0, y: 0, width: 412, height: 490 }, type: "jpeg", quality: 90 })
  })
})
