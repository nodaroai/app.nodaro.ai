import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "../helpers"
import { buildScraperCreditId, instagramScrapeCreditIdFromNode, metaAdsScrapeCreditIdFromNode } from "@nodaro/shared/social"
import type { WorkflowNode } from "@/types/nodes"

/**
 * `getModelIdentifier(node)` is what prices a node everywhere except its own
 * card: the panel's Run button, the Execute-workflow total, the >100 cr confirm
 * and the pre-run precheck. For a node whose price is TIERED it has to return
 * the tiered row — the one the route's guard and reservation resolve — never
 * the bare node type.
 *
 * Instagram had no branch and fell through to `"instagram-scrape"`: every one
 * of those surfaces quoted the flat row while the route reserved the tier the
 * node's settings land on. Same family as the video-analysis bare-id quote
 * (`video-analysis-model-identifier.test.ts`).
 */

function scraper(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "s-1", type, position: { x: 0, y: 0 }, data: { label: type, ...data } } as unknown as WorkflowNode
}

describe("getModelIdentifier — scrapers", () => {
  it("instagram-scrape: the tiered row its route reserves, never the bare node type", () => {
    const data = { mode: "profile", targets: "nasa, esa", count: 30 }
    const id = getModelIdentifier(scraper("instagram-scrape", data))
    expect(id).toBe(instagramScrapeCreditIdFromNode(data))
    expect(id).not.toBe("instagram-scrape")
  })

  it("instagram-scrape: the analysis add-on changes the row", () => {
    const base = { mode: "profile", targets: "nasa", count: 20 }
    const plain = getModelIdentifier(scraper("instagram-scrape", base))
    const analysed = getModelIdentifier(scraper("instagram-scrape", { ...base, analyze: true }))
    expect(analysed).toBe(instagramScrapeCreditIdFromNode({ ...base, analyze: true }))
    expect(analysed).not.toBe(plain)
  })

  it("instagram-scrape: more sources or more posts move the tier", () => {
    const small = getModelIdentifier(scraper("instagram-scrape", { targets: "nasa", count: 10 }))
    const large = getModelIdentifier(scraper("instagram-scrape", { targets: "nasa, esa, jaxa", count: 50 }))
    expect(large).not.toBe(small)
  })

  it("meta-ads-scrape and web-scrape keep resolving through their shared builders", () => {
    const ads = { mode: "search", query: "nike", count: 50 }
    expect(getModelIdentifier(scraper("meta-ads-scrape", ads))).toBe(metaAdsScrapeCreditIdFromNode(ads))
    expect(getModelIdentifier(scraper("web-scrape", { actor: "content-crawler", mode: "site" }))).toBe(
      buildScraperCreditId({ actor: "content-crawler", mode: "site" }),
    )
  })
})
