import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "../helpers"
import { pixverseV6MaxAudioOn, pixverseV6MaxSeedInput } from "../pixverse-v6-max-fields"
import { getAspectRatiosForVideoModel, getVideoResolutionOptions, VIDEO_DURATION_OPTIONS, VIDEO_GEN_MODELS, VIDEO_I2V_MODELS, VIDEO_T2V_MODELS } from "../model-options"
import { videoGenerationCreditId } from "@nodaro/shared/credits"
import type { WorkflowNode } from "@/types/nodes"

/**
 * PixVerse V6 Max in the editor: the model menus offer it, the panel's audio
 * switch shows the state the run bills, and the run-level estimate (the
 * Execute-button badge, the run-confirm dialog) names the same row as the
 * node's own pill (`videoGenerationCreditId`) and the server's reservation
 * (backend pixverse-v6-max-pricing.test.ts holds those to the same ids).
 */
const ID = "pixverse-v6-max"

function videoNode(type: string, data: Record<string, unknown>): WorkflowNode {
  return {
    id: "pv-1",
    type,
    position: { x: 0, y: 0 },
    data: { label: "Generate Video", provider: ID, prompt: "a lighthouse in a storm", ...data },
  } as unknown as WorkflowNode
}

describe("PixVerse V6 Max — the editor's menus and options", () => {
  it("is offered by Generate Video, Image to Video and Text to Video", () => {
    for (const menu of [VIDEO_GEN_MODELS, VIDEO_I2V_MODELS, VIDEO_T2V_MODELS]) {
      expect(menu.map((m) => m.value)).toContain(ID)
    }
  })

  it("its options come from the catalog: 1-15 s, four qualities, eight ratios", () => {
    expect(VIDEO_DURATION_OPTIONS[ID]?.map((o) => o.value)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    expect(getVideoResolutionOptions(ID)?.map((o) => o.value)).toEqual(["360p", "540p", "720p", "1080p"])
    expect(getAspectRatiosForVideoModel(ID).map((o) => o.value)).toEqual(["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"])
  })
})

describe("PixVerse V6 Max — the panel's audio switch and seed", () => {
  it("shows the audio state the run bills: `sound`, then an older `kling3Sound`, then `generateAudio`, then on", () => {
    expect(pixverseV6MaxAudioOn({})).toBe(true)
    expect(pixverseV6MaxAudioOn({ sound: false })).toBe(false)
    expect(pixverseV6MaxAudioOn({ sound: true, kling3Sound: false })).toBe(true)
    expect(pixverseV6MaxAudioOn({ kling3Sound: false })).toBe(false)
    expect(pixverseV6MaxAudioOn({ generateAudio: false })).toBe(false)
    expect(pixverseV6MaxAudioOn({ sound: true, generateAudio: false })).toBe(true)
  })

  it("keeps a seed only as a whole number 0-2147483647", () => {
    expect(pixverseV6MaxSeedInput("")).toBeUndefined()
    expect(pixverseV6MaxSeedInput("  ")).toBeUndefined()
    expect(pixverseV6MaxSeedInput("0")).toBe(0)
    expect(pixverseV6MaxSeedInput("123456")).toBe(123456)
    expect(pixverseV6MaxSeedInput("2147483647")).toBe(2147483647)
    for (const raw of ["-1", "1.5", "2147483648", "abc"]) expect(pixverseV6MaxSeedInput(raw), raw).toBeUndefined()
  })
})

describe("PixVerse V6 Max — the run estimate names the row the run reserves", () => {
  const CASES: Array<{ data: Record<string, unknown>; expected: string }> = [
    { data: {}, expected: `${ID}:5s:720p:audio` },
    { data: { sound: false }, expected: `${ID}:5s:720p` },
    { data: { duration: 1, resolution: "360p", sound: false }, expected: `${ID}:1s:360p` },
    { data: { duration: 3, resolution: "540p", sound: true }, expected: `${ID}:3s:540p:audio` },
    { data: { duration: 15, resolution: "1080p" }, expected: `${ID}:15s:1080p:audio` },
    { data: { duration: 6, resolution: "540p", kling3Sound: false }, expected: `${ID}:6s:540p` },
    { data: { duration: 7, resolution: "720p", generateAudio: false }, expected: `${ID}:7s:720p` },
    { data: { duration: 7, resolution: "720p", sound: true, generateAudio: false }, expected: `${ID}:7s:720p:audio` },
  ]
  for (const { data, expected } of CASES) {
    it(`${JSON.stringify(data)} → ${expected}`, () => {
      for (const type of ["generate-video", "image-to-video", "text-to-video"]) {
        expect(getModelIdentifier(videoNode(type, data)), type).toBe(expected)
      }
      // The node pill's quote (generate-video-node.tsx: `sound ?? kling3Sound`, then `generateAudio`).
      const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
      expect(videoGenerationCreditId({
        provider: ID,
        duration: data.duration as number | undefined,
        sound,
        generateAudio: data.generateAudio as boolean | undefined,
        resolution: data.resolution as string | undefined,
      })).toBe(expected)
      // And the panel's audio box shows the state that row bills.
      expect(pixverseV6MaxAudioOn(data as Parameters<typeof pixverseV6MaxAudioOn>[0])).toBe(expected.endsWith(":audio"))
    })
  }
})
