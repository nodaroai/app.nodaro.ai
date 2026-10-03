import { describe, it, expect } from "vitest"
import { videoOverlayCompositionKey } from "@nodaro/shared"
import { videoOverlayResultFresh } from "../video-overlay-composition"

// The key itself (videoOverlayCompositionKey / videoOverlaySlotSources) lives in
// @nodaro/shared — both engines stamp it — and is tested there.
describe("videoOverlayResultFresh (audit U10)", () => {
  const key = videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: ["https://x/a.png"], data: { layers: [{ start: 1 }] } })

  it("a stamped result is fresh only under the same key; an unstamped one is never fresh (no size fallback)", () => {
    expect(videoOverlayResultFresh(key, { resultCompositionKey: key })).toBe(true)
    expect(videoOverlayResultFresh(key, { resultCompositionKey: "other" })).toBe(false)
    expect(videoOverlayResultFresh(key, {})).toBe(false)
    expect(videoOverlayResultFresh(key, { resultCompositionKey: undefined })).toBe(false)
    expect(videoOverlayResultFresh(key, undefined)).toBe(false)
  })
})
