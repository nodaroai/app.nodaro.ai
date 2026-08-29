import { describe, it, expect, afterEach, vi } from "vitest"
import { applySeedance2Params, seedance25OutputFormat } from "../video.js"

// ---------------------------------------------------------------------------
// KIE_SEEDANCE_25_OUTPUT_FORMAT — request Seedance 2.5's `mov` container
// (H.264 yuv444p + PCM) instead of the default mp4.
//
// Two invariants this file exists to pin:
//   1. BYTE-IDENTITY. With the lever unset (or "mp4"), and for every provider
//      that is not `seedance-2-5`, the KIE input object is exactly what it is
//      today — no `output_format` key at all, not even `undefined`.
//   2. NO IMPLICIT ENV READ AT THE PROVIDER SEAM. The lever is read by the
//      CALLER (the seedance extend worker, whose deliverable is re-encoded by
//      the stitch). A caller whose raw KIE bytes ARE the deliverable — every
//      generate-video path — must keep getting mp4 even with the lever on,
//      because `storage.ts` stamps a provider video `.mp4` / `video/mp4` and
//      mov bytes under that key would be an unplayable deliverable.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("seedance25OutputFormat — the lever reader", () => {
  it("unset ⇒ mp4", () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
    expect(seedance25OutputFormat()).toBe("mp4")
  })

  it('"mov" ⇒ mov', () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    expect(seedance25OutputFormat()).toBe("mov")
  })

  it('"mp4" ⇒ mp4', () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mp4")
    expect(seedance25OutputFormat()).toBe("mp4")
  })

  it("anything else ⇒ mp4 (fail closed onto today's container)", () => {
    for (const junk of ["MOV ", "webm", "true", "1", ""]) {
      vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", junk)
      expect(seedance25OutputFormat()).toBe("mp4")
    }
  })

  it("is read at CALL time, not at module load", () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mp4")
    expect(seedance25OutputFormat()).toBe("mp4")
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    expect(seedance25OutputFormat()).toBe("mov")
  })
})

// The exact options the seedance extend worker sends today.
const extendOptions = () => ({
  resolution: "720p",
  generateAudio: true,
  referenceVideoUrls: ["https://r2.example.com/videos/tail.mp4"],
  aspectRatio: "adaptive",
})

const extendInput = () => ({
  prompt: "extend @video_1 as follows:\nshe opens the door",
  first_frame_url: "https://r2.example.com/images/frame.png",
  duration: 8,
})

/** The payload today's extend call produces — captured, not derived. */
const EXPECTED_TODAY = {
  prompt:
    "extend @video_1 as follows:\nshe opens the door\n\nUse @image_1 as the opening (first) frame of the video.",
  duration: 8,
  web_search: false,
  aspect_ratio: "adaptive",
  resolution: "720p",
  reference_image_urls: ["https://r2.example.com/images/frame.png"],
  reference_video_urls: ["https://r2.example.com/videos/tail.mp4"],
}

describe("applySeedance2Params — output_format", () => {
  it("byte-identical today: no outputFormat option ⇒ no output_format key (seedance-2)", () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, extendOptions() as never, "seedance-2")
    expect(input).toEqual(EXPECTED_TODAY)
    expect("output_format" in input).toBe(false)
  })

  it("byte-identical today: no outputFormat option ⇒ no output_format key (seedance-2-5)", () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, extendOptions() as never, "seedance-2-5")
    expect("output_format" in input).toBe(false)
  })

  it("the lever alone does NOT reach the payload — the caller must opt in", () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, extendOptions() as never, "seedance-2-5")
    expect("output_format" in input).toBe(false)
    expect(input).toEqual(EXPECTED_TODAY)
  })

  it('outputFormat "mov" on seedance-2-5 ⇒ output_format: "mov", nothing else moves', () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, { ...extendOptions(), outputFormat: "mov" } as never, "seedance-2-5")
    expect(input.output_format).toBe("mov")
    expect(input).toEqual({ ...EXPECTED_TODAY, output_format: "mov" })
  })

  it('outputFormat "mov" on seedance-2 (2.0 has NO such KIE field) ⇒ absent', () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, { ...extendOptions(), outputFormat: "mov" } as never, "seedance-2")
    expect("output_format" in input).toBe(false)
  })

  it('outputFormat "mov" with NO provider argument ⇒ absent (unknown model, fail closed)', () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, { ...extendOptions(), outputFormat: "mov" } as never)
    expect("output_format" in input).toBe(false)
  })

  it('outputFormat "mp4" is never sent — mp4 is KIE\'s default and today sends no field', () => {
    const input: Record<string, unknown> = extendInput()
    applySeedance2Params(input, { ...extendOptions(), outputFormat: "mp4" } as never, "seedance-2-5")
    expect("output_format" in input).toBe(false)
  })

  it("seedance-2-fast / seedance-2-mini never receive the field either", () => {
    for (const provider of ["seedance-2-fast", "seedance-2-mini"]) {
      const input: Record<string, unknown> = extendInput()
      applySeedance2Params(input, { ...extendOptions(), outputFormat: "mov" } as never, provider)
      expect("output_format" in input).toBe(false)
    }
  })
})
