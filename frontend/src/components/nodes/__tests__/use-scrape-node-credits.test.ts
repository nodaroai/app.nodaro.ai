import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { instagramScrapeCreditIdFromNode, metaAdsScrapeCreditIdFromNode } from "@nodaro/shared/social"

const mockUseModelCredits = vi.fn()
vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: (...args: unknown[]) => mockUseModelCredits(...args),
}))

import { useScrapeNodeCredits } from "../use-scrape-node-credits"

/**
 * A site crawl read "Run (50 CR)" on the node beside "Run This Node (55
 * credits)" in the panel, and 55 is what was charged: the three scrapers were
 * the only nodes pricing their Run button from the static base table instead of
 * asking the server like everything else on the screen.
 */
describe("useScrapeNodeCredits", () => {
  beforeEach(() => {
    mockUseModelCredits.mockReset()
    // The server's figure is the final one; the table's is only the fallback.
    mockUseModelCredits.mockImplementation((_id: string, fallback: number) => Math.round(fallback * 1.1))
  })

  it("shows the charged figure for a site crawl, with the table as the fallback", () => {
    const { result } = renderHook(() =>
      useScrapeNodeCredits("n1", "web-scrape", { label: "Web Scrape", actor: "content-crawler", mode: "site" }),
    )
    expect(mockUseModelCredits).toHaveBeenCalledWith("web-scrape:content-crawler:site", 50)
    expect(result.current).toBe(55)
  })

  it("asks for the single-page row when the crawl mode is page", () => {
    renderHook(() => useScrapeNodeCredits("n1", "web-scrape", { label: "Web Scrape", actor: "content-crawler", mode: "page" }))
    expect(mockUseModelCredits).toHaveBeenCalledWith("web-scrape:content-crawler", 10)
  })

  it("prices Meta Ads on the tiered row its route reserves", () => {
    const data = { label: "Meta Ads", mode: "search", query: "nike", count: 50 }
    renderHook(() => useScrapeNodeCredits("n2", "meta-ads-scrape", data))
    expect(mockUseModelCredits.mock.calls[0]![0]).toBe(metaAdsScrapeCreditIdFromNode(data))
  })

  it("prices Instagram on the tiered row its route reserves — never the bare node type", () => {
    const data = { label: "Instagram", mode: "profile", targets: "nasa, esa", count: 30 }
    renderHook(() => useScrapeNodeCredits("n3", "instagram-scrape", data))
    const asked = mockUseModelCredits.mock.calls[0]![0]
    expect(asked).toBe(instagramScrapeCreditIdFromNode(data))
    expect(asked).not.toBe("instagram-scrape")
  })

  it("falls back to the table when the server has no figure yet", () => {
    mockUseModelCredits.mockImplementation((_id: string, fallback: number) => fallback)
    const { result } = renderHook(() =>
      useScrapeNodeCredits("n1", "web-scrape", { label: "Web Scrape", actor: "content-crawler", mode: "site" }),
    )
    expect(result.current).toBe(50)
  })
})

/**
 * Structural: every node card's Run button shows the price the server charges.
 * A card that assigns the static estimate straight to `credits` shows the base
 * table instead, and nothing on the screen says the two differ.
 */
describe("node cards never price their Run button from the static table", () => {
  const dir = join(__dirname, "..")
  const cards = readdirSync(dir).filter((f) => f.endsWith("-node.tsx"))

  it("finds the node cards", () => {
    expect(cards.length).toBeGreaterThan(50)
  })

  it.each(cards)("%s", (file) => {
    const source = readFileSync(join(dir, file), "utf8")
    expect(source).not.toMatch(/const\s+credits\s*=\s*estimateNodeCredits\(/)
  })
})
