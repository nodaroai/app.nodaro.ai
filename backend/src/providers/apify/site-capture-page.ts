/**
 * Site Capture's page script, as pure functions.
 *
 * Every function marked STRINGIFIED is copied into the Apify page function
 * with Function.prototype.toString (buildPageFunctionSource), so it must be
 * self-contained: no imports, no module constants, no helper defined outside
 * its own body. site-capture-page-function.test.ts runs each one in an empty
 * vm context to prove it for the tsc build that production runs. A tsx /
 * esbuild keepNames build (the dev server) wraps inner functions in a
 * `__name` helper the page never has; assertNoTranspilerHelpers refuses that
 * source before it is sent. Types are erased at build time and are free to use.
 *
 * Coordinates are document CSS px at the phone viewport (412 × 915).
 */

export type SectionCategory = "hero" | "proof" | "pricing" | "feature" | "faq" | "cta" | "other"
export type SectionKind = "key" | "filler"
export type CaptureVerdict = "ok" | "blocked" | "empty" | "unreachable"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A heading-like element as the page shows it. */
export interface PageAnchor {
  /** Collapsed innerText — headings split across spans read as one string. */
  text: string
  rect: Rect
  fontSize: number
  /** Inside header, nav, footer, [role=navigation] or [role=contentinfo]. */
  inChrome: boolean
  /** Indexes into `blocks` of the landmark elements that contain it, nearest first. */
  landmarks: number[]
}

/** A landmark element: section, article, [role=region], or a child of main. */
export interface PageBlock {
  tag: string
  role: string | null
  rect: Rect
}

/** A visible element with its own text, an image, or a button. */
export interface PageLeaf {
  kind: "text" | "image" | "button"
  text: string
  rect: Rect
  inDetails: boolean
  inBlockquote: boolean
}

export interface PageSummary {
  finalUrl: string
  status: number | null
  title: string
  lang: string | null
  dir: "ltr" | "rtl"
  viewport: { width: number; height: number }
  dpr: number
  userAgent: string
  coarsePointer: boolean
  pageHeight: number
  visibleTextLength: number
  /** document.body.innerText, at most 12,000 characters — read for facts, never stored in output_data. */
  bodyText: string
  anchors: PageAnchor[]
  blocks: PageBlock[]
  leaves: PageLeaf[]
  /** Challenge markers present, and the largest share of the viewport one of them covers. */
  challenge: { markerCount: number; coverage: number }
}

export interface PlannedSection {
  order: number
  label: string
  category: SectionCategory
  kind: SectionKind
  rect: Rect
  text: string
  stillIndex: number | null
}

export interface PlannedStill {
  index: number
  sectionOrder: number
  label: string
  category: SectionCategory
  rect: Rect
}

export interface SectionPlan {
  sections: PlannedSection[]
  stills: PlannedStill[]
}

export interface PlanOptions {
  stillAspect: number
  maxStills: number
}

/** The still's width / height — a phone-card shape. */
export const STILL_ASPECT = 0.84
/** The full-page image stops here; a taller page sets `full_page_truncated`. */
export const FULL_PAGE_MAX_CSS_PX = 20_000

