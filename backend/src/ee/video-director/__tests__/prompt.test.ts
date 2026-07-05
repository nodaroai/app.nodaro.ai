import { describe, it, expect } from "vitest"
import { buildBrandBlock } from "../prompt.js"

const base = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } } as never

describe("buildBrandBlock — logo image steering", () => {
  it("instructs a mandatory logo-assemble-lockup when a logo image is set", () => {
    const out = buildBrandBlock({ ...(base as object), logo: { name: "X", image: "https://pub/x.png" } } as never)
    expect(out).toContain("logo-assemble-lockup")
    expect(out).toMatch(/MUST|always/i)
  })
  it("omits the steering line when no logo image (byte-identical to a name-only brand)", () => {
    const out = buildBrandBlock({ ...(base as object), logo: { name: "X" } } as never)
    expect(out).not.toContain("logo-assemble-lockup")
  })
  it("returns empty string with no brand", () => expect(buildBrandBlock(undefined)).toBe(""))
})
