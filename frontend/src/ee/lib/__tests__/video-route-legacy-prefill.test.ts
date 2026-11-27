import { describe, expect, it } from "vitest"
import { withLegacyRouting, type VideoRoutePolicy } from "../video-route-api"

const policy = (models: VideoRoutePolicy["models"] = {}): VideoRoutePolicy => ({
  models, routeBalanceAlertUsd: null, defaultProviderBalanceAlertCredits: null, spendDriftAlertPercent: 3,
  failureAlert: { failures: 5, windowMinutes: 30 }, billAnomalyMultiple: 5, enforceUnpaidCharges: false,
  accountOtherSpendUsdPerDay: 0,
})

describe("withLegacyRouting — a first save starts from what runs on the alternate route today", () => {
  it("sets each reported model and service to the alternate route, leaving the model's own choice on default", () => {
    const next = withLegacyRouting(policy(), [{ model: "seedance-2-5", service: "video-remake" }, { model: "seedance-2-5", service: "text-to-video" }])
    expect(next.models).toEqual({ "seedance-2-5": { route: "default", services: { "video-remake": "alternate", "text-to-video": "alternate" } } })
  })

  it("keeps what is already chosen, and changes nothing when the route reports nothing or does not say", () => {
    const base = policy({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } } })
    expect(withLegacyRouting(base, [{ model: "seedance-2", service: "text-to-video" }]).models).toEqual({
      "seedance-2": { route: "alternate", services: { "lip-sync": "default", "text-to-video": "alternate" } },
    })
    expect(withLegacyRouting(base, [])).toBe(base)
    expect(withLegacyRouting(base, null)).toBe(base)
    // The original is never changed.
    expect(base.models["seedance-2"]!.services).toEqual({ "lip-sync": "default" })
  })
})