/** STRINGIFIED. The section finder (spec §4.4 step 6). */
export function planSections(summary: PageSummary, opts: PlanOptions): SectionPlan {
  const vw = summary.viewport.width
  const vh = summary.viewport.height
  const pageHeight = Math.max(1, Math.round(summary.pageHeight))
  const maxStills = Math.max(1, Math.min(8, Math.floor(opts.maxStills)))
  const CHROME_TEXT = /\b(cookies?|consent|gdpr|privacy|terms of (use|service)|legal notice|imprint|impressum)\b|עוגיות|פרטיות/i
  const clip = (s: string, n: number): string => Array.from(s.replace(/\s+/g, " ").trim()).slice(0, n).join("")
  const overlap = (a: { y: number; height: number }, b: { y: number; height: number }): number => {
    const inter = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return inter <= 0 ? 0 : inter / Math.max(1, Math.min(a.height, b.height))
  }
  const statsOf = (y: number, height: number) => {
    const inside = summary.leaves.filter((l) => {
      const cy = l.rect.y + l.rect.height / 2
      return cy >= y && cy < y + height
    })
    const text = clip(inside.filter((l) => l.kind !== "image").map((l) => l.text).join(" "), 1500)
    return {
      text,
      words: text ? text.split(" ").length : 0,
      images: inside.filter((l) => l.kind === "image").length,
      button: inside.some((l) => l.kind === "button"),
      details: inside.some((l) => l.inDetails),
      blockquote: inside.some((l) => l.inBlockquote),
    }
  }
  const categoryOf = (s: { text: string; words: number; images: number; button: boolean; details: boolean; blockquote: boolean }, label: string): SectionCategory => {
    const all = `${label} ${s.text}`
    if (/[$€£¥₪]\s?\d|\d(?:[.,]\d+)?\s?[$€£₪]|\bper (month|year|user|seat)\b|\/\s?(mo|month|yr)\b|\bpricing\b|\bplans?\b|מחיר/i.test(all)) return "pricing"
    if (/\b(trusted by|used by|loved by)\b/i.test(all) && s.words < 40 && s.images >= 3) return "other"
    if (s.blockquote || /\b[0-5](?:[.,]\d)?\s?(?:\/\s?5|stars?|out of 5)\b|★|\b\d[\d,.]*\s?[kKmM]?\+?\s(?:reviews?|ratings?|customers?|users?|teams?|companies)\b/i.test(all)) return "proof"
    if (s.details || /\bFAQs?\b|frequently asked|\bquestions\b|שאלות/i.test(all)) return "faq"
    if (s.button && s.words < 25) return "cta"
    if (s.words >= 15) return "feature"
    return "other"
  }
  const isKey = (c: SectionCategory): boolean => c === "hero" || c === "proof" || c === "pricing" || c === "feature"

  // 1–2. Keep readable, non-chrome anchors, in page order.
  const anchors = summary.anchors
    .filter((a) => a.rect.height >= 12 && a.rect.width >= 120)
    .filter((a) => !a.inChrome && !CHROME_TEXT.test(a.text))
    .slice()
    .sort((a, b) => a.rect.y - b.rect.y)

  // 3. Each anchor's section: its nearest landmark up to 2.5 viewports tall, else the band to the next anchor.
  type Candidate = { anchor: PageAnchor; y: number; height: number }
  const candidates: Candidate[] = anchors.flatMap((a, i) => {
    const landmark = a.landmarks
      .map((k) => summary.blocks[k])
      .find((b) => b !== undefined && b.rect.height <= 2.5 * vh && b.rect.y <= a.rect.y && b.rect.y + b.rect.height >= a.rect.y + a.rect.height)
    const next = anchors[i + 1]
    const y = landmark ? landmark.rect.y : a.rect.y
    const bottom = landmark ? landmark.rect.y + landmark.rect.height : next ? next.rect.y : pageHeight
    return bottom - y >= 160 ? [{ anchor: a, y, height: bottom - y }] : []
  })

  // 4. Merge sections that overlap by more than 60 %, keeping the larger heading.
  const merged = candidates.reduce<Candidate[]>((acc, c) => {
    const clash = acc.findIndex((m) => overlap(m, c) > 0.6)
    if (clash === -1) return [...acc, c]
    const kept = acc[clash]
    return kept && c.anchor.fontSize > kept.anchor.fontSize ? acc.map((m, i) => (i === clash ? c : m)) : acc
  }, [])

  // 5. The hero: from the top to the first remaining anchor below one viewport.
  const firstBelow = merged.find((c) => c.anchor.rect.y >= vh)
  const heroBottom = Math.min(pageHeight, firstBelow ? firstBelow.anchor.rect.y : vh)
  const heroAnchor = anchors
    .filter((a) => a.rect.y < heroBottom)
    .reduce<PageAnchor | null>((best, a) => (best === null || a.fontSize > best.fontSize ? a : best), null)
  const heroStats = statsOf(0, heroBottom)

  // 6. Categories.
  type Draft = { label: string; category: SectionCategory; rect: Rect; text: string; anchorTop: number }
  const hero: Draft[] =
    heroStats.text.length > 0 || heroStats.images > 0
      ? [{ label: clip(heroAnchor ? heroAnchor.text : summary.title, 60), category: "hero", rect: { x: 0, y: 0, width: vw, height: heroBottom }, text: heroStats.text, anchorTop: 0 }]
      : []
  const drafts: Draft[] = [
    ...hero,
    ...merged
      .filter((c) => c.anchor.rect.y >= heroBottom)
      .map((c): Draft => {
        const s = statsOf(c.y, c.height)
        const label = clip(c.anchor.text, 60)
        return { label, category: categoryOf(s, label), rect: { x: 0, y: c.y, width: vw, height: c.height }, text: s.text, anchorTop: c.anchor.rect.y }
      }),
  ].slice(0, 30)

  // 7. The still rectangle: full width, a phone-card shape, from just above the heading.
  const stillHeight = Math.min(pageHeight, Math.round(vw / opts.stillAspect))
  const stillRect = (d: Draft): Rect => {
    const top = d.category === "hero" ? 0 : d.anchorTop - 24
    return { x: 0, y: Math.max(0, Math.min(top, pageHeight - stillHeight)), width: vw, height: stillHeight }
  }

  // 8. Key sections first, then filler (non-FAQ first) up to three; never two stills overlapping by > 40 %.
  const pick = (order: readonly number[], chosen: readonly number[], limit: number): number[] =>
    order.reduce<number[]>((acc, i) => {
      const d = drafts[i]
      if (!d || acc.length >= limit || acc.includes(i)) return acc
      const r = stillRect(d)
      return acc.some((j) => { const o = drafts[j]; return o !== undefined && overlap(stillRect(o), r) > 0.4 }) ? acc : [...acc, i]
    }, [...chosen])
  const all = drafts.map((_, i) => i)
  const keys = pick(all.filter((i) => isKey(drafts[i]!.category)), [], maxStills)
  const withFiller =
    keys.length >= Math.min(3, maxStills)
      ? keys
      : pick(
          [...all.filter((i) => !isKey(drafts[i]!.category) && drafts[i]!.category !== "faq"), ...all.filter((i) => drafts[i]!.category === "faq")],
          keys,
          Math.min(3, maxStills),
        )
  const chosen = withFiller.slice().sort((a, b) => a - b)

  // 9. The section map.
  const stills: PlannedStill[] = chosen.map((i, n) => ({ index: n, sectionOrder: i, label: drafts[i]!.label, category: drafts[i]!.category, rect: stillRect(drafts[i]!) }))
  const sections: PlannedSection[] = drafts.map((d, i) => ({
    order: i,
    label: d.label,
    category: d.category,
    kind: isKey(d.category) ? "key" : "filler",
    rect: d.rect,
    text: clip(d.text, 300),
    stillIndex: chosen.includes(i) ? chosen.indexOf(i) : null,
  }))
  return { sections, stills }
}

