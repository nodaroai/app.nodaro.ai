import { describe, expect, it } from "vitest"
import { imageCollageBody } from "../image-collage.js"

const base = {
  imageUrls: ["https://media.nodaro.ai/a.png", "https://media.nodaro.ai/b.png"],
}

describe("imageCollageBody attach fields", () => {
  it("accepts a full boards attach request", () => {
    const parsed = imageCollageBody.safeParse({
      ...base,
      attachToCharacterId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      attachToColumn: "boards",
      attachName: "Evening gown",
      attachBoardType: "identity",
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.attachToColumn).toBe("boards")
      expect(parsed.data.attachBoardType).toBe("identity")
    }
  })

  it("still accepts a plain collage request (all attach fields optional)", () => {
    expect(imageCollageBody.safeParse(base).success).toBe(true)
  })

  it("rejects a non-boards attach column", () => {
    expect(
      imageCollageBody.safeParse({ ...base, attachToColumn: "expressions" }).success,
    ).toBe(false)
  })

  it("rejects a non-uuid attach id", () => {
    expect(
      imageCollageBody.safeParse({ ...base, attachToCharacterId: "nope" }).success,
    ).toBe(false)
  })
})
