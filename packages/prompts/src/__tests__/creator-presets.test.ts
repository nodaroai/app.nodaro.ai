// packages/prompts/src/__tests__/creator-presets.test.ts
import { describe, it, expect } from "vitest"
import { captionRoutesToRemotion, presetApplyClearKeys } from "@nodaro/shared"
import { getFactoryPresets, type FactoryPreset } from "../factory-presets.js"

/** Words that name a recording or viewing device. Plural forms included. */
const DEVICE_WORDS = /\b(?:smartphones?|iphones?|phones?|cameras?|lens(?:es)?|webcams?|laptops?|tablets?|screens?|monitors?|displays?|tripods?|selfie[ -]sticks?)\b/i
/** "adult", or an age phrase in the twenties to sixties. */
const ADULT = /\badults?\b|\bin (?:her|his|their) (?:early |mid-|late )?(?:twenties|thirties|forties|fifties|sixties)\b/i

function preset(nodeType: string, id: string): FactoryPreset {
  const p = getFactoryPresets(nodeType).find((x) => x.id === id)
  if (!p) throw new Error(`${id} is missing from the ${nodeType} catalog`)
  return p
}

describe("creator-preset test helpers (self-check)", () => {
  it("the device pattern finds device words and their plurals, and leaves ordinary words alone", () => {
    for (const s of ["a phone in hand", "two cameras", "the lenses", "a selfie stick", "on screen"]) expect(s).toMatch(DEVICE_WORDS)
    for (const s of ["a hand-held microphone", "deep focus", "the viewer at eye level"]) expect(s).not.toMatch(DEVICE_WORDS)
  })
  it("the adult pattern accepts 'adult' and twenties-to-sixties age phrases only", () => {
    for (const s of ["an adult woman", "in her late twenties", "in his thirties", "in their mid-forties"]) expect(s).toMatch(ADULT)
    for (const s of ["a teenager", "in her teens", "a young woman"]) expect(s).not.toMatch(ADULT)
  })
  it("preset() finds a shipped preset and refuses a missing one", () => {
    expect(preset("add-captions", "add-captions/clean-subtitles").group).toBe("Caption Styles")
    expect(() => preset("add-captions", "add-captions/does-not-exist")).toThrow()
  })
})

describe("Wave 0 — Casual Creator voices", () => {
  const VOICES = ["voice-design/casual-creator-female", "voice-design/casual-creator-male"]

  it("ships both in Narration & Character, right after Meditation Guide, carrying only a voice description", () => {
    for (const id of VOICES) {
      const p = preset("voice-design", id)
      expect(p.group).toBe("Narration & Character")
      expect(Object.keys(p.data)).toEqual(["voiceDescription"])
    }
    const ids = getFactoryPresets("voice-design").map((p) => p.id)
    const i = ids.indexOf("voice-design/meditation-guide")
    expect(ids.slice(i + 1, i + 3)).toEqual(VOICES)
  })

  it("every new voice description names an adult and no recording device", () => {
    for (const id of VOICES) {
      const d = preset("voice-design", id).data.voiceDescription as string
      expect(d, id).toMatch(ADULT)
      expect(d, id).not.toMatch(DEVICE_WORDS)
    }
  })
})

describe("Wave 0 — room tones", () => {
  const TONES = ["text-to-audio/living-room-tone", "text-to-audio/kitchen-hum", "text-to-audio/cafe-murmur"]

  it("ships three loopable room tones in the ambience shape, right after Sci-Fi Drone", () => {
    for (const id of TONES) {
      const p = preset("text-to-audio", id)
      expect(p.group).toBe("Ambiences (loopable)")
      expect(Object.keys(p.data)).toEqual(["provider", "duration", "loop", "promptInfluence", "prompt"])
      expect(p.data).toMatchObject({ provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4 })
    }
    const ids = getFactoryPresets("text-to-audio").map((p) => p.id)
    const i = ids.indexOf("text-to-audio/scifi-drone")
    expect(ids.slice(i + 1, i + 4)).toEqual(TONES)
  })
})

describe("Wave 0 — Site Screenshot Summary", () => {
  it("ships in Extraction right after Product Description, structured, asking for the five labelled lines", () => {
    const p = preset("image-to-text", "image-to-text/site-screenshot-summary")
    expect(p.group).toBe("Extraction")
    expect(p.data.detailLevel).toBe("structured")
    const prompt = p.data.customPrompt as string
    for (const label of ["Section:", "Headings:", "Figures:", "Brand:", "First look:"]) expect(prompt).toContain(label)
    expect(prompt).toContain("exactly as written")
    const ids = getFactoryPresets("image-to-text").map((x) => x.id)
    expect(ids[ids.indexOf("image-to-text/product-desc") + 1]).toBe("image-to-text/site-screenshot-summary")
  })
})

