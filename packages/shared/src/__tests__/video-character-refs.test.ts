import { describe, expect, it } from "vitest"
import {
  VIDEO_CHARACTER_REFS_WIRE_MAX,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  videoCharacterRefCap,
  videoCharacterRefUnits,
  videoCharacterRefProblem,
  videoCharacterVoiceCap,
  videoCharacterVoiceProblem,
  videoCharacterDistinctVoices,
  GEMINI_OMNI_VOICE_PRESETS,
  GEMINI_OMNI_VOICE_PRESET_IDS,
  VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX,
  VIDEO_CHARACTER_VOICE_EXAMPLE_MAX,
  type VideoCharacterReference,
} from "../index.js"

const portrait = (over: Partial<VideoCharacterReference> = {}): VideoCharacterReference => ({
  imageUrl: "https://cdn.example/p.png",
  description: "A woman with short silver hair",
  ...over,
})

describe("character reference capability (data-driven)", () => {
  it("both Gemini Omni SKUs declare a 3-character cap; nothing else does", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["gemini-omni-video"]?.characters).toBe(3)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["gemini-omni-flash"]?.characters).toBe(3)
    const others = Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)
      .filter(([id, l]) => !id.startsWith("gemini-omni") && (l?.characters ?? 0) > 0)
    expect(others).toEqual([])
  })

  it("the wire ceiling is the widest declared cap", () => {
    const widest = Math.max(...Object.values(VIDEO_REF_LIMITS_BY_PROVIDER).map((l) => l?.characters ?? 0))
    expect(VIDEO_CHARACTER_REFS_WIRE_MAX).toBe(widest)
  })

  it("videoCharacterRefCap reads the map; unknown / undefined provider = 0", () => {
    expect(videoCharacterRefCap("gemini-omni-video")).toBe(3)
    expect(videoCharacterRefCap("seedance-2")).toBe(0)
    expect(videoCharacterRefCap(undefined)).toBe(0)
  })
})

describe("videoCharacterRefUnits", () => {
  it("a portrait-only character is 1 unit, a portrait+body set is 2 (KIE: dual-image sets occupy two slots)", () => {
    expect(videoCharacterRefUnits([portrait()])).toBe(1)
    expect(videoCharacterRefUnits([portrait({ bodyImageUrl: "https://cdn.example/b.png" })])).toBe(2)
    expect(videoCharacterRefUnits([portrait(), portrait({ bodyImageUrl: "https://cdn.example/b.png" })])).toBe(3)
    expect(videoCharacterRefUnits(undefined)).toBe(0)
  })
})

