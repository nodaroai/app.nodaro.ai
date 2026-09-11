/**
 * Scene3D delivery artifacts are private by contract, so a still's URL is an
 * authenticated API URL — not something an `<img>` can load on its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isScene3DDeliveryUrl } from "../scene3d/authed-image"

describe("which still URLs need an authenticated read", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("recognises a delivery artifact on this install and on another origin", () => {
    expect(isScene3DDeliveryUrl("https://app.example/v1/3d-scene/deliveries/j/assets/a")).toBe(true)
    expect(isScene3DDeliveryUrl("https://next.example/v1/3d-scene/deliveries/j/assets/a")).toBe(true)
    expect(isScene3DDeliveryUrl("/v1/3d-scene/deliveries/j/assets/a")).toBe(true)
  })

  it("leaves a public media URL alone — re-fetching it would only lose the browser cache", () => {
    expect(isScene3DDeliveryUrl("https://cdn.example/renders/still-0.png")).toBe(false)
    expect(isScene3DDeliveryUrl("https://app.example/v1/jobs/j")).toBe(false)
    expect(isScene3DDeliveryUrl("not a url at all")).toBe(false)
  })
})
