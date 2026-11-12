import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { applySeedance2Params } from "../video.js"

// ---------------------------------------------------------------------------
// `omni_reference_task_type` — the declared Seedance 2.5 reference task type
// (`ProviderOptions.referenceTaskType`) on the KIE body.
//
// The routes resolve the declaration before pricing; the adapter is the last
// line of defence and writes the field only on a body the provider takes it
// on: a model whose catalog lists the value (a draft included), at least one
// `reference_*_urls` on the body after the shared resolver ran (for `edit` and
// `extend`, a `reference_video_urls`), no `first_frame_url` (KIE refuses
// the field on text-only and frame-mode tasks: "only supported in multimodal
// reference tasks"), and for `edit` and `extend` a body in that type's shape
// (`edit`: adaptive and -1; `extend`: adaptive). Without the option the body is
// exactly today's.
// ---------------------------------------------------------------------------

const VIDEO = "https://r2.example.com/videos/source.mp4"
const FRAME = "https://r2.example.com/images/frame.png"
const END_FRAME = "https://r2.example.com/images/end.png"
const AUDIO = "https://r2.example.com/audio/voice.mp3"

/** A Seedance 2.5 edit as the routes queue it: "adaptive" and Auto length. */
const editInput = (): Record<string, unknown> => ({ prompt: "make it night", duration: -1 })
const editOptions = () => ({ aspectRatio: "adaptive", resolution: "720p", referenceVideoUrls: [VIDEO] })

/** The body that request produces today — captured, not derived. */
const EDIT_BODY_TODAY = {
  prompt: "make it night",
  duration: -1,
  web_search: false,
  aspect_ratio: "adaptive",
  resolution: "720p",
  reference_video_urls: [VIDEO],
}

function body(input: Record<string, unknown>, options: Record<string, unknown>, provider?: string): Record<string, unknown> {
  applySeedance2Params(input, options as never, provider)
  return input
}

