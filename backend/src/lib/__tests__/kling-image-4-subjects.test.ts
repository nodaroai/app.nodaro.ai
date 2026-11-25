import { describe, expect, it } from "vitest"
import { klingImage4PricedItems, klingImage4Subjects } from "../kling-image-4-subjects.js"

const U = (n: number) => `https://cdn.example.com/${n}.png`
const kira = (n: number, variant?: string) => ({
  id: `k${n}`, url: U(n), defaultName: variant ? `Kira / ${variant}` : "Kira", characterSlug: "kira",
  ...(variant ? { variantSlug: variant } : {}), characterCanonicalDescription: "short red hair",
})

describe("klingImage4Subjects: a wired character sending 2 to 4 images is one named subject", () => {
  it("groups the images the run sends by character, the portrait first", () => {
    const refs = [kira(2, "side"), { id: "p", url: U(9), defaultName: "Jacket" }, kira(1), kira(3, "back")]
    const subjects = klingImage4Subjects("kling-image-4", refs, [U(2), U(9), U(1), U(3)])
    expect(subjects).toEqual([{ name: "Kira", imageUrls: [U(1), U(2), U(3)], description: "short red hair" }])
    expect(klingImage4PricedItems(4, subjects)).toBe(2)
  })

  it("only images the run sends: a view the assembly left out is not a view", () => {
    expect(klingImage4Subjects("kling-image-4", [kira(1), kira(2, "side")], [U(1)])).toEqual([])
  })

  it("one image is a plain reference; another model, or no structured references, has none", () => {
    expect(klingImage4Subjects("kling-image-4", [kira(1)], [U(1)])).toEqual([])
    expect(klingImage4Subjects("seedream-5-5", [kira(1), kira(2, "side")], [U(1), U(2)])).toEqual([])
    expect(klingImage4Subjects("kling-image-4-i2i", undefined, [U(1), U(2)])).toEqual([])
  })

  it("at most 4 views; two characters are two subjects with unique names", () => {
    const five = [kira(1), kira(2, "a"), kira(3, "b"), kira(4, "c"), kira(5, "d")]
    const max = { ...kira(6), characterSlug: "max", defaultName: "Kira" }
    const max2 = { ...kira(7, "side"), characterSlug: "max", defaultName: "Kira / side" }
    const subjects = klingImage4Subjects("kling-image-4", [...five, max, max2], [U(1), U(2), U(3), U(4), U(5), U(6), U(7)])
    expect(subjects.map((s) => [s.name, s.imageUrls.length])).toEqual([["Kira", 4], ["Kira2", 2]])
    // 7 sent: 4 + 2 named, the fifth view plain: 1 + 1 + 1 items.
    expect(klingImage4PricedItems(7, subjects)).toBe(3)
  })
})
