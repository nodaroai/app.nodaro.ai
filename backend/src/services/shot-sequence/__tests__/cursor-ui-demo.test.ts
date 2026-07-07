import { describe, it, expect, vi } from "vitest"
vi.mock("../../../lib/config.js", async (orig) => {
  const actual = (await orig()) as { config: Record<string, unknown> }
  return { config: { ...actual.config, R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})
import { validateBlueprintParams } from "../blueprint-params.js"

const ok = {
  screens: ["https://pub-test.r2.dev/a.png", "https://pub-test.r2.dev/b.png"],
  targets: [{ xPct: 30, yPct: 40 }, { xPct: 70, yPct: 60 }],
}
describe("cursor-ui-demo params", () => {
  it("accepts our-CDN screens + targets", () => {
    expect(validateBlueprintParams("cursor-ui-demo", ok).ok).toBe(true)
  })
  it("rejects when any screen is off-CDN", () => {
    expect(validateBlueprintParams("cursor-ui-demo", { ...ok, screens: [ok.screens[0], "https://evil.com/x.png"] }).ok).toBe(false)
  })
  it("rejects targets out of the 0..100 percent range", () => {
    expect(validateBlueprintParams("cursor-ui-demo", { ...ok, targets: [{ xPct: 30, yPct: 40 }, { xPct: 200, yPct: 60 }] }).ok).toBe(false)
  })
})
