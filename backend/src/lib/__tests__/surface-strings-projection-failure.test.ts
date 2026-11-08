import { describe, it, expect, vi, afterEach } from "vitest"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

// The validator is replaced by one that throws: the projection must still
// render every other key and drop `strings` alone. If it threw instead, the
// boot printer would exit non-zero and start.sh would write no surface at all.
vi.mock("../surface-strings.js", () => ({
  resolveSurfaceStrings: () => {
    throw new Error("validator broke")
  },
}))

const { renderSurfaceProfileForRuntimeConfig } = await import("../surface-profile-runtime-config.js")

describe("a strings validator failure costs only the strings", () => {
  const REAL_EDITION = config.EDITION
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  afterEach(() => {
    config.EDITION = REAL_EDITION
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
    vi.restoreAllMocks()
  })

  it("renders the rest of the profile and leaves strings out, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
      nav: { hide: ["gallery"] },
      billing: { unitLabel: "units", unitRate: 2000 },
      strings: { flow: { en: { "credits.allowanceExceeded": "Out." } } },
    })
    __resetSurfaceProfileCacheForTests()
    let text = ""
    expect(() => {
      text = renderSurfaceProfileForRuntimeConfig()
    }).not.toThrow()
    const out = JSON.parse(text) as Record<string, unknown>
    expect(out).not.toHaveProperty("strings")
    expect(out.nav).toEqual({ hide: ["gallery"] })
    expect((out.billing as { unitRate?: number }).unitRate).toBe(2000)
    expect(warn).toHaveBeenCalledWith("[surface-profile] strings dropped — could not be validated:", "validator broke")
  })
})
