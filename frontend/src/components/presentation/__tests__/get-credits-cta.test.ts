import { afterEach, describe, expect, it } from "vitest"
import { getCreditsCtaKey } from "../get-credits-cta"

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

/**
 * The button a viewer short of credits gets. "Get Free Credits" names a promise
 * of credits of one's own, so it is only said where the deployment has them to
 * give; everywhere else, and for every plan but free, it says what it does.
 */
describe("getCreditsCtaKey", () => {
  it("a free account on a deployment that sells: Get Free Credits", () => {
    expect(getCreditsCtaKey("free", false)).toBe("present.getFreeCredits")
    expect(getCreditsCtaKey("free", undefined)).toBe("present.getFreeCredits")
  })

  it("any paid plan: Get Credits, on any deployment", () => {
    expect(getCreditsCtaKey("pro", false)).toBe("runner.getCredits")
    expect(getCreditsCtaKey(undefined, false)).toBe("runner.getCredits")
  })

  it("a free account under a deployment payer (a pay-as-you-go payer reads tier free): Get Credits", () => {
    expect(getCreditsCtaKey("free", true)).toBe("runner.getCredits")
  })

  it("a free account on a deployment that sells nothing: Get Credits", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
    expect(getCreditsCtaKey("free", false)).toBe("runner.getCredits")
  })
})
