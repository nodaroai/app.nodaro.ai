// @test-always pure request builder — reads no files
import { describe, it, expect } from "vitest"
import {
  buildKling4Request,
  kling4Mentions,
  kling4Name,
  neutralizeUndeclaredMentions,
  type Kling4RequestArgs,
} from "../kling4.js"
import { KLING_4_KEYFRAME_MODEL, KLING_4_REFERENCE_MODEL } from "../models.js"

const IMG = (n: number) => `https://cdn.example/img${n}.png`
const VID = (n: number) => `https://cdn.example/vid${n}.mp4`
const AUD = (n: number) => `https://cdn.example/aud${n}.mp3`

/** Every `@name` left in the prompt is a name the body declares — KIE 422s otherwise. */
function declaredNames(input: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  ;(input.image_urls as string[] | undefined)?.forEach((_, i) => names.add(`image_${i + 1}`))
  ;(input.video_urls as string[] | undefined)?.forEach((_, i) => names.add(`video_${i + 1}`))
  ;(input.keyframe_urls as string[] | undefined)?.forEach((_, i) => names.add(`keyframe_${i + 1}`))
  if (input.first_frame_url) names.add("first_frame")
  if (input.last_frame_url) names.add("last_frame")
  ;(input.elements as Array<{ name: string }> | undefined)?.forEach((e) => names.add(e.name))
  ;(input.voices as Array<{ name: string }> | undefined)?.forEach((v) => names.add(v.name))
  return names
}

function expectEveryMentionDeclared(input: Record<string, unknown>): void {
  const declared = declaredNames(input)
  for (const m of kling4Mentions(input.prompt as string)) {
    expect(declared.has(m), `@${m} is not declared in ${JSON.stringify(input)}`).toBe(true)
  }
}