describe("applySeedance2Params — omni_reference_task_type", () => {
  it("writes the field in reference mode", () => {
    const input = body(editInput(), { ...editOptions(), referenceTaskType: "edit" }, "seedance-2-5")
    expect(input.omni_reference_task_type).toBe("edit")
    // Nothing else moves: the field is the only difference from today's body.
    expect(input).toEqual({ ...EDIT_BODY_TODAY, omni_reference_task_type: "edit" })
  })

  it("writes each value the model lists", () => {
    for (const taskType of ["reference", "edit", "extend"]) {
      const input = body(editInput(), { ...editOptions(), referenceTaskType: taskType }, "seedance-2-5")
      expect(input.omni_reference_task_type, taskType).toBe(taskType)
    }
  })

  it("a start frame beside a reference video still gets it (the frame rides as a reference image)", () => {
    const input = body(
      { prompt: "she walks on", first_frame_url: FRAME, duration: 8 },
      { aspectRatio: "adaptive", referenceVideoUrls: [VIDEO], referenceTaskType: "extend" },
      "seedance-2-5",
    )
    expect("first_frame_url" in input).toBe(false)
    expect(input.reference_image_urls).toEqual([FRAME])
    expect(input.reference_video_urls).toEqual([VIDEO])
    expect(input.omni_reference_task_type).toBe("extend")
  })

  it("reference audio alone is reference media: it gets it", () => {
    const input = body(
      { prompt: "she sings", duration: 8 },
      { aspectRatio: "16:9", referenceAudioUrls: [AUDIO], referenceTaskType: "reference" },
      "seedance-2-5",
    )
    expect(input.reference_audio_urls).toEqual([AUDIO])
    expect(input.omni_reference_task_type).toBe("reference")
  })

  it("a start frame with reference audio only (the voiced shape): the frame is moved into the reference images and it gets it", () => {
    const input = body(
      { prompt: "she sings", first_frame_url: FRAME, duration: 8 },
      { aspectRatio: "adaptive", referenceAudioUrls: [AUDIO], referenceTaskType: "reference" },
      "seedance-2-5",
    )
    expect("first_frame_url" in input).toBe(false)
    expect(input.reference_image_urls).toEqual([FRAME])
    expect(input.reference_audio_urls).toEqual([AUDIO])
    expect("reference_video_urls" in input).toBe(false)
    expect(input.omni_reference_task_type).toBe("reference")
  })

  it("reference images alone are reference media for `reference`: it gets it", () => {
    const input = body(
      { prompt: "she sings", duration: 8 },
      { aspectRatio: "16:9", referenceImageUrls: [FRAME], referenceTaskType: "reference" },
      "seedance-2-5",
    )
    expect(input.omni_reference_task_type).toBe("reference")
  })

  it("edit with only reference images never gets it: an edit needs a reference video", () => {
    const input = body(
      { prompt: "make it night", duration: -1 },
      { aspectRatio: "adaptive", referenceImageUrls: [FRAME], referenceTaskType: "edit" },
      "seedance-2-5",
    )
    expect(input.reference_image_urls).toEqual([FRAME])
    expect("reference_video_urls" in input).toBe(false)
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("extend with only reference audio never gets it: an extension needs a reference video", () => {
    const input = body(
      { prompt: "she sings on", duration: 8 },
      { aspectRatio: "adaptive", referenceAudioUrls: [AUDIO], referenceTaskType: "extend" },
      "seedance-2-5",
    )
    expect(input.reference_audio_urls).toEqual([AUDIO])
    expect("reference_video_urls" in input).toBe(false)
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("a start frame alone never gets it", () => {
    const input = body(
      { prompt: "she walks on", first_frame_url: FRAME, duration: 8 },
      { aspectRatio: "adaptive", referenceTaskType: "reference" },
      "seedance-2-5",
    )
    expect(input.first_frame_url).toBe(FRAME)
    expect("reference_image_urls" in input).toBe(false)
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("a start and an end frame never get it", () => {
    const input = body(
      { prompt: "she walks on", first_frame_url: FRAME, last_frame_url: END_FRAME, duration: 8 },
      { aspectRatio: "adaptive", referenceTaskType: "reference" },
      "seedance-2-5",
    )
    expect(input.first_frame_url).toBe(FRAME)
    expect(input.last_frame_url).toBe(END_FRAME)
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("text only never gets it", () => {
    const input = body(
      { prompt: "a city at night", duration: 8 },
      { aspectRatio: "16:9", referenceTaskType: "reference" },
      "seedance-2-5",
    )
    for (const key of ["first_frame_url", "reference_image_urls", "reference_video_urls", "reference_audio_urls"]) {
      expect(key in input, key).toBe(false)
    }
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("a draft gets it exactly as a run without Draft, at 480p", () => {
    for (const taskType of ["reference", "edit", "extend"]) {
      const input = body(editInput(), { ...editOptions(), draft: true, referenceTaskType: taskType }, "seedance-2-5")
      expect(input, taskType).toEqual({ ...EDIT_BODY_TODAY, draft: true, resolution: "480p", omni_reference_task_type: taskType })
    }
  })

  it("a draft without the option is the draft body of today (no field)", () => {
    const input = body(editInput(), { ...editOptions(), draft: true }, "seedance-2-5")
    expect(input).toEqual({ ...EDIT_BODY_TODAY, draft: true, resolution: "480p" })
  })

  it("seedance-2 never gets it", () => {
    for (const provider of ["seedance-2", "seedance-2-fast", "seedance-2-mini"]) {
      const input = body(editInput(), { ...editOptions(), referenceTaskType: "edit" }, provider)
      expect(input.reference_video_urls, provider).toEqual([VIDEO])
      expect("omni_reference_task_type" in input, provider).toBe(false)
    }
  })

  it("no provider argument never gets it (an unknown model fails closed)", () => {
    const input = body(editInput(), { ...editOptions(), referenceTaskType: "edit" })
    expect("omni_reference_task_type" in input).toBe(false)
  })

  it("a value the model does not list never gets it", () => {
    for (const value of ["auto", "EDIT", "rewrite", 1, null]) {
      const input = body(editInput(), { ...editOptions(), referenceTaskType: value }, "seedance-2-5")
      expect("omni_reference_task_type" in input, String(value)).toBe(false)
    }
  })

  describe("edit and extend only in their own shape", () => {
    // A caller that skips the routes (a plugin queueing free-form job data)
    // could declare `edit` or `extend` on a body the provider refuses it on.
    let warn: ReturnType<typeof vi.spyOn>
    beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}) })
    afterEach(() => { warn.mockRestore() })

    const styled = (): Record<string, unknown> => ({ prompt: "make it night", duration: 5 })
    const styledOptions = () => ({ aspectRatio: "16:9", resolution: "720p", referenceVideoUrls: [VIDEO] })

    it.each([
      ["edit on a 16:9, 5 s body", "edit", styledOptions(), styled],
      ["edit on an adaptive body at a set length", "edit", { ...styledOptions(), aspectRatio: "adaptive" }, styled],
      ["extend on a 16:9 body", "extend", styledOptions(), styled],
    ] as const)("%s: no field, one warning, and the rest of the body as without the option", (_name, taskType, options, input) => {
      const declared = body(input(), { ...options, referenceTaskType: taskType }, "seedance-2-5")
      const undeclared = body(input(), options, "seedance-2-5")
      expect("omni_reference_task_type" in declared).toBe(false)
      expect(declared).toEqual(undeclared)
      expect(JSON.stringify(declared)).toBe(JSON.stringify(undeclared))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain(taskType)
    })

    it("edit in the edit shape and extend at adaptive still get it, with no warning", () => {
      expect(body(editInput(), { ...editOptions(), referenceTaskType: "edit" }, "seedance-2-5").omni_reference_task_type).toBe("edit")
      expect(body(styled(), { ...styledOptions(), aspectRatio: "adaptive", referenceTaskType: "extend" }, "seedance-2-5").omni_reference_task_type).toBe("extend")
      expect(warn).not.toHaveBeenCalled()
    })

    it("reference keeps any shape", () => {
      expect(body(styled(), { ...styledOptions(), referenceTaskType: "reference" }, "seedance-2-5").omni_reference_task_type).toBe("reference")
      expect(warn).not.toHaveBeenCalled()
    })
  })

  it("no option, no field: the body is today's", () => {
    const input = body(editInput(), editOptions(), "seedance-2-5")
    expect(input).toEqual(EDIT_BODY_TODAY)
    expect("omni_reference_task_type" in input).toBe(false)
    // An absent value is the same as no option at all.
    const undefinedValue = body(editInput(), { ...editOptions(), referenceTaskType: undefined }, "seedance-2-5")
    expect(undefinedValue).toEqual(EDIT_BODY_TODAY)
    expect("omni_reference_task_type" in undefinedValue).toBe(false)
  })
})
