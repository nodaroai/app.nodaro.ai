// @test-always pure request builder — reads no files
import { describe, it, expect } from "vitest"
import { buildKling4Request, kling4FlashEndpoint, kling4Mentions, type Kling4RequestArgs } from "../kling4.js"
import { KLING_4_FLASH_REFERENCE_MODEL, KLING_4_REFERENCE_MODEL } from "../models.js"

/**
 * Video subjects (decided 2026-11-13): a character reference with a `videoUrl`
 * is a Kling subject made from that clip. Its clip arrives SEATED among the
 * reference videos (the routes' and the payload builder's `seatCharacterVideos`
 * — how it was measured and priced), and the builder takes the seat back out.
 *
 * Element key sets, per KIE's schemas (both `additionalProperties: false`,
 * docs.kie.ai/market/kling/v4-reference-to-video and
 * v4-flash-reference-to-video, read 2026-11-13): Kling 4.0's element has no
 * `type`; Flash's names a video element `type: "video"`. A video element never
 * carries `image_urls`.
 */
const IMG = (n: number) => `https://cdn.example/img${n}.png`
const VID = (n: number) => `https://cdn.example/vid${n}.mp4`
const CLIP = (n: number) => `https://cdn.example/clip${n}.mp4`
const AUD = (n: number) => `https://cdn.example/aud${n}.mp3`

