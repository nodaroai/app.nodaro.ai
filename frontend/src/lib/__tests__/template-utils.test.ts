import { describe, it, expect } from "vitest"
import { getNodeTypeLabel, formatCount } from "../template-utils"

describe("getNodeTypeLabel", () => {
  it("returns mapped label for generate-image", () => {
    expect(getNodeTypeLabel("generate-image")).toBe("Image Generation")
  })

  it("returns mapped label for ai-writer", () => {
    expect(getNodeTypeLabel("ai-writer")).toBe("AI Writer")
  })

  it("returns mapped label for social", () => {
    expect(getNodeTypeLabel("social")).toBe("Social Media")
  })

  it("title-cases unknown types from dashes", () => {
    expect(getNodeTypeLabel("unknown-type")).toBe("Unknown Type")
  })

  it("title-cases multi-word unknown types", () => {
    expect(getNodeTypeLabel("my-cool-node")).toBe("My Cool Node")
  })
})

describe("formatCount", () => {
  it("returns plain string below 1000", () => {
    expect(formatCount(500)).toBe("500")
  })

  it("returns plain string at 999", () => {
    expect(formatCount(999)).toBe("999")
  })

  it("formats 1000 as 1.0k", () => {
    expect(formatCount(1000)).toBe("1.0k")
  })

  it("formats 1500 as 1.5k", () => {
    expect(formatCount(1500)).toBe("1.5k")
  })

  it("formats 12345 as 12.3k", () => {
    expect(formatCount(12345)).toBe("12.3k")
  })

  it("returns '0' for zero", () => {
    expect(formatCount(0)).toBe("0")
  })
})
