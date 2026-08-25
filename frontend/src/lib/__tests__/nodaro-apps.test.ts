import { describe, it, expect, afterEach } from "vitest"

import { NODARO_APPS, otherNodaroApps } from "@/lib/nodaro-apps"
import type { NodaroAppId } from "@/lib/nodaro-apps"

/**
 * Fleet-wide contract: the SAME canonical, append-only order on every
 * surface, each app omitting only itself. If this test needs editing for
 * anything other than APPENDING a new app, the order rule is being broken.
 */
describe("nodaro-apps registry", () => {
  it("holds all five apps in the canonical order", () => {
    expect(NODARO_APPS.map((a) => a.id)).toEqual([
      "flow",
      "studio",
      "person",
      "voice",
      "recast",
    ])
  })

  it("otherNodaroApps omits exactly the current app, preserving order", () => {
    // otherNodaroApps projects the family to the SurfaceSibling {label,url}
    // shape (so a deployment can override it wholesale), so compare by label.
    for (const current of NODARO_APPS.map((a) => a.id)) {
      const others = otherNodaroApps(current as NodaroAppId)
      expect(others.map((a) => a.label)).toEqual(
        NODARO_APPS.filter((a) => a.id !== current).map((a) => a.label),
      )
    }
  })

  it("every sibling entry is an absolute https URL", () => {
    for (const app of NODARO_APPS) {
      expect(app.href).toMatch(/^https?:\/\//)
      expect(app.label.length).toBeGreaterThan(0)
    }
  })
})

describe("otherNodaroApps — surface siblings override", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("returns the Nodaro family (minus self) with no profile", () => {
    expect(otherNodaroApps("flow").some((a) => a.label === "Studio")).toBe(true)
  })

  it("replaces the family with the profile's siblings when set", () => {
    window.__NODARO_RUNTIME__ = { surface: { siblings: { apps: [{ label: "SAI Chat", url: "https://chat.example" }] } } }
    expect(otherNodaroApps("flow")).toEqual([{ label: "SAI Chat", url: "https://chat.example" }])
  })
})
