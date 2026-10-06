import type { PageAnchor, PageBlock, PageLeaf, PageSummary } from "../../site-capture-page.js"

/** The Pixel 7 viewport in CSS px. */
export const VW = 412
export const VH = 915

/** Neutral filler words that match no category pattern. */
export function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `lorem${i}`).join(" ")
}

export interface SectionSpec {
  title: string
  y: number
  height: number
  text?: string
  words?: number
  images?: number
  button?: boolean
  details?: boolean
  blockquote?: boolean
  font?: number
  anchorHeight?: number
  inChrome?: boolean
  /** false = no landmark element around the section, so the band rule applies. */
  landmark?: boolean
  /** true = the heading is laid out but faded out at rest (a scroll-linked story beat). */
  hidden?: boolean
}

function leaf(
  kind: PageLeaf["kind"],
  text: string,
  y: number,
  height: number,
  flags: { inDetails?: boolean; inBlockquote?: boolean } = {},
): PageLeaf {
  return { kind, text, rect: { x: 16, y, width: 380, height }, inDetails: flags.inDetails ?? false, inBlockquote: flags.inBlockquote ?? false }
}

/** A synthetic page summary: one heading per section at `y + 40`, its text below, then images and a button. */
export function summaryOf(sections: readonly SectionSpec[], over: Partial<PageSummary> = {}): PageSummary {
  const withBlock = sections.filter((s) => s.landmark !== false)
  const blocks: PageBlock[] = withBlock.map((s) => ({ tag: "section", role: null, rect: { x: 0, y: s.y, width: VW, height: s.height } }))
  const anchors: PageAnchor[] = sections.map((s) => ({
    text: s.title,
    rect: { x: 16, y: s.y + 40, width: 380, height: s.anchorHeight ?? 32 },
    fontSize: s.font ?? 28,
    inChrome: s.inChrome ?? false,
    landmarks: s.landmark === false ? [] : [withBlock.indexOf(s)],
    ...(s.hidden ? { hidden: true } : {}),
  }))
  const leaves: PageLeaf[] = sections.flatMap((s) => [
    leaf("text", s.title, s.y + 40, 32),
    leaf("text", s.text ?? words(s.words ?? 20), s.y + 90, 60, { inDetails: s.details, inBlockquote: s.blockquote }),
    ...Array.from({ length: s.images ?? 0 }, (_, k) => leaf("image", "", s.y + 160 + k * 4, 40)),
    ...(s.button ? [leaf("button", "Start", s.y + 150, 44)] : []),
  ])
  const last = sections[sections.length - 1]
  return {
    finalUrl: "https://example.com/",
    status: 200,
    title: "Example",
    lang: "en",
    dir: "ltr",
    viewport: { width: VW, height: VH },
    dpr: 2.625,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) NodaroCapture/1.0 (+https://nodaro.ai/capture)",
    coarsePointer: true,
    pageHeight: last ? last.y + last.height : VH,
    visibleTextLength: 2400,
    bodyText: "",
    anchors,
    blocks,
    leaves,
    challenge: { markerCount: 0, coverage: 0 },
    ...over,
  }
}

/** A landing page in the usual order: hero, feature, pricing, proof, FAQ, call to action. */
export const LANDING: readonly SectionSpec[] = [
  { title: "Ship videos faster", y: 0, height: 900, words: 20, font: 40 },
  { title: "Make it yours", y: 1000, height: 700, words: 30 },
  { title: "Simple pricing", y: 1800, height: 700, text: "Pro $12 per month billed yearly" },
  { title: "Loved by creators", y: 2600, height: 600, text: "Rated 4.8/5 from 2,000 reviews" },
  { title: "Questions", y: 3300, height: 600, details: true, words: 30 },
  { title: "Start today", y: 4000, height: 300, words: 4, button: true },
]
