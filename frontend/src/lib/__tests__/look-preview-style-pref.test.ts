// The real / illustration choice is remembered PER PICKER TYPE on this device:
// switching Camera Motion never changes what a new Color / Look node starts as,
// and unreadable or corrupt storage means "no preference", never a throw.
import { afterEach, describe, expect, it, vi } from "vitest"
import { getStickyLookPreviewStyle, setStickyLookPreviewStyle } from "../parameter-node-prefs"

const KEY = "nodaro:look-preview-style"

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem(KEY)
})

describe("sticky look preview style", () => {
  it("has no preference until the user switches a type", () => {
    expect(getStickyLookPreviewStyle("camera-motion")).toBeUndefined()
  })

  it("remembers each picker type independently", () => {
    setStickyLookPreviewStyle("camera-motion", "illustration")
    setStickyLookPreviewStyle("color-look", "real")
    expect(getStickyLookPreviewStyle("camera-motion")).toBe("illustration")
    expect(getStickyLookPreviewStyle("color-look")).toBe("real")
    expect(getStickyLookPreviewStyle("style")).toBeUndefined()
    setStickyLookPreviewStyle("camera-motion", "real")
    expect(getStickyLookPreviewStyle("camera-motion")).toBe("real")
    expect(getStickyLookPreviewStyle("color-look")).toBe("real")
  })

  it("ignores a corrupt or foreign stored value", () => {
    window.localStorage.setItem(KEY, "not json")
    expect(getStickyLookPreviewStyle("style")).toBeUndefined()
    window.localStorage.setItem(KEY, JSON.stringify({ style: "photo" }))
    expect(getStickyLookPreviewStyle("style")).toBeUndefined()
    window.localStorage.setItem(KEY, JSON.stringify(["illustration"]))
    expect(getStickyLookPreviewStyle("0")).toBeUndefined()
  })

  it("survives storage that throws (private mode, cross-origin iframe)", () => {
    // Replace the accessor itself — what a cross-origin iframe does — rather
    // than spying on methods, which depends on the runtime's Storage shape.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied")
      },
    })
    try {
      expect(() => setStickyLookPreviewStyle("style", "illustration")).not.toThrow()
      expect(getStickyLookPreviewStyle("style")).toBeUndefined()
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original)
    }
  })
})
