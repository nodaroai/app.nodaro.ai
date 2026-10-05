import { describe, expect, it } from "vitest"
import type { ActionCard, CompetitorPost } from "@nodaro/shared"
import { cardPlatform, cardsOn, cardsPerBrand, peopleSay } from "../card-facts"

function card(id: string, overrides: Partial<ActionCard> = {}): ActionCard {
  return { id, kind: "launch", priority: 1, subjectId: "a", params: {}, evidence: [], title: "t", why: "w", action: "a", ...overrides }
}

function post(id: string, platform: CompetitorPost["platform"], text = `words of ${id}`): CompetitorPost {
  return {
    id,
    platform,
    url: `https://example.com/${id}`,
    text,
    author: { handle: "someone", name: "" },
    metrics: {},
    media: { kind: "text" },
    hashtags: [],
    extra: {},
    role: "about",
  }
}

const posts = { p1: post("p1", "tiktok"), p2: post("p2", "instagram", "\n  Waited forever  \nfor nothing"), p3: post("p3", "instagram") }

describe("cardPlatform", () => {
  it("takes the platform a card names, else the one most of its posts are on", () => {
    expect(cardPlatform(card("c", { params: { platform: "x" }, evidence: ["p1"] }), posts)).toBe("x")
    expect(cardPlatform(card("c", { evidence: ["p1", "p2", "p3"] }), posts)).toBe("instagram")
    expect(cardPlatform(card("c", { evidence: ["p1", "p2"] }), posts)).toBe("tiktok")
    expect(cardPlatform(card("c", { evidence: ["missing"] }), posts)).toBeNull()
  })

  it("keeps the cards about the chosen platform, or all of them", () => {
    const cards = [card("x", { params: { platform: "x" } }), card("i", { evidence: ["p2"] })]
    expect(cardsOn(cards, posts, "instagram").map((c) => c.id)).toEqual(["i"])
    expect(cardsOn(cards, posts, null)).toHaveLength(2)
  })
})

describe("peopleSay", () => {
  it("quotes a complaint posted on that platform first", () => {
    const cards = [
      card("s", { kind: "spreading", params: { platform: "instagram", firstLine: "Look at this" } }),
      card("c", { kind: "complaints", params: { example: "fallback" }, evidence: ["p1", "p2"] }),
    ]
    expect(peopleSay(cards, posts, "a", "instagram")).toEqual({ kind: "complaints", quote: "Waited forever" })
  })

  it("else a post about the brand spreading there, else nothing", () => {
    const cards = [card("s", { kind: "spreading", params: { platform: "instagram", firstLine: "Look at this" } })]
    expect(peopleSay(cards, posts, "a", "instagram")).toEqual({ kind: "spreading", quote: "Look at this" })
    expect(peopleSay(cards, posts, "a", "tiktok")).toBeNull()
    expect(peopleSay(cards, posts, "someone-else", "instagram")).toBeNull()
  })
})

describe("cardsPerBrand", () => {
  it("counts each brand's cards and leaves the market's out", () => {
    const counts = cardsPerBrand([card("1"), card("2"), card("3", { subjectId: "b" }), card("4", { subjectId: null, kind: "market_sound" })])
    expect([...counts.entries()]).toEqual([
      ["a", 2],
      ["b", 1],
    ])
  })
})