const ref = (over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({
  provider: "kling-4",
  prompt: "a quiet street at dawn",
  durationSec: 5,
  ...over,
})

describe("buildKling4Request — reference-to-video (kling-4)", () => {
  it("a prompt alone is plain text-to-video: an allow-listed body, integer duration, 720p default", () => {
    const { model, input } = buildKling4Request(ref())
    expect(model).toBe(KLING_4_REFERENCE_MODEL)
    expect(input).toEqual({ prompt: "a quiet street at dawn", duration: 5, resolution: "720p" })
  })

  it("normalizes the resolution (1080p kept, anything else → 720p) and passes a declared aspect", () => {
    expect(buildKling4Request(ref({ resolution: "1080P" })).input.resolution).toBe("1080p")
    expect(buildKling4Request(ref({ resolution: "4k" })).input.resolution).toBe("720p")
    expect(buildKling4Request(ref({ aspectRatio: "21:9" })).input.aspect_ratio).toBe("21:9")
    expect(buildKling4Request(ref({ aspectRatio: "auto" })).input.aspect_ratio).toBe("auto")
    expect(buildKling4Request(ref({ aspectRatio: "4:3" })).input).not.toHaveProperty("aspect_ratio")
  })

  it("demotes a start frame into the reference images after the caller's own, named as the opening frame", () => {
    const { input } = buildKling4Request(ref({ prompt: "@image_1 waves", startFrameUrl: IMG(9), referenceImageUrls: [IMG(1)] }))
    expect(input.image_urls).toEqual([IMG(1), IMG(9)])
    expect(input.prompt).toContain("@image_1 waves")
    expect(input.prompt).toContain("@image_2")
    expect(input).not.toHaveProperty("first_frame_url")
    expectEveryMentionDeclared(input)
  })

  it("sends reference videos with keep_original_sound, and only with videos", () => {
    const withVideo = buildKling4Request(ref({ prompt: "recreate @video_1", referenceVideoUrls: [VID(1)], keepOriginalSound: true })).input
    expect(withVideo.video_urls).toEqual([VID(1)])
    expect(withVideo.keep_original_sound).toBe(true)
    const noVideo = buildKling4Request(ref({ keepOriginalSound: true })).input
    expect(noVideo).not.toHaveProperty("keep_original_sound")
  })

  it("turns reference audio into named voices and rewrites @audio_N to the voice name", () => {
    const { input } = buildKling4Request(ref({ prompt: "she sings in the voice of @audio_1", referenceAudioUrls: [AUD(1), AUD(2)] }))
    expect(input.voices).toEqual([
      { name: "Voice1", audio_url: AUD(1) },
      { name: "Voice2", audio_url: AUD(2) },
    ])
    expect(input.prompt).toBe("she sings in the voice of @Voice1")
  })

  it("turns a character's seated image into its subject: @image_N becomes @Name and later seats renumber", () => {
    // The platform seated plain ref IMG(1) at @image_1 and the character's
    // canonical IMG(5) at @image_2; IMG(3) is a third plain ref.
    const { input } = buildKling4Request(ref({
      prompt: "the person from @image_2 picks up the cup from @image_3 near @image_1",
      referenceImageUrls: [IMG(1), IMG(5), IMG(3)],
      characterReferences: [{ name: "Maya Lee", imageUrl: IMG(5), extraImageUrls: [IMG(6), IMG(7)], description: "Short silver hair" }],
    }))
    expect(input.image_urls).toEqual([IMG(1), IMG(3)])
    expect(input.elements).toEqual([
      { name: "Maya_Lee", image_urls: [IMG(5), IMG(6), IMG(7)], tag: "character", description: "Short silver hair" },
    ])
    expect(input.prompt).toBe("the person from @Maya_Lee picks up the cup from @image_2 near @image_1")
    expectEveryMentionDeclared(input)
  })

  it("rewrites a caller's raw subject name to its Kling name", () => {
    const { input } = buildKling4Request(ref({
      prompt: "@Maya Lee walks in",
      characterReferences: [{ name: "Maya Lee", imageUrl: IMG(5), bodyImageUrl: IMG(6), description: "x" }],
    }))
    expect(input.prompt).toBe("@Maya_Lee walks in")
    expectEveryMentionDeclared(input)
  })

  it("a single-image character stays a reference image, named by its seat", () => {
    const { input } = buildKling4Request(ref({
      prompt: "@Kira smiles",
      characterReferences: [{ name: "Kira", imageUrl: IMG(5), description: "x" }],
    }))
    expect(input).not.toHaveProperty("elements")
    expect(input.image_urls).toEqual([IMG(5)])
    expect(input.prompt).toBe("@image_1 smiles")
  })

  it("caps a subject at 4 images and descriptions at 100 chars", () => {
    const { input } = buildKling4Request(ref({
      characterReferences: [{ name: "A", imageUrl: IMG(1), bodyImageUrl: IMG(2), extraImageUrls: [IMG(3), IMG(4), IMG(5)], description: "d".repeat(150) }],
    }))
    const el = (input.elements as Array<{ image_urls: string[]; description: string }>)[0]!
    expect(el.image_urls).toHaveLength(4)
    expect(el.description).toHaveLength(100)
  })

  it("drops the @ from every mention the body does not declare (KIE 422s an undeclared one)", () => {
    const { input } = buildKling4Request(ref({ prompt: "@image_1 and @video_2 meet @Nobody, mail me at a@b.com" }))
    expect(input.prompt).toBe("image_1 and video_2 meet Nobody, mail me at ab.com")
    expectEveryMentionDeclared(input)
  })

  it("never declares a reserved or duplicate name", () => {
    const { input } = buildKling4Request(ref({
      referenceAudioUrls: [AUD(1)],
      characterReferences: [
        { name: "image_1", imageUrl: IMG(1), bodyImageUrl: IMG(2), description: "x" },
        { name: "Voice1", imageUrl: IMG(3), bodyImageUrl: IMG(4), description: "x" },
        { name: "voice1", imageUrl: IMG(5), bodyImageUrl: IMG(6), description: "x" },
      ],
    }))
    const names = [...(input.elements as Array<{ name: string }>).map((e) => e.name), ...(input.voices as Array<{ name: string }>).map((v) => v.name)]
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
    for (const n of names) expect(n).not.toMatch(/^(image|video|keyframe|object|audio)_\d+$|^(first|last)_frame$/i)
  })
})

describe("buildKling4Request — keyframe-to-video (kling-4-keyframes)", () => {
  const kf = (over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({
    provider: "kling-4-keyframes",
    prompt: "the girl walks out",
    durationSec: 5,
    ...over,
  })

  it("sends start, in-between (Image References, in order) and end frames, renaming @image_N to @keyframe_N", () => {
    const { model, input } = buildKling4Request(kf({
      prompt: "from @first_frame through @image_1 and @image_2 to @last_frame",
      startFrameUrl: IMG(1),
      referenceImageUrls: [IMG(2), IMG(3)],
      endFrameUrl: IMG(4),
    }))
    expect(model).toBe(KLING_4_KEYFRAME_MODEL)
    expect(input).toEqual({
      prompt: "from @first_frame through @keyframe_1 and @keyframe_2 to @last_frame",
      duration: 5,
      resolution: "720p",
      first_frame_url: IMG(1),
      keyframe_urls: [IMG(2), IMG(3)],
      last_frame_url: IMG(4),
    })
  })

  it("trims in-between frames to the duration's frame cap (live 422: 3s takes 4 frames in all)", () => {
    const { input, notes } = buildKling4Request(kf({
      durationSec: 3,
      startFrameUrl: IMG(1),
      referenceImageUrls: [IMG(2), IMG(3), IMG(4)],
      endFrameUrl: IMG(5),
    }))
    expect(input.keyframe_urls).toEqual([IMG(2), IMG(3)])
    expect(notes.join(" ")).toMatch(/dropped 1 in-between frame/)
  })

  it("takes at most 8 in-between frames even at 30s", () => {
    const refs = Array.from({ length: 10 }, (_, i) => IMG(i))
    expect((buildKling4Request(kf({ durationSec: 30, referenceImageUrls: refs })).input.keyframe_urls as string[]).length).toBe(8)
  })

  it("an end frame alone stays the END; the ratio is sent only for a frameless run", () => {
    const endOnly = buildKling4Request(kf({ endFrameUrl: IMG(4), aspectRatio: "9:16" })).input
    expect(endOnly.last_frame_url).toBe(IMG(4))
    expect(endOnly).not.toHaveProperty("first_frame_url")
    expect(endOnly).not.toHaveProperty("aspect_ratio")
    expect(buildKling4Request(kf({ aspectRatio: "9:16" })).input.aspect_ratio).toBe("9:16")
  })

  it("drops mentions of frames the run does not carry", () => {
    const { input } = buildKling4Request(kf({ prompt: "@first_frame then @image_3 then @last_frame", referenceImageUrls: [IMG(2)] }))
    expect(input.prompt).toBe("first_frame then image_3 then last_frame")
    expectEveryMentionDeclared(input)
  })
})

describe("every mention is declared — the property KIE enforces", () => {
  it("holds over a sweep of wiring shapes on both endpoints", () => {
    const prompts = [
      "@image_1 @image_2 @image_3 @video_1 @video_2 @audio_1 @audio_3 @Maya @Kira @first_frame @keyframe_2 @last_frame",
      "the person from @image_2 meets the person from @image_4 — @image_10",
    ]
    for (const provider of ["kling-4", "kling-4-keyframes"] as const) {
      for (const prompt of prompts) {
        for (let images = 0; images <= 4; images++) {
          for (const withChars of [false, true]) {
            for (const frames of [[], ["start"], ["end"], ["start", "end"]] as const) {
              const { input } = buildKling4Request({
                provider,
                prompt,
                durationSec: 9,
                referenceImageUrls: Array.from({ length: images }, (_, i) => IMG(i + 1)),
                referenceVideoUrls: provider === "kling-4" ? [VID(1)] : undefined,
                referenceAudioUrls: provider === "kling-4" ? [AUD(1)] : undefined,
                startFrameUrl: frames.includes("start" as never) ? IMG(90) : undefined,
                endFrameUrl: frames.includes("end" as never) ? IMG(91) : undefined,
                characterReferences: withChars
                  ? [{ name: "Maya", imageUrl: IMG(2), extraImageUrls: [IMG(50)], description: "x" }, { name: "Kira", imageUrl: IMG(60), description: "y" }]
                  : undefined,
              })
              expectEveryMentionDeclared(input)
            }
          }
        }
      }
    }
  })
})

describe("kling4Name / neutralizeUndeclaredMentions", () => {
  it("sanitizes to KIE's name pattern and never returns a reserved name", () => {
    expect(kling4Name("Maya Lee", "C")).toBe("Maya_Lee")
    expect(kling4Name("  ", "Character1")).toBe("Character1")
    expect(kling4Name("Élodie-Rose", "C")).toBe("Elodie_Rose")
    expect(kling4Name("a".repeat(40), "C")).toHaveLength(20)
    expect(kling4Name("first_frame", "C")).not.toBe("first_frame")
    expect(kling4Name("audio_2", "C")).not.toMatch(/^audio_\d+$/)
  })

  it("keeps an exact declared mention (case-folded to its declared spelling)", () => {
    expect(neutralizeUndeclaredMentions("@maya and @Maya_s", ["Maya"])).toBe("@Maya and Maya_s")
  })
})
