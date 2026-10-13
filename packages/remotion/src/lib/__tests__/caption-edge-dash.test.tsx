import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Caption } from "@remotion/captions"

/**
 * A caption line never starts or ends on a lone dash token. A voice times a dash
 * written between two spaces as a token of its own, and forced alignment keeps it,
 * so a line break right after it ("זה Nodaro —") or right before it ("— קנבס")
 * leaves a stray mark on screen. The display drops it from the line's edge; every
 * word keeps its own timing, and a dash inside a line stays.
 *
 * The words are a real two-segment Hebrew script with two spaced dashes; the
 * timings are illustrative (each dash timed as a short token of its own, as the
 * alignment returns it).
 */
const clock = vi.hoisted(() => ({ frame: 0 }))
const FPS = 30
vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: FPS, width: 1080, height: 1920, durationInFrames: 900 }),
}))

// eslint-disable-next-line import/first
import { activeHeldCaption, groupCaptionLines, splitCaptionRuns } from "../caption-lines"
// eslint-disable-next-line import/first
import { WordHighlightOverlay } from "../word-highlight-overlay"
// eslint-disable-next-line import/first
import { TikTokPagesOverlay } from "../tiktok-pages-overlay"

const w = (text: string, startMs: number, endMs: number): Caption =>
  ({ text, startMs, endMs, timestampMs: startMs, confidence: null })

// "כל מודלי ה-AI — קנבס אחד. זה Nodaro —" then "יוצרים על הקנבס כל מה שרוצים."
const DASH_SCRIPT: Caption[] = [
  w("כל", 0, 200), w("מודלי", 240, 620), w("ה-AI", 660, 1200), w("—", 1200, 1260),
  w("קנבס", 1300, 1700), w("אחד.", 1740, 2200),
  w("זה", 2500, 2660), w("Nodaro", 2700, 3300), w("—", 3300, 3380),
  w("יוצרים", 3820, 4300), w("על", 4340, 4480), w("הקנבס", 4520, 5000),
  w("כל", 5040, 5200), w("מה", 5240, 5380), w("שרוצים.", 5420, 6000),
]

const DASHES = new Set(["—", "–", "-"])
const texts = (words: readonly Caption[]) => words.map((x) => x.text)

describe("groupCaptionLines — no line starts or ends on a lone dash", () => {
  it("with a three-word cap, the dash is dropped from both edges it lands on and the words keep their timings", () => {
    const lines = groupCaptionLines(DASH_SCRIPT, 60, { maxWords: 3 })
    for (const line of lines) {
      expect(DASHES.has(line.words[0]!.text)).toBe(false)
      expect(DASHES.has(line.words[line.words.length - 1]!.text)).toBe(false)
      // The line's window is its shown words'.
      expect(line.startMs).toBe(line.words[0]!.startMs)
    }
    expect(lines.map((l) => texts(l.words))).toEqual([
      ["כל", "מודלי", "ה-AI"],
      ["קנבס", "אחד."],
      ["זה", "Nodaro"],
      ["יוצרים", "על", "הקנבס"],
      ["כל", "מה", "שרוצים."],
    ])
    // Every word that is shown is the same object, timings untouched.
    const shown = lines.flatMap((l) => l.words)
    for (const word of shown) expect(DASH_SCRIPT).toContain(word)
  })

  it("a dash INSIDE a line stays", () => {
    const lines = groupCaptionLines(DASH_SCRIPT, 200)
    expect(texts(lines[0]!.words)).toEqual(["כל", "מודלי", "ה-AI", "—", "קנבס", "אחד."])
    // The second sentence carries its dash mid-line: no break falls next to it.
    expect(texts(lines[1]!.words)).toEqual(["זה", "Nodaro", "—", "יוצרים", "על", "הקנבס", "כל", "מה", "שרוצים."])
  })

  it("a line of dashes alone is not shown — the line before it holds", () => {
    const lines = groupCaptionLines([w("Done.", 0, 400), w("—", 1200, 1260), w("Next", 2000, 2300)], 60)
    expect(lines.map((l) => texts(l.words))).toEqual([["Done."], ["Next"]])
  })

  it("en dash and hyphen-minus tokens count; hyphenated words do not", () => {
    const lines = groupCaptionLines([w("Fast", 0, 200), w("–", 200, 240), w("re-run", 900, 1200), w("-", 1200, 1240)], 60, { maxWords: 2 })
    expect(lines.map((l) => texts(l.words))).toEqual([["Fast"], ["re-run"]])
  })
})

describe("splitCaptionRuns and activeHeldCaption follow the same edge rule", () => {
  it("no run starts or ends on a lone dash", () => {
    const runs = splitCaptionRuns(DASH_SCRIPT, { maxWords: 3 })
    for (const run of runs) {
      expect(DASHES.has(run[0]!.text)).toBe(false)
      expect(DASHES.has(run[run.length - 1]!.text)).toBe(false)
    }
  })

  it("one word at a time, the word before a dash holds through the dash's window", () => {
    expect(activeHeldCaption(DASH_SCRIPT, 3320)?.text).toBe("Nodaro")
  })
})

describe("overlays never paint a lone dash at a line's edge", () => {
  const renderAt = (ms: number, el: React.ReactElement): string => {
    clock.frame = Math.round((ms / 1000) * FPS)
    return renderToStaticMarkup(el)
  }

  it("word-highlight: the line 'זה Nodaro' holds through the dash with no dash on screen", () => {
    const html = renderAt(3330, <WordHighlightOverlay captions={DASH_SCRIPT} position="bottom" fontSize={32} color="#ffffff" maxWordsPerLine={3} />)
    expect(html).toContain("Nodaro")
    expect(html).not.toContain("—")
  })

  it("tiktok pages: no page opens or closes on the dash", () => {
    for (const ms of [1230, 1500, 3330]) {
      const html = renderAt(ms, <TikTokPagesOverlay captions={DASH_SCRIPT} position="bottom" fontSize={32} color="#ffffff" maxWordsPerLine={3} />)
      const text = html.replace(/<[^>]+>/g, "").trim()
      expect(text.startsWith("—")).toBe(false)
      expect(text.endsWith("—")).toBe(false)
    }
  })
})
