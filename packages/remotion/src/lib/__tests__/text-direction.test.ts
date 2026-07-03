import { describe, it, expect } from "vitest"
import {
  detectBaseDirection,
  resolveDirection,
  directionStyle,
  rowDirectionFromCaptions,
  containsArabic,
} from "../text-direction"

describe("detectBaseDirection", () => {
  it("pure Hebrew → rtl", () => expect(detectBaseDirection("שלום עולם")).toBe("rtl"))
  it("pure Arabic → rtl", () => expect(detectBaseDirection("مرحبا بالعالم")).toBe("rtl"))
  it("Arabic presentation forms → rtl", () => expect(detectBaseDirection("ﺍﺎ")).toBe("rtl"))
  it("pure Latin → ltr", () => expect(detectBaseDirection("Hello world")).toBe("ltr"))
  it("leading digits then Hebrew → rtl (digits are neutral)", () =>
    expect(detectBaseDirection("123 שלום")).toBe("rtl"))
  it("leading punctuation then Arabic → rtl", () =>
    expect(detectBaseDirection("«مرحبا»")).toBe("rtl"))
  it("leading Latin then Hebrew → ltr (first strong wins)", () =>
    expect(detectBaseDirection("SKU שלום")).toBe("ltr"))
  it("empty → ltr", () => expect(detectBaseDirection("")).toBe("ltr"))
  it("whitespace only → ltr", () => expect(detectBaseDirection("   ")).toBe("ltr"))
  it("digits only → ltr", () => expect(detectBaseDirection("2026")).toBe("ltr"))
})

describe("resolveDirection", () => {
  it("explicit override wins over content", () =>
    expect(resolveDirection("Hello", "rtl")).toBe("rtl"))
  it("explicit ltr wins over Hebrew content", () =>
    expect(resolveDirection("שלום", "ltr")).toBe("ltr"))
  it("no override → auto-detect", () =>
    expect(resolveDirection("שלום")).toBe("rtl"))
})

describe("directionStyle", () => {
  it("returns only direction by default (no textAlign, no unicodeBidi)", () => {
    const s = directionStyle("שלום")
    expect(s).toEqual({ direction: "rtl" })
  })
  it("align:true maps rtl → textAlign right", () => {
    expect(directionStyle("שלום", { align: true })).toEqual({ direction: "rtl", textAlign: "right" })
  })
  it("align:true maps ltr → textAlign left", () => {
    expect(directionStyle("Hi", { align: true })).toEqual({ direction: "ltr", textAlign: "left" })
  })
  it("explicit override flows through", () => {
    expect(directionStyle("Hi", { explicit: "rtl" })).toEqual({ direction: "rtl" })
  })
  it("never emits unicodeBidi", () => {
    expect("unicodeBidi" in directionStyle("שלום")).toBe(false)
  })
})

describe("rowDirectionFromCaptions", () => {
  it("Hebrew captions → rtl", () => {
    expect(rowDirectionFromCaptions([{ text: "שלום" }, { text: "עולם" }])).toBe("rtl")
  })
  it("Latin captions → ltr", () => {
    expect(rowDirectionFromCaptions([{ text: "Hello" }, { text: "world" }])).toBe("ltr")
  })
  it("empty captions → ltr", () => {
    expect(rowDirectionFromCaptions([])).toBe("ltr")
  })
})

describe("containsArabic", () => {
  it("pure Arabic → true", () => expect(containsArabic("مرحبا بالعالم")).toBe(true))
  it("pure Hebrew → false (NOT Arabic)", () => expect(containsArabic("שלום עולם")).toBe(false))
  it("pure Latin → false", () => expect(containsArabic("Hello world")).toBe(false))
  it("mixed Latin + Arabic → true", () => expect(containsArabic("Nodaro مرحبا")).toBe(true))
})
