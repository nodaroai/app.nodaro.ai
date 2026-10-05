import { describe, expect, it } from "vitest"
import { parseSiteCaptureEnabled, siteCaptureEnabled } from "../config.js"

describe("SITE_CAPTURE_ENABLED", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["1", true],
    ["0", true],
    ["false", false],
    [" FALSE ", false],
  ])("%j → %s (unset or anything but false means on)", (value, on) => {
    expect(parseSiteCaptureEnabled(value)).toBe(on)
  })
  it("the test environment leaves it unset, so capture is on", () => expect(siteCaptureEnabled()).toBe(true))
})
