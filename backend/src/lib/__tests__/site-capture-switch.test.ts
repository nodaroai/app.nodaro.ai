import { afterEach, describe, expect, it } from "vitest"
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

describe("SITE_CAPTURE_ENABLED=false switches the Site Capture node off on every surface", () => {
  afterEach(() => {
    delete process.env.SITE_CAPTURE_ENABLED
  })

  it("denies the node to users and admins, lists it for the picker, and leaves every other node alone", async () => {
    process.env.SITE_CAPTURE_ENABLED = "false"
    const deny = await import("../surface-deny.js")
    expect(deny.switchedOffNodeTypes()).toEqual(["site-capture"])
    expect(deny.isNodeDenied("site-capture", deny.USER_VIEWER)).toBe(true)
    expect(deny.isNodeDenied("site-capture", deny.ADMIN_VIEWER)).toBe(true)
    expect(deny.isNodeFactoryDenied("site-capture")).toBe(true)
    expect(deny.effectiveDeniedNodeTypes(deny.USER_VIEWER)).toContain("site-capture")
    expect(deny.isNodeDenied("web-scrape", deny.USER_VIEWER)).toBe(false)
  })

  it("left on (the default), the node is offered", async () => {
    const deny = await import("../surface-deny.js")
    expect(deny.switchedOffNodeTypes()).toEqual([])
    expect(deny.isNodeDenied("site-capture", deny.USER_VIEWER)).toBe(false)
  })
})
