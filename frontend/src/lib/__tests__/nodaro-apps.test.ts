import { describe, it, expect } from "vitest"

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
    for (const current of NODARO_APPS.map((a) => a.id)) {
      const others = otherNodaroApps(current as NodaroAppId)
      expect(others.map((a) => a.id)).toEqual(
        NODARO_APPS.map((a) => a.id).filter((id) => id !== current),
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
