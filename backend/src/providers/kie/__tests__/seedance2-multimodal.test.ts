import { describe, it, expect } from "vitest"
import { applySeedance2Params } from "../video.js"

// The i2v caller deletes `first_frame_url` when applySeedance2Params reports
// `hasMultimodalRef === true`. Seedance lip-sync passes a face image
// (→ first_frame_url) PLUS reference audio (the voice line). If audio counted
// as a multimodal ref, the face would be deleted and lip-sync would have no
// subject. Reference VIDEO is genuinely mutually exclusive with frames and
// must still gate; reference AUDIO must NOT.
describe("applySeedance2Params — first-frame-deletion gate (hasMultimodalRef)", () => {
  it("reference AUDIO alone does NOT trigger the gate (audio coexists with a first frame — lip-sync)", () => {
    const input: Record<string, unknown> = { first_frame_url: "https://cdn.example/face.png" }
    const { hasMultimodalRef } = applySeedance2Params(input, {
      referenceAudioUrls: ["https://cdn.example/voice.mp3"],
    })
    expect(hasMultimodalRef).toBe(false)
    // audio is still forwarded to KIE…
    expect(input.reference_audio_urls).toEqual(["https://cdn.example/voice.mp3"])
    // …and because the gate is false, the caller keeps the face frame.
  })

  it("reference VIDEO triggers the gate (mutually exclusive with frames)", () => {
    const { hasMultimodalRef } = applySeedance2Params({}, {
      referenceVideoUrls: ["https://cdn.example/clip.mp4"],
    })
    expect(hasMultimodalRef).toBe(true)
  })

  it("reference IMAGE alone does not trigger the gate (image refs are stripped upstream in frames mode)", () => {
    const { hasMultimodalRef } = applySeedance2Params({}, {
      referenceImageUrls: ["https://cdn.example/ref.png"],
    })
    expect(hasMultimodalRef).toBe(false)
  })

  it("a first frame with reference audio together keeps the gate closed (the lip-sync shape)", () => {
    const input: Record<string, unknown> = { first_frame_url: "https://cdn.example/face.png" }
    const { hasMultimodalRef } = applySeedance2Params(input, {
      referenceAudioUrls: ["https://cdn.example/voice.mp3"],
      generateAudio: false,
    })
    expect(hasMultimodalRef).toBe(false)
    // generate_audio is NO LONGER owned by applySeedance2Params — the shared
    // applyVideoAudioToggle dispatcher sets it from the neutral intent at the
    // call site (so the `sound` toggle reaches Seedance 2, not just `generateAudio`).
    expect(input.generate_audio).toBeUndefined()
  })
})