const args = (provider: Kling4RequestArgs["provider"], over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({
  provider,
  prompt: "they meet at the station",
  durationSec: 5,
  ...over,
})
const videoCharacter = (name: string, clip: string, portrait = IMG(90)) => ({ name, imageUrl: portrait, description: `${name} in a red coat`, videoUrl: clip })
const imageCharacter = (name: string, base: number) => ({ name, imageUrl: IMG(base), extraImageUrls: [IMG(base + 1)], description: `${name} in blue` })

type Element = Record<string, unknown>
const elementsOf = (input: Record<string, unknown>) => (input.elements as Element[] | undefined) ?? []

describe("a video subject's element", () => {
  it("Kling 4.0: { name, video_url, tag: character, description } — no type, no image_urls", () => {
    const { model, input } = buildKling4Request(args("kling-4", {
      prompt: "@video_1 waves",
      referenceVideoUrls: [CLIP(1)],
      characterReferences: [videoCharacter("Maya", CLIP(1))],
    }))
    expect(model).toBe(KLING_4_REFERENCE_MODEL)
    expect(elementsOf(input)).toEqual([{ name: "Maya", video_url: CLIP(1), tag: "character", description: "Maya in a red coat" }])
    expect(input.video_urls).toBeUndefined()
    expect(input.keep_original_sound).toBeUndefined()
    expect(input.prompt).toBe("@Maya waves")
  })

  it("Kling 4.0 Flash: the same, with type: video", () => {
    const { model, input } = buildKling4Request(args("kling-4-flash", {
      referenceVideoUrls: [CLIP(1)],
      characterReferences: [videoCharacter("Maya", CLIP(1))],
    }))
    expect(model).toBe(KLING_4_FLASH_REFERENCE_MODEL)
    expect(elementsOf(input)).toEqual([{ name: "Maya", video_url: CLIP(1), type: "video", tag: "character", description: "Maya in a red coat" }])
    for (const el of elementsOf(input)) {
      expect(Object.keys(el).every((k) => ["name", "type", "image_urls", "video_url", "tag", "description", "voice_url"].includes(k))).toBe(true)
    }
  })

  it("an image subject beside it keeps its own shape (no type on either model)", () => {
    for (const provider of ["kling-4", "kling-4-flash"] as const) {
      const { input } = buildKling4Request(args(provider, {
        referenceVideoUrls: [CLIP(1)],
        characterReferences: [imageCharacter("Leo", 10), videoCharacter("Maya", CLIP(1))],
      }))
      const [leo, maya] = elementsOf(input)
      expect(leo, provider).toEqual({ name: "Leo", image_urls: [IMG(10), IMG(11)], tag: "character", description: "Leo in blue" })
      expect(maya!.video_url).toBe(CLIP(1))
      expect(maya!.image_urls).toBeUndefined()
    }
  })

  it("a video subject with only its portrait is still a subject (no single-image fallback)", () => {
    const { input } = buildKling4Request(args("kling-4", {
      prompt: "@image_1 smiles",
      referenceImageUrls: [IMG(90)],
      referenceVideoUrls: [CLIP(1)],
      characterReferences: [videoCharacter("Maya", CLIP(1), IMG(90))],
    }))
    // Its portrait's seat is the subject too: the image leaves the list.
    expect(input.image_urls).toBeUndefined()
    expect(elementsOf(input).map((e) => e.name)).toEqual(["Maya"])
    expect(input.prompt).toBe("@Maya smiles")
  })
})

describe("the clip's seat leaves the reference videos; the others renumber", () => {
  it("references before the seat keep their numbers; one after it moves down", () => {
    const { input } = buildKling4Request(args("kling-4", {
      prompt: "@video_1 is the room, @video_2 is Maya, @video_3 the street",
      referenceVideoUrls: [VID(1), CLIP(1), VID(2)],
      characterReferences: [videoCharacter("Maya", CLIP(1))],
      keepOriginalSound: true,
    }))
    expect(input.video_urls).toEqual([VID(1), VID(2)])
    expect(input.keep_original_sound).toBe(true)
    expect(input.prompt).toBe("@video_1 is the room, @Maya is Maya, @video_2 the street")
    expect(kling4Mentions(input.prompt as string).every((m) => ["video_1", "video_2", "Maya"].includes(m))).toBe(true)
  })

  it("Kling 4.0 audio soundtrack after the subject's seat: its mention is @video_{plain references + 1}", () => {
    // The route seats the subject's clip, then the soundtrack clip (its mention
    // written as the next seat): [ref, clip, soundtrack] → `@video_3`.
    const { input } = buildKling4Request(args("kling-4", {
      prompt: "@Maya sings over @video_3",
      referenceVideoUrls: [VID(1), CLIP(1), VID(9)],
      characterReferences: [videoCharacter("Maya", CLIP(1))],
      keepOriginalSound: true,
    }))
    expect(input.video_urls).toEqual([VID(1), VID(9)])
    expect(input.prompt).toBe("@Maya sings over @video_2")
  })

  it("a clip the request does not seat still makes the subject (pure builder; the routes seat it)", () => {
    const { input } = buildKling4Request(args("kling-4", { characterReferences: [videoCharacter("Maya", CLIP(1))] }))
    expect(elementsOf(input)).toHaveLength(1)
    expect(input.video_urls).toBeUndefined()
  })

  it("without a video subject the numbering is exactly as before", () => {
    const { input } = buildKling4Request(args("kling-4", {
      prompt: "@video_1 then @video_2 then @video_7",
      referenceVideoUrls: [VID(1), VID(2)],
    }))
    expect(input.video_urls).toEqual([VID(1), VID(2)])
    expect(input.prompt).toBe("@video_1 then @video_2 then video_7")
  })
})

describe("Kling 4.0 Flash: endpoint and voice", () => {
  it("a run whose only reference is a video subject takes the reference endpoint, even with a start frame", () => {
    const run = args("kling-4-flash", { startFrameUrl: IMG(1), referenceVideoUrls: [CLIP(1)], characterReferences: [videoCharacter("Maya", CLIP(1))] })
    expect(kling4FlashEndpoint(run)).toBe("reference")
    expect(kling4FlashEndpoint({ ...run, referenceVideoUrls: [] })).toBe("reference")
    expect(buildKling4Request(run).model).toBe(KLING_4_FLASH_REFERENCE_MODEL)
  })

  it("reference audio clip N binds to character N whether it is an image or a video subject", () => {
    const { input, notes } = buildKling4Request(args("kling-4-flash", {
      referenceVideoUrls: [CLIP(1)],
      referenceAudioUrls: [AUD(1), AUD(2)],
      characterReferences: [imageCharacter("Leo", 10), videoCharacter("Maya", CLIP(1))],
    }))
    expect(elementsOf(input).map((e) => [e.name, e.voice_url])).toEqual([["Leo", AUD(1)], ["Maya", AUD(2)]])
    expect(notes).toEqual([])
  })

  it("Kling 4.0 keeps its standalone voices beside a video subject (the clip's own speech otherwise)", () => {
    const { input } = buildKling4Request(args("kling-4", {
      referenceVideoUrls: [CLIP(1)],
      referenceAudioUrls: [AUD(1)],
      characterReferences: [videoCharacter("Maya", CLIP(1))],
    }))
    expect(input.voices).toEqual([{ name: "Voice1", audio_url: AUD(1) }])
    expect(elementsOf(input)[0]!.voice_url).toBeUndefined()
  })
})