/**
 * STRINGIFIED. The bot-wall verdict (spec §4.4 step 7), from the summary alone.
 * The wall phrases count on the title always, and on the visible text only for
 * a short page: a long marketing page may mention "DDoS protection" in its copy.
 * Under a wall status (401/403/429/503) a challenge marker is a challenge element
 * OR a wall phrase anywhere in the title or text: the status is the second signal,
 * so the short-page gate does not apply. A wall status with no marker at all is
 * not `blocked` (the spec's "status AND marker").
 * "verifying your browser" is the Vercel Security Checkpoint's wording (spike run
 * RQ0IC632nbtTpZj3t), folded in beside "checking your browser".
 */
export function computeVerdict(summary: PageSummary): CaptureVerdict {
  const WALL_TEXT = /just a moment|attention required|verify you are human|(checking|verifying) your browser|access denied|request blocked|are you a robot|unusual traffic|pardon our interruption|ddos protection/i
  const CHROME_TEXT = /\b(cookies?|consent|gdpr|privacy|terms of (use|service)|legal notice|imprint|impressum)\b|עוגיות|פרטיות/i
  const status = summary.status
  const wallTitle = WALL_TEXT.test(summary.title)
  const wallText = WALL_TEXT.test(summary.bodyText)
  const marker = summary.challenge.markerCount > 0 || wallTitle || wallText
  if (status !== null && (status === 401 || status === 403 || status === 429 || status === 503) && marker) return "blocked"
  if (wallTitle) return "blocked"
  if (summary.visibleTextLength < 3000 && wallText) return "blocked"
  if (summary.challenge.coverage > 0.3) return "blocked"
  if (status !== null && (status === 404 || status === 410 || status >= 500)) return "unreachable"
  const headings = summary.anchors.filter((a) => a.rect.height >= 12 && a.rect.width >= 120 && !a.inChrome && !CHROME_TEXT.test(a.text))
  if (summary.visibleTextLength < 150 && headings.length === 0) return "empty"
  return "ok"
}

