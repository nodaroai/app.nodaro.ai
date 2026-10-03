import { describe, it, expect } from "vitest"
import type { PersonValue, StylingValue } from "@nodaro/prompts"
import { personCardPicks, stylingCardPicks } from "../character-card-picks"

describe("personCardPicks", () => {
  it("lists every known pick in dimension order", () => {
    const picks = personCardPicks({ faceShape: "face-round", age: "age-early-20s", bust: "bust-very-full" } as PersonValue)
    expect(picks.map((p) => p.dimension)).toEqual(["age", "bust", "face-shape"])
  })

  it("leaves an adult-only pick (and so its photo) off a minor's card", () => {
    const picks = personCardPicks({ age: "age-teen", bust: "bust-very-full", faceShape: "face-round" } as PersonValue)
    expect(picks.map((p) => p.dimension)).toEqual(["age", "face-shape"])
  })

  it("drops an id the catalog does not know", () => {
    expect(personCardPicks({ faceShape: "face-gone" } as PersonValue)).toEqual([])
  })

  it("keeps every pick of a multi-pick setting, in order", () => {
    const picks = personCardPicks({ ethnicity: ["chinese", "korean"] } as PersonValue)
    expect(picks).toEqual([{ dimension: "ethnicity", entryIds: ["chinese", "korean"] }])
  })
})

describe("stylingCardPicks", () => {
  it("lists a multi-pick setting's array picks (they used to be skipped)", () => {
    const picks = stylingCardPicks({ jewelry: ["jewelry-gold", "jewelry-silver"], outfit: "outfit-streetwear" } as StylingValue)
    expect(picks).toEqual([
      { dimension: "jewelry", entryIds: ["jewelry-gold", "jewelry-silver"] },
      { dimension: "outfit", entryIds: ["outfit-streetwear"] },
    ])
  })

  it("drops an id the catalog does not know", () => {
    expect(stylingCardPicks({ outfit: "outfit-gone" } as StylingValue)).toEqual([])
  })
})
