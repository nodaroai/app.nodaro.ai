import { describe, it, expect } from "vitest"
import {
  applyWebScrapeFailure,
  applyWebScrapeResult,
  deriveWebScrapeCardState,
  relativeTime,
  webScrapeFingerprint,
  webScrapeItems,
  webScrapePeekLine,
  webScrapeResultCount,
  WEB_SCRAPE_PEEK,
  webScrapeItemLink,
} from "../web-scrape-run-state"
import type { WebScrapeNodeData } from "@/types/nodes"

const RESULTS = [
  { title: "First", url: "https://a.example" },
  { title: "Second", url: "https://b.example" },
]

function nodeData(overrides: Partial<WebScrapeNodeData> = {}): WebScrapeNodeData {
  return { label: "Web Scrape", actor: "google-search", query: "ai news", ...overrides }
}

describe("web-scrape run state (#765)", () => {
  describe("the acceptance list", () => {
    it("a finished run is distinguishable from a never-run node", () => {
      expect(deriveWebScrapeCardState(nodeData()).kind).toBe("never-ran")
      const ran = nodeData({ ...applyWebScrapeResult(RESULTS), lastRunFingerprint: webScrapeFingerprint(nodeData()) })
      expect(deriveWebScrapeCardState(ran).kind).toBe("success")
    })

    it("success, zero-results and failure are three distinct states", () => {
      const base = nodeData()
      const fp = webScrapeFingerprint(base)
      const success = deriveWebScrapeCardState(nodeData({ ...applyWebScrapeResult(RESULTS), lastRunFingerprint: fp }))
      const empty = deriveWebScrapeCardState(nodeData({ ...applyWebScrapeResult([]), lastRunFingerprint: fp }))
      const failed = deriveWebScrapeCardState(nodeData({ ...applyWebScrapeFailure("Actor timed out"), lastRunFingerprint: fp }))
      expect([success.kind, empty.kind, failed.kind]).toEqual(["success", "empty", "failed"])
    })

    it("an EMPTY run never silently replaces a good payload", () => {
      const patch = applyWebScrapeResult([])
      expect(patch).not.toHaveProperty("generatedJson")
      expect(patch.lastRunOutcome).toBe("empty")
      // …and the derived card still knows the last good payload is intact:
      const d = nodeData({ generatedJson: RESULTS, lastGoodAt: 1, lastGoodCount: 2, ...patch, lastRunFingerprint: webScrapeFingerprint(nodeData()) })
      expect(d.generatedJson).toEqual(RESULTS)
    })

    it("a FAILED run keeps the payload and the card says what was kept", () => {
      const good = applyWebScrapeResult(RESULTS)
      const failure = applyWebScrapeFailure("Actor timed out after 60s")
      expect(failure).not.toHaveProperty("generatedJson")
      const d = nodeData({ ...good, ...failure, lastRunFingerprint: webScrapeFingerprint(nodeData()) })
      const state = deriveWebScrapeCardState(d)
      expect(state.kind).toBe("failed")
      if (state.kind === "failed") {
        expect(state.kept).toEqual({ count: 2, at: d.lastGoodAt })
        expect(state.errorMessage).toContain("timed out")
      }
    })

    it("changing an input marks the result STALE rather than deleting it", () => {
      const before = nodeData()
      const ran = nodeData({ ...applyWebScrapeResult(RESULTS), lastRunFingerprint: webScrapeFingerprint(before) })
      expect(deriveWebScrapeCardState(ran)).toMatchObject({ kind: "success", stale: false })
      const edited = { ...ran, query: "different query" }
      const state = deriveWebScrapeCardState(edited)
      expect(state).toMatchObject({ kind: "success", stale: true })
      expect(edited.generatedJson).toEqual(RESULTS) // nothing deleted
    })
  })

  describe("one layout, five actors", () => {
    it("every actor has a peek entry with a field and a glyph", () => {
      for (const actor of ["google-search", "rss", "content-crawler", "instagram", "tiktok"] as const) {
        const peek = WEB_SCRAPE_PEEK[actor]
        expect(peek.field.length).toBeGreaterThan(0)
        expect(typeof peek.glyph({}, 0)).toBe("string")
      }
    })

    it("content-crawler counts PAGES from its object root; arrays count directly", () => {
      expect(webScrapeResultCount({ pages: [{ url: "a" }, { url: "b" }, { url: "c" }] })).toBe(3)
      expect(WEB_SCRAPE_PEEK["content-crawler"].countNoun).toBe("pages")
      expect(webScrapeResultCount(RESULTS)).toBe(2)
      expect(webScrapeResultCount(undefined)).toBe(0)
      expect(webScrapeResultCount({})).toBe(0)
    })

    it("the glyph encodes image vs video for instagram/tiktok", () => {
      expect(WEB_SCRAPE_PEEK.instagram.glyph({ type: "Video", videoUrl: "v" }, 0)).toBe("▶")
      expect(WEB_SCRAPE_PEEK.instagram.glyph({ type: "Image" }, 0)).toBe("▣")
      expect(WEB_SCRAPE_PEEK.tiktok.glyph({ webVideoUrl: "v" }, 0)).toBe("▶")
    })

    it("peek lines read the actor's field and never render empty", () => {
      expect(webScrapePeekLine("google-search", { title: "Hello" })).toBe("Hello")
      expect(webScrapePeekLine("tiktok", { text: "clip caption" })).toBe("clip caption")
      expect(webScrapePeekLine("google-search", {})).toBe("(untitled)")
    })

    it("webScrapeItems normalizes both shapes to a row list", () => {
      expect(webScrapeItems(RESULTS)).toHaveLength(2)
      expect(webScrapeItems({ pages: [{ url: "a" }] })).toHaveLength(1)
      expect(webScrapeItems("not json")).toHaveLength(0)
    })
  })

  describe("back-compat + timers", () => {
    it("a pre-#765 node with stored results but no outcome reads as an old success", () => {
      const state = deriveWebScrapeCardState(nodeData({ generatedJson: RESULTS }))
      expect(state).toMatchObject({ kind: "success", count: 2, stale: false })
    })

    it("relativeTime buckets", () => {
      const now = 1_000_000_000
      expect(relativeTime(now - 5_000, now)).toBe("5s ago")
      expect(relativeTime(now - 120_000, now)).toBe("2m ago")
      expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h ago")
      expect(relativeTime(undefined, now)).toBe("")
    })
  })
})