/** STRINGIFIED, runs in the page. One JSON summary of the loaded page (spec §4.4 step 5). */
export function collectPageSummary(args: { status: number | null; finalUrl: string }): PageSummary {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sy = window.scrollY
  const html = document.documentElement
  const body = document.body
  const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()
  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const visible = (el: Element): boolean => {
    const cs = window.getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const bodyFont = body ? parseFloat(window.getComputedStyle(body).fontSize) || 16 : 16
  const CHROME = "header, nav, footer, [role=navigation], [role=contentinfo]"
  const all = body ? Array.from(body.querySelectorAll("*")).slice(0, 6000) : []

  const blockEls = Array.from(document.querySelectorAll("section, article, [role=region], main > *")).filter(visible).slice(0, 400)
  const blocks = blockEls.map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), rect: rectOf(el) }))

  const isAnchor = (el: Element): boolean => {
    const tag = el.tagName
    if (tag === "H1" || tag === "H2" || tag === "H3") return true
    if (el.getAttribute("role") === "heading" && Number(el.getAttribute("aria-level") || "2") <= 3) return true
    const cs = window.getComputedStyle(el)
    const text = collapse((el as HTMLElement).innerText || "")
    return parseFloat(cs.fontSize) >= 1.5 * bodyFont && (parseInt(cs.fontWeight, 10) || 400) >= 600 && text.length >= 2 && text.length <= 80
  }
  const anchorEls = all.filter((el) => visible(el) && isAnchor(el))
  const outermost = anchorEls.filter((el) => !anchorEls.some((other) => other !== el && other.contains(el)))
  const anchors = outermost.map((el) => ({
    text: collapse((el as HTMLElement).innerText || el.textContent || "").slice(0, 200),
    rect: rectOf(el),
    fontSize: parseFloat(window.getComputedStyle(el).fontSize) || bodyFont,
    inChrome: el.closest(CHROME) !== null,
    landmarks: blockEls
      .map((b, i) => (b.contains(el) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => blocks[a].rect.height - blocks[b].rect.height),
  }))

  const ownText = (el: Element): string =>
    collapse(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || "").join(" "))
  const leaves = all
    .map((el): PageLeaf | null => {
      const tag = el.tagName
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return null
      const isImage = tag === "IMG" || tag === "VIDEO" || tag === "PICTURE"
      const isButton =
        tag === "BUTTON" ||
        el.getAttribute("role") === "button" ||
        (tag === "A" && /\b(btn|button|cta)\b/i.test(el.getAttribute("class") || "")) ||
        (tag === "INPUT" && /^(submit|button)$/i.test(el.getAttribute("type") || ""))
      const text = isImage ? "" : isButton ? collapse((el as HTMLElement).innerText || "") : ownText(el)
      if (!isImage && !isButton && text.length === 0) return null
      if (!visible(el)) return null
      return {
        kind: isImage ? "image" : isButton ? "button" : "text",
        text: text.slice(0, 300),
        rect: rectOf(el),
        inDetails: el.closest("details") !== null,
        inBlockquote: el.closest("blockquote") !== null,
      }
    })
    .filter((l): l is PageLeaf => l !== null)
    .slice(0, 2000)

  const challengeEls = Array.from(
    document.querySelectorAll(
      'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], ' +
        "#challenge-form, #challenge-running, #cf-challenge-running, #px-captcha, #captcha-container, .cf-browser-verification",
    ),
  )
  const coverage = challengeEls.reduce((max, el) => {
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    return Math.max(max, (w * h) / (vw * vh))
  }, 0)
  const bodyText = body ? body.innerText || "" : ""
  return {
    finalUrl: args.finalUrl,
    status: args.status,
    title: collapse(document.title || ""),
    lang: html.getAttribute("lang"),
    dir: (html.getAttribute("dir") || window.getComputedStyle(html).direction) === "rtl" ? "rtl" : "ltr",
    viewport: { width: vw, height: vh },
    dpr: window.devicePixelRatio || 1,
    userAgent: navigator.userAgent,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    pageHeight: Math.max(html.scrollHeight, body ? body.scrollHeight : 0),
    visibleTextLength: bodyText.length,
    bodyText: bodyText.slice(0, 12000),
    anchors,
    blocks,
    leaves,
    challenge: { markerCount: challengeEls.length, coverage },
  }
}