describe("Wave 0 — Hook Generator", () => {
  it("ships in Writing & Marketing right after the script writer, at temperature 0.9, with node defaults for tokens and model", () => {
    const p = preset("llm-chat", "llm-chat/hook-generator")
    expect(p.group).toBe("Writing & Marketing")
    expect(p.data.temperature).toBe(0.9)
    expect(p.data.maxTokens).toBeUndefined()
    expect(p.data.llmModel).toBeUndefined()
    const ids = getFactoryPresets("llm-chat").map((x) => x.id)
    expect(ids[ids.indexOf("llm-chat/script-writer") + 1]).toBe("llm-chat/hook-generator")
  })

  it("states the hook limit and the craft in words, and no rate figure", () => {
    const s = preset("llm-chat", "llm-chat/hook-generator").data.systemPrompt as string
    expect(s).toContain("at most 8 words")
    expect(s).toContain("write 10 different opening lines")
    expect(s).not.toMatch(/per second/i)
  })
})

describe("Wave 0 — Hook Plate and Body Captions", () => {
  const HOOK_PLATE_ID = "add-captions/hook-plate"
  const BODY_ID = "add-captions/body-captions"
  type CaptionInput = Parameters<typeof captionRoutesToRemotion>[0]
  const asInput = (d: Readonly<Record<string, unknown>>): CaptionInput => d as CaptionInput
  // The eight levers that move a subtitle off the plain drawtext burn (captionRoutesToRemotion).
  const ROUTING_LEVERS: readonly string[] = ["look", "fontFamily", "fontWeight", "strokeColor", "strokeWidth", "uppercase", "positionY", "maxWordsPerLine"]

  // Other Nodaro services render these values; a change here changes their output, so it needs its owner's review.
  it("Hook Plate and Body Captions carry exactly these values", () => {
    expect(preset("add-captions", HOOK_PLATE_ID).data).toEqual({
      style: "subtitle", look: "clean", position: "top", positionY: 20, fontSize: 32, fontWeight: 800,
      maxWordsPerLine: 4, color: "#111111", backgroundColor: "#FFFFFF", autoTranscribe: false,
    })
    expect(preset("add-captions", BODY_ID).data).toEqual({
      style: "word-highlight", look: "outline", position: "bottom", positionY: 72, fontSize: 32,
      maxWordsPerLine: 3, color: "#FFFFFF", autoTranscribe: true,
    })
  })

  it("both sit in Caption Styles, right after Top Banner", () => {
    const ids = getFactoryPresets("add-captions").map((p) => p.id)
    const i = ids.indexOf("add-captions/top-banner")
    expect(ids.slice(i + 1, i + 3)).toEqual([HOOK_PLATE_ID, BODY_ID])
    for (const id of [HOOK_PLATE_ID, BODY_ID]) expect(preset("add-captions", id).group).toBe("Caption Styles")
  })

  it("Hook Plate with its line wired as text routes to the styled renderer", () => {
    expect(captionRoutesToRemotion(asInput({ ...preset("add-captions", HOOK_PLATE_ID).data, text: "Sample hook line" }))).toBe(true)
  })

  it("negative control: the same plate stripped of its eight routing levers would burn through drawtext", () => {
    const stripped = Object.fromEntries(
      Object.entries({ ...preset("add-captions", HOOK_PLATE_ID).data, text: "Sample hook line" }).filter(([k]) => !ROUTING_LEVERS.includes(k)),
    )
    expect(captionRoutesToRemotion(asInput(stripped))).toBe(false)
  })

  it("applying Body Captions or Clean Subtitles over Hook Plate leaves no plate lever", () => {
    const applied = (node: Readonly<Record<string, unknown>>, p: Readonly<Record<string, unknown>>) =>
      ({ ...node, ...Object.fromEntries(presetApplyClearKeys(p, "add-captions").map((k) => [k, undefined])), ...p }) as Record<string, unknown>
    const plate = preset("add-captions", HOOK_PLATE_ID).data
    const overBody = applied(plate, preset("add-captions", BODY_ID).data)
    expect(overBody.backgroundColor).toBeUndefined()
    expect(overBody.fontWeight).toBeUndefined()
    const overClean = applied(plate, preset("add-captions", "add-captions/clean-subtitles").data)
    for (const k of ["backgroundColor", "look", "positionY", "fontWeight", "maxWordsPerLine"]) expect(overClean[k], k).toBeUndefined()
  })
})
