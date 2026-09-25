import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_ERROR_CODES, validateVideoOverlayRequest, type VideoOverlayIssue } from "@nodaro/shared"
import { translate, type TFunction } from "@/lib/i18n"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { videoOverlayErrorKey, videoOverlayIssueText, videoOverlayWarningText } from "../video-overlay-i18n"

const tEn: TFunction = (key, vars) => translate("en", key, vars)
const tHe: TFunction = (key, vars) => translate("he", key, vars)

describe("video-overlay i18n (audit U7 — the canvas never shows the validator's English)", () => {
  it("every validator code has an en and a he string", () => {
    for (const code of VIDEO_OVERLAY_ERROR_CODES) {
      const key = videoOverlayErrorKey(code)
      expect(en[key], code).toBeTruthy()
      expect(he[key], code).toBeTruthy()
    }
  })

  it("names the layer by its canvas slot, else by index + 1", () => {
    const bySlot = validateVideoOverlayRequest({ layers: [{ imageUrl: "https://x/a.png", start: 5, end: 4, slot: 4 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(bySlot, tEn)).toBe("Layer 4: End must be after start")
    expect(videoOverlayIssueText(bySlot, tHe)).toBe("שכבה 4: הסיום צריך להיות אחרי ההתחלה")
    const byIndex = validateVideoOverlayRequest({ layers: [{ imageUrl: "https://x/a.png", start: 0 }, { start: 1 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(byIndex, tEn)).toBe("Layer 2: No image — connect one to this layer's handle")
    const request = validateVideoOverlayRequest({ layers: [] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(request, tEn)).toBe("Connect an image to a layer handle")
  })

  it("renders the worker's warnings by slot, and the render-wide one without a layer", () => {
    expect(videoOverlayWarningText({ layer: 0, slot: 3, code: "clipped", detail: "…" }, tEn)).toBe("layer 3 clipped to the video end")
    expect(videoOverlayWarningText({ code: "audio_reencoded", detail: "…" }, tEn)).toBe("the audio was re-encoded to AAC")
  })
})