describe("videoCharacterRefProblem", () => {
  const base = { provider: "gemini-omni-video", imageCount: 0, videoCount: 0, hasStartFrame: false }

  it("nothing supplied is never a problem, on any provider", () => {
    expect(videoCharacterRefProblem({ ...base, provider: "seedance-2", characterReferences: undefined })).toBeNull()
    expect(videoCharacterRefProblem({ ...base, provider: "seedance-2", characterReferences: [] })).toBeNull()
  })

  it("a supported provider with an in-budget request passes", () => {
    expect(videoCharacterRefProblem({ ...base, characterReferences: [portrait()] })).toBeNull()
    expect(videoCharacterRefProblem({ ...base, provider: "gemini-omni-flash", characterReferences: [portrait()] })).toBeNull()
  })

  it("an unsupported provider is rejected, naming the provider", () => {
    const p = videoCharacterRefProblem({ ...base, provider: "seedance-2", characterReferences: [portrait()] })
    expect(p?.code).toBe("character_references_unsupported")
    expect(p?.message).toContain("seedance-2")
  })

  it("more than the provider cap is rejected", () => {
    const p = videoCharacterRefProblem({ ...base, characterReferences: [portrait(), portrait(), portrait(), portrait()] })
    expect(p?.code).toBe("character_references_over_limit")
  })

  it("a start frame is rejected with an explanation (no silent drop)", () => {
    const p = videoCharacterRefProblem({ ...base, hasStartFrame: true, characterReferences: [portrait()] })
    expect(p?.code).toBe("character_references_with_start_frame")
    expect(p?.message.toLowerCase()).toContain("start frame")
    // It is OUR limit (the frame rides image_urls), never a claim about the upstream.
    expect(p?.message.toLowerCase()).not.toContain("mutually exclusive")
    expect(p?.message.toLowerCase()).not.toContain("provider treats")
  })

  it("an end frame is rejected too (Gemini has no end-frame input; never dropped silently)", () => {
    const p = videoCharacterRefProblem({ ...base, hasEndFrame: true, characterReferences: [portrait()] })
    expect(p?.code).toBe("character_references_with_end_frame")
    expect(p?.message).toContain("endFrameUrl")
  })

  it("an end frame without characters is none of this rule's business", () => {
    expect(videoCharacterRefProblem({ ...base, hasEndFrame: true, characterReferences: undefined })).toBeNull()
  })

  it("enforces images + 2×videos + character units ≤ 7", () => {
    // 3 characters (3) + 1 video (2) + 2 images = 7 → ok
    expect(videoCharacterRefProblem({
      ...base, imageCount: 2, videoCount: 1, characterReferences: [portrait(), portrait(), portrait()],
    })).toBeNull()
    // one more image → 8 → rejected
    const over = videoCharacterRefProblem({
      ...base, imageCount: 3, videoCount: 1, characterReferences: [portrait(), portrait(), portrait()],
    })
    expect(over?.code).toBe("character_references_quota")
    expect(over?.message).toContain("7")
  })

  it("a body image costs a second unit in the quota", () => {
    const withBody = portrait({ bodyImageUrl: "https://cdn.example/b.png" })
    // 2 body-sets (4) + 3 images = 7 → ok; + 1 more image = 8 → rejected
    expect(videoCharacterRefProblem({ ...base, imageCount: 3, characterReferences: [withBody, withBody] })).toBeNull()
    expect(videoCharacterRefProblem({ ...base, imageCount: 4, characterReferences: [withBody, withBody] })?.code)
      .toBe("character_references_quota")
  })
})

describe("Gemini Omni voice presets (data)", () => {
  it("lists the 30 documented preset ids, each with a gender and style label", () => {
    expect(GEMINI_OMNI_VOICE_PRESETS).toHaveLength(30)
    expect(GEMINI_OMNI_VOICE_PRESET_IDS).toHaveLength(30)
    expect(new Set(GEMINI_OMNI_VOICE_PRESET_IDS).size).toBe(30)
    expect(GEMINI_OMNI_VOICE_PRESET_IDS).toContain("achernar")
    expect(GEMINI_OMNI_VOICE_PRESET_IDS).toContain("zubenelgenubi")
    for (const v of GEMINI_OMNI_VOICE_PRESETS) {
      expect(["female", "male", "genderless"]).toContain(v.gender)
      expect(v.style.length).toBeGreaterThan(0)
      expect(v.pitch.length).toBeGreaterThan(0)
    }
    expect(GEMINI_OMNI_VOICE_PRESETS.find((v) => v.id === "achernar")).toMatchObject({ gender: "female", style: "soft", pitch: "high" })
    expect(GEMINI_OMNI_VOICE_PRESETS.find((v) => v.id === "pulcherrima")?.gender).toBe("genderless")
  })

  it("exposes the free-text limits the upstream documents", () => {
    expect(VIDEO_CHARACTER_VOICE_DESCRIPTION_MAX).toBe(2000)
    expect(VIDEO_CHARACTER_VOICE_EXAMPLE_MAX).toBe(120)
  })

  it("a model that declares voices also declares characters (voices ride the character create)", () => {
    for (const [id, l] of Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)) {
      if ((l?.voices ?? 0) > 0) expect(l?.characters ?? 0, `${id} declares voices but no characters`).toBeGreaterThan(0)
    }
  })

  it("the voice cap is data on the same map: Gemini Omni 3, others 0", () => {
    expect(videoCharacterVoiceCap("gemini-omni-video")).toBe(3)
    expect(videoCharacterVoiceCap("gemini-omni-flash")).toBe(3)
    expect(videoCharacterVoiceCap("seedance-2")).toBe(0)
    expect(videoCharacterVoiceCap(undefined)).toBe(0)
  })
})

