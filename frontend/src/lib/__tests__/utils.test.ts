import { describe, it, expect } from "vitest"
import { cn } from "../utils"

describe("cn", () => {
  it("merges simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("handles conditional classes via clsx", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible")
  })

  it("deduplicates conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("")
  })

  it("handles undefined and null inputs", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b")
  })

  it("merges conflicting tailwind color classes", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500")
  })

  it("handles arrays", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar")
  })
})
