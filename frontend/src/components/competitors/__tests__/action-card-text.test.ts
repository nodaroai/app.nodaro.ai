import { describe, expect, it } from "vitest"
import type { ActionCard } from "@nodaro/shared"
import { translate, type MessageKey } from "@/lib/i18n"
import { cardText, priorityLabel } from "../action-card-text"

const t = (key: MessageKey, vars?: Record<string, string | number>) => translate("en", key, vars)

function card(kind: ActionCard["kind"], params: ActionCard["params"], priority: ActionCard["priority"] = 1): ActionCard {
  return { id: `${kind}:c1:x`, kind, priority, subjectId: "c1", params, evidence: ["p1"], title: "server title", why: "server why", action: "server action" }
}

describe("cardText", () => {
  it("phrases an outlier about a competitor and about the user's own brand", () => {
    const params = { brand: "Acme Paint", own: false, platform: "tiktok", ratio: 5, over100: false, reach: 12_000, usual: 2_400, unit: "views" }
    // Numbers follow the reader's locale (bidi marks included), so they are compared bare.
    const text = cardText(card("outlier", params), t)
    expect({ ...text, why: text.why.replace(/[‎‏]/g, "") }).toEqual({
      title: "Acme Paint's TikTok post did 5x their usual",
      why: "12K views, against a usual 2.4K on TikTok.",
      action: "Study its first seconds and make your own version",
    })
    expect(cardText(card("outlier", { ...params, own: true, over100: true, ratio: 140 }), t).title).toBe("Your TikTok post did over 100x your usual")
  })

  it("keeps the post's own words as a quote", () => {
    const text = cardText(card("complaints", { brand: "Acme Paint", own: false, count: 1, example: "It peeled in a week" }), t)
    expect(text).toMatchObject({ why: "A new post complains:", quote: "It peeled in a week" })
  })

  it("phrases market cards without a brand", () => {
    expect(cardText(card("market_sound", { soundTitle: "", brands: ["Acme Paint", "Boltly"], views: 9_000 }, 2), t).title).toBe("“untitled” is around 2 competitors")
  })

  it("falls back to the server's English for a kind this build does not know", () => {
    const unknown = { ...card("outlier", {}), kind: "brand_new_kind" } as unknown as ActionCard
    expect(cardText(unknown, t)).toEqual({ title: "server title", why: "server why", action: "server action" })
  })

  it("labels priorities", () => {
    expect(priorityLabel({ priority: 1 }, t)).toBe("Act now")
    expect(priorityLabel({ priority: 3 }, t)).toBe("Good to know")
  })
})
