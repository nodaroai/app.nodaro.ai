import { describe, it, expect, vi } from "vitest"

vi.mock("../../../lib/config.js", async (orig) => {
  const actual = (await orig()) as { config: Record<string, unknown> }
  return { config: { ...actual.config, R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})

import { validateBlueprintParams } from "../blueprint-params.js"

const ok = { deviceImage: "https://pub-test.r2.dev/d.png", screens: ["https://pub-test.r2.dev/a.png", "https://pub-test.r2.dev/b.png"] }

describe("device-surface-showcase params", () => {
  it("accepts our-CDN device + screens", () => {
    expect(validateBlueprintParams("device-surface-showcase", ok).ok).toBe(true)
  })
  it("rejects a non-CDN deviceImage", () => {
    expect(validateBlueprintParams("device-surface-showcase", { ...ok, deviceImage: "http://169.254.169.254/x.png" }).ok).toBe(false)
  })
  it("rejects when ANY single screen is off-CDN (per-element gate)", () => {
    expect(validateBlueprintParams("device-surface-showcase", { ...ok, screens: [ok.screens[0], "https://evil.com/x.png"] }).ok).toBe(false)
  })
  it("rejects fewer than 2 screens", () => {
    expect(validateBlueprintParams("device-surface-showcase", { ...ok, screens: [ok.screens[0]] }).ok).toBe(false)
  })
})