/**
 * STRINGIFIED, runs in the page. Hide consent banners, click nothing (spec §4.4 step 3).
 * Known consent containers by CSS, then any fixed or sticky element over 15 % of the
 * viewport whose text is about cookies or privacy; then undo a scroll lock.
 */
export function hideConsentOverlays(): { leftCovering: boolean } {
  const SELECTORS = [
    "#onetrust-consent-sdk", "#CybotCookiebotDialog", "#didomi-host", ".qc-cmp2-container", "#usercentrics-root",
    "#truste-consent-track", ".osano-cm-window", ".cky-consent-container", ".cmplz-cookiebanner", "#termly-code-snippet-support",
  ]
  const style = document.createElement("style")
  style.setAttribute("data-nodaro-capture", "consent")
  style.textContent = `${SELECTORS.join(", ")} { display: none !important; }`
  document.head.appendChild(style)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const covers = (el: Element): number => {
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    return (w * h) / (vw * vh)
  }
  const pinned = (): Element[] =>
    Array.from(document.querySelectorAll("body *")).filter((el) => {
      const p = window.getComputedStyle(el).position
      return p === "fixed" || p === "sticky"
    })
  const CONSENT = /cookie|consent|privacy|gdpr|עוגיות|פרטיות/i
  pinned()
    .filter((el) => covers(el) > 0.15 && CONSENT.test((el as HTMLElement).innerText || ""))
    .forEach((el) => (el as HTMLElement).style.setProperty("display", "none", "important"))
  for (const el of [document.documentElement, document.body]) {
    if (el && window.getComputedStyle(el).overflowY === "hidden") el.style.setProperty("overflow-y", "visible", "important")
  }
  return { leftCovering: pinned().some((el) => window.getComputedStyle(el).display !== "none" && covers(el) > 0.25) }
}

/** STRINGIFIED, runs in the page. Load lazy content by scrolling (spec §4.4 step 4). */
export async function scrollThroughPage(args: { maxSteps: number; pauseMs: number; budgetMs: number }): Promise<{ timedOut: boolean }> {
  Array.from(document.querySelectorAll('img[loading="lazy"]')).forEach((img) => img.setAttribute("loading", "eager"))
  const started = Date.now()
  const step = Math.max(1, Math.round(window.innerHeight * 0.8))
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  for (let i = 0; i < args.maxSteps; i++) {
    if (Date.now() - started > args.budgetMs) return { timedOut: true }
    const before = window.scrollY
    window.scrollBy(0, step)
    await wait(args.pauseMs)
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    if (atBottom || window.scrollY === before) return { timedOut: false }
  }
  return { timedOut: true }
}

/**
 * STRINGIFIED, runs in the page. Before a still: hide fixed and sticky chrome (chat
 * launchers, repeated headers). The hero keeps a top-anchored header up to 20 % of
 * the viewport. `visibility`, never `display`, so nothing below moves.
 */
export function hideFixedForStill(args: { keepTopHeader: boolean; headerMaxPx: number }): number {
  const hide = Array.from(document.querySelectorAll("body *")).filter((el) => {
    const p = window.getComputedStyle(el).position
    if (p !== "fixed" && p !== "sticky") return false
    if (!args.keepTopHeader) return true
    const r = el.getBoundingClientRect()
    return !(r.top <= 1 && r.height <= args.headerMaxPx)
  })
  hide.forEach((el) => (el as HTMLElement).style.setProperty("visibility", "hidden", "important"))
  return hide.length
}