describe("character voices", () => {
  const base = { provider: "gemini-omni-video", imageCount: 0, videoCount: 0, hasStartFrame: false }
  const voiced = (preset: string, over: Partial<NonNullable<VideoCharacterReference["voice"]>> = {}) =>
    portrait({ voice: { preset: preset as never, ...over } })

  it("counts distinct voice PERSONAS: (preset, description, exampleLine, name); the portrait does not matter", () => {
    expect(videoCharacterDistinctVoices([voiced("kore"), voiced("kore", { description: "warm" }), portrait()])).toBe(2)
    expect(videoCharacterDistinctVoices([voiced("kore"), { ...voiced("kore"), imageUrl: "https://cdn.example/other.png" }])).toBe(1)
    // The persona is created under the character's name, so a different name is a different persona.
    expect(videoCharacterDistinctVoices([voiced("kore"), { ...voiced("kore"), name: "Ann" }])).toBe(2)
    expect(videoCharacterDistinctVoices(undefined)).toBe(0)
  })

  it("a voiced character on a supporting provider passes", () => {
    expect(videoCharacterRefProblem({ ...base, characterReferences: [voiced("kore"), voiced("puck")] })).toBeNull()
  })

  it("an unsupported provider rejects a voice by name (never silently drops it)", () => {
    const p = videoCharacterVoiceProblem({ provider: "seedance-2", characterReferences: [voiced("kore")] })
    expect(p?.code).toBe("character_voice_unsupported")
    expect(p?.message).toContain("seedance-2")
  })

  it("more than the voice cap in DISTINCT voices has its own code", () => {
    const four = [voiced("kore"), voiced("puck"), voiced("leda"), voiced("orus")]
    const p = videoCharacterVoiceProblem({ provider: "gemini-omni-video", characterReferences: four })
    expect(p?.code).toBe("character_voices_over_limit")
    expect(p?.message).toContain("3")
    expect(p?.message).toContain("4")
  })

  it("exactly the cap passes; two characters sharing one voice count once", () => {
    expect(videoCharacterVoiceProblem({ provider: "gemini-omni-video", characterReferences: [voiced("kore"), voiced("puck"), voiced("leda")] })).toBeNull()
    expect(videoCharacterVoiceProblem({ provider: "gemini-omni-video", characterReferences: [voiced("kore"), voiced("kore")], cap: 1 })).toBeNull()
    expect(videoCharacterVoiceProblem({ provider: "gemini-omni-video", characterReferences: [voiced("kore"), { ...voiced("kore"), name: "Bo" }], cap: 1 })?.code).toBe("character_voices_over_limit")
    expect(videoCharacterVoiceProblem({ provider: "gemini-omni-video", characterReferences: [voiced("kore"), voiced("puck")], cap: 1 })?.code).toBe("character_voices_over_limit")
  })

  it("no voices is none of this rule's business", () => {
    expect(videoCharacterVoiceProblem({ provider: "seedance-2", characterReferences: [portrait()] })).toBeNull()
  })

  it("videoCharacterRefProblem runs the voice rule after the character rules", () => {
    expect(videoCharacterRefProblem({ ...base, provider: "seedance-2", characterReferences: [voiced("kore")] })?.code)
      .toBe("character_references_unsupported")
  })
})

describe("voice presets documentation", () => {
  it("the public node page lists every preset with its gender, style and pitch (the table cannot drift from the data)", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const here = dirname(fileURLToPath(import.meta.url))
    const doc = readFileSync(resolve(here, "../../../../docs/nodes/ai-video/generate-video.md"), "utf8")
    for (const v of GEMINI_OMNI_VOICE_PRESETS) {
      expect(doc, `${v.id} row`).toContain(`| \`${v.id}\` | ${v.gender} | ${v.style} | ${v.pitch} |`)
    }
  })
})