describe("result links (#779)", () => {
  const actors = Object.keys(WEB_SCRAPE_PEEK) as Array<keyof typeof WEB_SCRAPE_PEEK>

  it("every actor declares the field its rows link to, beside its peek field", () => {
    for (const actor of actors) expect(WEB_SCRAPE_PEEK[actor].linkField, actor).toBeTruthy()
    expect(WEB_SCRAPE_PEEK.tiktok.linkField).toBe("webVideoUrl")
    expect(WEB_SCRAPE_PEEK["content-crawler"].linkField).toBe("url")
  })

  it("links http(s) only — a hostile feed's javascript:/data:/relative value renders as text", () => {
    expect(webScrapeItemLink("google-search", { url: "https://example.com/a" })).toBe("https://example.com/a")
    expect(webScrapeItemLink("google-search", { url: " http://example.com/b " })).toBe("http://example.com/b")
    expect(webScrapeItemLink("rss", { url: "javascript:alert(1)" })).toBeNull()
    expect(webScrapeItemLink("rss", { url: "data:text/html,hi" })).toBeNull()
    expect(webScrapeItemLink("rss", { url: "/relative/path" })).toBeNull()
    expect(webScrapeItemLink("instagram", { caption: "no url field" })).toBeNull()
    expect(webScrapeItemLink("tiktok", { webVideoUrl: "https://www.tiktok.com/@x/video/1" })).toBe("https://www.tiktok.com/@x/video/1")
  })
})
