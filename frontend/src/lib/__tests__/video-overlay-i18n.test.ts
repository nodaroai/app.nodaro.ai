import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_ERROR_CODES, validateVideoOverlayRequest, type VideoOverlayIssue } from "@nodaro/shared/video"
import { translate, type TFunction } from "@/lib/i18n"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { videoOverlayErrorKey, videoOverlayIssueText, videoOverlayLengthWarningText, videoOverlayWarningText } from "../video-overlay-i18n"
import { videoOverlayLengthWarning } from "../video-overlay-limits"

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
    expect(videoOverlayIssueText(byIndex, tEn)).toBe("Layer 2: No image or video — connect one to this layer's handle")
    const request = validateVideoOverlayRequest({ layers: [] }) as VideoOverlayIssue
    // A layer can be a video too: the empty node's refusal names both.
    expect(videoOverlayIssueText(request, tEn)).toBe("Connect an image or a video to a layer handle")
  })

  it("a plan layer without an image or video says so in the plan's terms, in every locale that has the key", () => {
    const planIssue = validateVideoOverlayRequest({ layers: [{ start: 0, planLayer: 2 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(planIssue, tEn)).toBe("Plan layer 2: No image or video — set imageUrl or videoUrl on this layer in the plan")
    expect(videoOverlayIssueText(planIssue, tHe)).toBe("שכבת תוכנית 2: אין תמונה או וידאו — הגדירו imageUrl או videoUrl לשכבה הזו בתוכנית")
    const handleIssue = validateVideoOverlayRequest({ layers: [{ start: 0, slot: 3 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(handleIssue, tEn)).toBe("Layer 3: No image or video — connect one to this layer's handle")
  })

  it("names the video-layer refusals in the user's words", () => {
    const two = validateVideoOverlayRequest({ layers: [{ imageUrl: "https://x/a.png", videoUrl: "https://x/a.mp4", start: 0, slot: 2 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(two, tEn)).toBe("Layer 2: A layer takes an image or a video, not both")
    const videos = Array.from({ length: 3 }, (_, i) => ({ videoUrl: `https://x/${i}.mp4`, start: 0 }))
    expect(videoOverlayIssueText(validateVideoOverlayRequest({ layers: videos }) as VideoOverlayIssue, tEn)).toBe("At most 2 video layers (this node has 3)")
    const sound = validateVideoOverlayRequest({ layers: [{ imageUrl: "https://x/a.png", start: 0, sound: { volume: 1 }, slot: 1 }] }) as VideoOverlayIssue
    expect(videoOverlayIssueText(sound, tEn)).toBe("Layer 1: Only a video layer can have sound")
  })

  it("names the base-box and layout refusals in the user's words, with no layer number", () => {
    const image = { imageUrl: "https://x/a.png", start: 0, slot: 1 }
    const text = (body: Parameters<typeof validateVideoOverlayRequest>[0]) => videoOverlayIssueText(validateVideoOverlayRequest(body) as VideoOverlayIssue, tEn)
    expect(text({ layers: [image], baseBox: { anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" } })).toBe("Moving the base video needs an output aspect")
    expect(text({ layers: [image], layout: "video-bottom" })).toBe("This layout needs an output aspect")
    expect(text({ layers: [image], layout: "pip" })).toBe("This layout needs a video layer — connect a video to a layer handle")
    expect(text({ layers: [image], outputAspect: "9:16", baseBox: { width: 50 } })).toBe("A custom box needs an anchor and a width")
    const video = { videoUrl: "https://x/a.mp4", start: 0, slot: 2 }
    const box = { anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" } as const
    expect(text({ layers: [video], outputAspect: "9:16", layout: "stack-whole", baseBox: box })).toBe("A stack layout places the base video itself — choose Custom to place it yourself")
  })

  it("the base's length cap is a warning (the server's rule, on the priced seconds) once the length is known, in the user's words", () => {
    const video = [{ videoUrl: "https://x/a.mp4", start: 0, slot: 1 }]
    expect(videoOverlayLengthWarning(video, 61)).toEqual({ max: 60, d: 61 })
    expect(videoOverlayLengthWarning(video, 60.04)).toBeUndefined()
    expect(videoOverlayLengthWarning(video, null)).toBeUndefined()
    // An image-only run has no cap.
    expect(videoOverlayLengthWarning([{ imageUrl: "https://x/a.png", start: 0 }], 600)).toBeUndefined()
    const w = videoOverlayLengthWarning(video, 61)!
    expect(videoOverlayLengthWarningText(w, tEn)).toBe("With a video layer the base video can be up to 60 s — this one is 61 s. Trim it, or the run will be refused.")
    expect(videoOverlayLengthWarningText(w, tHe)).toContain("60")
  })

  it("renders the worker's warnings by slot, and the render-wide one without a layer", () => {
    expect(videoOverlayWarningText({ layer: 0, slot: 3, code: "clipped", detail: "…" }, tEn)).toBe("layer 3 clipped to the video end")
    expect(videoOverlayWarningText({ code: "audio_reencoded", detail: "…" }, tEn)).toBe("the audio was re-encoded to AAC")
    expect(videoOverlayWarningText({ layer: 1, slot: 2, code: "layer_no_audio", detail: "…" }, tEn)).toBe("layer 2: the video has no sound, so none was mixed in")
  })
})