export interface PageFunctionOptions {
  maxStills: number
  stillAspect: number
  fullPageMaxCssPx: number
  stillFormat: "png" | "jpeg"
}

/** The page surface runCapture uses — Playwright's, with Puppeteer's idle wait as a fallback. */
export interface CapturePage {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>
  url(): string
  waitForLoadState?(state: "networkidle", options: { timeout: number }): Promise<unknown>
  waitForNetworkIdle?(options: { idleTime: number; timeout: number }): Promise<unknown>
}

export interface KeyValueWriter {
  setValue(key: string, value: unknown, options: { contentType: string }): Promise<unknown>
}

/** What the generic scrapers (and our own actor, option B′) hand the page function. */
export interface CaptureContextLike {
  page: CapturePage
  response?: { status(): number } | null
  Actor?: KeyValueWriter
  Apify?: KeyValueWriter
  setValue?: KeyValueWriter["setValue"]
}

export interface PageFunctions {
  collectPageSummary: typeof collectPageSummary
  hideConsentOverlays: typeof hideConsentOverlays
  scrollThroughPage: typeof scrollThroughPage
  hideFixedForStill: typeof hideFixedForStill
  planSections: typeof planSections
  computeVerdict: typeof computeVerdict
}

/** The dataset item one capture run writes (read by providers/apify/site-capture.ts). */
export interface CaptureItem {
  verdict: CaptureVerdict
  status: number | null
  finalUrl: string
  title: string
  lang: string | null
  dir: "ltr" | "rtl"
  device: { width: number; height: number; dpr: number }
  userAgent: string
  coarsePointer: boolean
  fullPage: { key: "FULL_PAGE"; truncated: boolean }
  stills: Array<{ key: string; index: number; sectionOrder: number; label: string; category: SectionCategory }>
  sections: PlannedSection[]
  warnings: string[]
  pageText: string
}

