import { describe, it, expect } from "vitest"
import {
  INSTAGRAM_SCRAPE_CREDIT_COSTS,
  INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID,
  INSTAGRAM_SCRAPE_MAX_SOURCES,
  INSTAGRAM_SCRAPE_TIERS,
  buildInstagramScrapeCreditId,
  clampInstagramFeaturedIndex,
  featuredInstagramOutputs,
  instagramPostLink,
  instagramRequestedCount,
  instagramScrapeCreditIdFromNode,
  instagramScrapeSources,
  resolveInstagramScrapeCreditId,
  splitInstagramTargets,
} from "../instagram-scrape.js"
import { resolveEffectiveSourceType } from "../entity-image-handle.js"

describe("instagram-scrape vocabulary", () => {
  it("splitInstagramTargets: one per line / comma, strips @ and #, dedupes, caps at MAX_SOURCES", () => {
    expect(splitInstagramTargets("@nike\n#running, adidas")).toEqual(["nike", "running", "adidas"])
    expect(splitInstagramTargets("nike\nNIKE")).toEqual(["nike"])
    expect(splitInstagramTargets(["  puma ", "", "@vans"])).toEqual(["puma", "vans"])
    expect(splitInstagramTargets(Array.from({ length: 9 }, (_, i) => `b${i}`))).toHaveLength(INSTAGRAM_SCRAPE_MAX_SOURCES)
    expect(splitInstagramTargets(undefined)).toEqual([])
  })

  it("credit ids: 1 credit per requested post, tiered on count × sources, analysis folds in", () => {
    expect(buildInstagramScrapeCreditId({ count: 20, sources: 1 })).toBe("instagram-scrape:20")
    expect(buildInstagramScrapeCreditId({ count: 30, sources: 2 })).toBe("instagram-scrape:100")
    expect(buildInstagramScrapeCreditId({ count: 20, sources: 1, analysis: "economy" })).toBe("instagram-scrape:20:analysis:economy")
    expect(buildInstagramScrapeCreditId({ count: 50, sources: 1, analysis: "standard" })).toBe("instagram-scrape:50:analysis")
    for (const tier of INSTAGRAM_SCRAPE_TIERS) {
      expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[`instagram-scrape:${tier}`]).toBe(tier)
      expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[`instagram-scrape:${tier}:analysis:economy`]).toBe(tier * 2)
    }
    expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID]).toBeDefined()
  })

  it("the node quote and the pre-Zod guard land on the SAME identifier", () => {
    const data = { mode: "profile", targets: "nike\nadidas", count: 30, analyze: true }
    expect(instagramScrapeSources(data)).toBe(2)
    expect(instagramScrapeCreditIdFromNode(data)).toBe("instagram-scrape:100:analysis:economy")
    // The wire body the node sends (targets already split to an array).
    expect(resolveInstagramScrapeCreditId({ targets: ["nike", "adidas"], count: 30, analyze: true })).toBe("instagram-scrape:100:analysis:economy")
    expect(resolveInstagramScrapeCreditId({})).toBe("instagram-scrape:20") // omitted count = default, 1 source
  })

  it("featured outputs: caption / first image / first video, clamped", () => {
    const posts = [
      { caption: "hi", images: ["https://i/1.jpg"], videos: [], videoPreviews: [] },
      { caption: "vid", images: [], videos: ["https://v/2.mp4"], videoPreviews: ["https://v/2.jpg"] },
    ]
    expect(featuredInstagramOutputs(posts, 0)).toEqual({ text: "hi", imageUrl: "https://i/1.jpg" })
    expect(featuredInstagramOutputs(posts, 1)).toEqual({ text: "vid", imageUrl: "https://v/2.jpg", videoUrl: "https://v/2.mp4" })
    expect(featuredInstagramOutputs(posts, 9)).toEqual(featuredInstagramOutputs(posts, 1))
    expect(featuredInstagramOutputs([], 0)).toEqual({})
    expect(clampInstagramFeaturedIndex(-3, 2)).toBe(0)
  })

  it("post links: canonical form, case-sensitive dedupe, everything else dropped", () => {
    expect(instagramPostLink("https://www.instagram.com/p/Qx7LmNa2B4c/")).toBe("https://www.instagram.com/p/Qx7LmNa2B4c/")
    expect(instagramPostLink("instagram.com/p/Qx7LmNa2B4c?igsh=abc123")).toBe("https://www.instagram.com/p/Qx7LmNa2B4c/")
    expect(instagramPostLink("https://m.instagram.com/some.creator/p/Qx7LmNa2B4c/")).toBe("https://www.instagram.com/p/Qx7LmNa2B4c/")
    expect(instagramPostLink("  https://www.instagram.com/reel/C1a2B3c4D5e/  ")).toBe("https://www.instagram.com/reel/C1a2B3c4D5e/")
    expect(instagramPostLink("https://www.instagram.com/reels/C1a2B3c4D5e/")).toBe("https://www.instagram.com/reel/C1a2B3c4D5e/")
    expect(instagramPostLink("https://instagr.am/p/Abc_-123/")).toBe("https://www.instagram.com/p/Abc_-123/")
    expect(instagramPostLink("https://www.instagram.com/some.creator/")).toBeNull()
    expect(instagramPostLink("https://www.instagram.com/explore/tags/running/")).toBeNull()
    expect(instagramPostLink("https://evil.example.com/p/Qx7LmNa2B4c/")).toBeNull()
    expect(instagramPostLink("https://instagram.com.evil.example/p/Qx7LmNa2B4c/")).toBeNull()
    expect(instagramPostLink("Qx7LmNa2B4c")).toBeNull()
    // Instagram's own path words are never a username, and an audio page is not a reel:
    // each would otherwise become a wrong post that still bills.
    expect(instagramPostLink("https://www.instagram.com/share/p/BAxyz12345/")).toBeNull()
    expect(instagramPostLink("https://www.instagram.com/share/reel/BAxyz12345/")).toBeNull()
    expect(instagramPostLink("https://www.instagram.com/reels/audio/123456789/")).toBeNull()
    expect(instagramPostLink("https://www.instagram.com/reels/audio?x=1")).toBeNull()
    expect(instagramPostLink("https://www.instagram.com/stories/some.creator/123/")).toBeNull()
    // …but a real shortcode that merely starts with those letters is fine.
    expect(instagramPostLink("https://www.instagram.com/reel/audioXYZ123/")).toBe("https://www.instagram.com/reel/audioXYZ123/")

    expect(
      splitInstagramTargets(
        "https://www.instagram.com/p/AbC123/\nhttps://instagram.com/p/AbC123/?igsh=x https://www.instagram.com/p/abc123/, nike",
        "post",
      ),
    ).toEqual(["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/p/abc123/"])
    expect(splitInstagramTargets(["https://www.instagram.com/p/AbC123/", "#running"], "post")).toEqual(["https://www.instagram.com/p/AbC123/"])
    // One post reached by its /p/ and its /reel/ link is ONE target (deduped by shortcode).
    expect(splitInstagramTargets("https://www.instagram.com/p/AbC123/\nhttps://www.instagram.com/reel/AbC123/", "post")).toEqual(["https://www.instagram.com/p/AbC123/"])
    // An API array entry holding two links keeps both.
    expect(splitInstagramTargets(["https://www.instagram.com/p/One111/ https://www.instagram.com/p/Two222/"], "post")).toEqual([
      "https://www.instagram.com/p/One111/",
      "https://www.instagram.com/p/Two222/",
    ])
    expect(splitInstagramTargets(Array.from({ length: 9 }, (_, i) => `https://www.instagram.com/p/code${i}/`), "post")).toHaveLength(INSTAGRAM_SCRAPE_MAX_SOURCES)
    // The other modes keep their behaviour, with or without the mode argument.
    expect(splitInstagramTargets("@nike\n#running", "profile")).toEqual(splitInstagramTargets("@nike\n#running"))
  })

  it("post mode bills one post per link, whatever the count setting says", () => {
    expect(instagramRequestedCount("post", 80)).toBe(1)
    expect(instagramRequestedCount("profile", 80)).toBe(80)
    const node = { mode: "post", targets: "https://www.instagram.com/p/AbC123/\nhttps://www.instagram.com/p/XyZ789/", count: 80 }
    expect(instagramScrapeSources(node)).toBe(2)
    // 2 links → 2 requested posts → the 10 tier, not 2 × 80 → the 200 tier.
    expect(instagramScrapeCreditIdFromNode(node)).toBe("instagram-scrape:10")
    // The docs' worked examples: 1 link → 10 CR, 5 links → still 10 CR.
    expect(instagramScrapeCreditIdFromNode({ mode: "post", targets: "https://www.instagram.com/p/AbC123/" })).toBe("instagram-scrape:10")
    const fiveLinks = Array.from({ length: 5 }, (_, i) => `https://www.instagram.com/p/code${i}/`).join("\n")
    expect(instagramScrapeCreditIdFromNode({ mode: "post", targets: fiveLinks, count: 100 })).toBe("instagram-scrape:10")
    expect(INSTAGRAM_SCRAPE_CREDIT_COSTS["instagram-scrape:10"]).toBe(10)
    expect(instagramScrapeCreditIdFromNode({ ...node, analyze: true })).toBe("instagram-scrape:10:analysis:economy")
    // The pre-Zod guard lands on the same id from the wire body.
    expect(resolveInstagramScrapeCreditId({ mode: "post", targets: ["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/p/XyZ789/"], count: 80 })).toBe("instagram-scrape:10")
    // A post-mode body with no valid link prices like any empty request.
    expect(resolveInstagramScrapeCreditId({ mode: "post", targets: ["nike"] })).toBe(INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID)
  })

  it("typed handles resolve as the canonical single-media producers on canvas; json keeps the raw type", () => {
    expect(resolveEffectiveSourceType("instagram-scrape", "text")).toBe("combine-text")
    expect(resolveEffectiveSourceType("instagram-scrape", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("instagram-scrape", "video")).toBe("upload-video")
    expect(resolveEffectiveSourceType("instagram-scrape", "json")).toBe("instagram-scrape")
    expect(resolveEffectiveSourceType("instagram-scrape", "audio")).toBe("instagram-scrape")
  })
})