/** STRINGIFIED, runs in the page function's Node context. One page load, spec §4.4 steps 2–8. */
export async function runCapture(context: CaptureContextLike, opts: PageFunctionOptions, fns: PageFunctions): Promise<CaptureItem> {
  const page = context.page
  const warnings: string[] = []
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  // Playwright pages have waitForLoadState; Puppeteer pages do not. The same test picks the idle
  // wait and the screenshot shape: Puppeteer refuses `clip` with `fullPage` and has no `scale`,
  // and with a `clip` it already captures in document coordinates (captureBeyondViewport).
  const playwright = typeof page.waitForLoadState === "function"
  const idle = async (ms: number): Promise<void> => {
    if (playwright) await page.waitForLoadState!("networkidle", { timeout: ms }).catch(() => undefined)
    else if (typeof page.waitForNetworkIdle === "function") await page.waitForNetworkIdle({ idleTime: 500, timeout: ms }).catch(() => undefined)
  }
  const ownSetValue = context.setValue
  const writer: KeyValueWriter | null =
    context.Actor && typeof context.Actor.setValue === "function"
      ? context.Actor
      : context.Apify && typeof context.Apify.setValue === "function"
        ? context.Apify
        : typeof ownSetValue === "function"
          ? { setValue: (k, v, o) => ownSetValue(k, v, o) }
          : null
  if (!writer) throw new Error("the page function context has no key-value store")
  const status = context.response && typeof context.response.status === "function" ? context.response.status() : null

  await idle(10000)
  await Promise.race([page.evaluate(() => document.fonts.ready.then(() => true)), sleep(5000)]).catch(() => undefined)
  const overlay = await page.evaluate(fns.hideConsentOverlays)
  if (overlay && overlay.leftCovering) warnings.push("consent_overlay_left")
  const lazy = await page.evaluate(fns.scrollThroughPage, { maxSteps: 60, pauseMs: 250, budgetMs: 25000 })
  if (lazy && lazy.timedOut) warnings.push("lazy_content_timeout")
  await idle(5000)
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(500)

  const summary = await page.evaluate(fns.collectPageSummary, { status, finalUrl: page.url() })
  const verdict = fns.computeVerdict(summary)
  const plan = verdict === "ok" ? fns.planSections(summary, { stillAspect: opts.stillAspect, maxStills: opts.maxStills }) : { sections: [], stills: [] }

  const truncated = summary.pageHeight > opts.fullPageMaxCssPx
  const fullClip = { x: 0, y: 0, width: summary.viewport.width, height: opts.fullPageMaxCssPx }
  const full = await page.screenshot(
    playwright
      ? { fullPage: true, scale: "css", type: "jpeg", quality: 80, ...(truncated ? { clip: fullClip } : {}) }
      : truncated
        ? { clip: fullClip, type: "jpeg", quality: 80 }
        : { fullPage: true, type: "jpeg", quality: 80 },
  )
  await writer.setValue("FULL_PAGE", full, { contentType: "image/jpeg" })
  if (truncated) warnings.push("full_page_truncated")

  const stills: CaptureItem["stills"] = []
  for (const still of plan.stills) {
    await page.evaluate(fns.hideFixedForStill, { keepTopHeader: still.category === "hero", headerMaxPx: Math.round(summary.viewport.height * 0.2) })
    const key = "STILL_" + still.index
    const quality = opts.stillFormat === "jpeg" ? { quality: 90 } : {}
    const bytes = await page.screenshot(
      playwright ? { fullPage: true, clip: still.rect, type: opts.stillFormat, ...quality } : { clip: still.rect, type: opts.stillFormat, ...quality },
    )
    await writer.setValue(key, bytes, { contentType: opts.stillFormat === "jpeg" ? "image/jpeg" : "image/png" })
    stills.push({ key, index: still.index, sectionOrder: still.sectionOrder, label: still.label, category: still.category })
  }

  return {
    verdict,
    status,
    finalUrl: summary.finalUrl,
    title: summary.title,
    lang: summary.lang,
    dir: summary.dir,
    device: { width: summary.viewport.width, height: summary.viewport.height, dpr: summary.dpr },
    userAgent: summary.userAgent,
    coarsePointer: summary.coarsePointer,
    fullPage: { key: "FULL_PAGE", truncated },
    stills,
    sections: plan.sections,
    warnings,
    pageText: summary.bodyText,
  }
}

/**
 * tsx and esbuild's keepNames wrap every named arrow in `__name(...)`; that helper exists in the Node
 * process that compiled the module, never in the Apify page function or the browser. A source that
 * calls it fails every capture with a ReferenceError, so refuse it here, on every path that builds
 * the source (the dev server `tsx watch src/server.ts`, a tsx-run script), instead of at Apify.
 * Never stringified itself: it runs in Node only.
 */
export function assertNoTranspilerHelpers(source: string): string {
  if (/\b__name\(/.test(source)) {
    throw new Error(
      "site-capture page function carries a transpiler helper (__name). The page script was compiled by tsx/esbuild " +
        "keepNames; run the tsc build (npm run build && npm start) or import a tsc-emitted site-capture-page.js.",
    )
  }
  return source
}

/** The `pageFunction` source the actor runs: every stringified function, inlined. */
export function buildPageFunctionSource(opts: PageFunctionOptions): string {
  const fns: ReadonlyArray<readonly [keyof PageFunctions, { toString(): string }]> = [
    ["collectPageSummary", collectPageSummary],
    ["hideConsentOverlays", hideConsentOverlays],
    ["scrollThroughPage", scrollThroughPage],
    ["hideFixedForStill", hideFixedForStill],
    ["planSections", planSections],
    ["computeVerdict", computeVerdict],
  ]
  const source = [
    "async function pageFunction(context) {",
    `  const OPTS = ${JSON.stringify(opts)};`,
    "  const FNS = {",
    ...fns.map(([name, fn]) => `    ${name}: ${fn.toString()},`),
    "  };",
    `  const runCapture = ${runCapture.toString()};`,
    "  return runCapture(context, OPTS, FNS);",
    "}",
  ].join("\n")
  return assertNoTranspilerHelpers(source)
}
