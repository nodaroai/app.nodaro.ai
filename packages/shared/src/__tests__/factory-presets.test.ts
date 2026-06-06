import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, getFactoryPresets, groupFactoryPresets } from "../factory-presets.js"
import { extractPresetData } from "../node-preset-extract.js"
import {
  IMAGE_GEN_PROVIDERS,
  MODIFY_IMAGE_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  MUSIC_PROVIDERS,
  SUNO_MODELS,
  TTS_PROVIDERS,
  TEXT_TO_AUDIO_PROVIDERS,
  STYLE_IDS,
  aspectRatioOptionsByKind,
  durationsByMode,
} from "../index.js"

describe("FACTORY_PRESETS", () => {
  it("has presets for generate-image", () => {
    expect(getFactoryPresets("generate-image").length).toBeGreaterThan(0)
  })

  it("returns [] for an unknown node type", () => {
    expect(getFactoryPresets("does-not-exist")).toEqual([])
  })

  it("every factory preset has a stable unique id, name, and object data", () => {
    const ids = new Set<string>()
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        expect(p.id).toMatch(/.+\/.+/) // "<nodeType>/<slug>"
        expect(ids.has(p.id)).toBe(false)
        ids.add(p.id)
        expect(typeof p.name).toBe("string")
        expect(p.name.length).toBeGreaterThan(0)
        expect(typeof p.data).toBe("object")
      }
    }
  })

  it("factory preset data never contains excluded/runtime keys", () => {
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        // extract is a no-op iff data already excludes runtime/label/fieldMappings
        expect(extractPresetData(p.data)).toEqual(p.data)
      }
    }
  })

  it("generate-image factory presets use a known image provider", () => {
    for (const p of getFactoryPresets("generate-image")) {
      if (p.data.provider !== undefined) {
        expect(IMAGE_GEN_PROVIDERS).toContain(p.data.provider as never)
      }
    }
  })
})

describe("groupFactoryPresets", () => {
  it("returns a single null bucket when nothing is grouped", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", data: {} },
      { id: "a/2", name: "Two", data: {} },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.group).toBeNull()
    expect(out[0]!.presets.map((p) => p.id)).toEqual(["a/1", "a/2"])
  })

  it("buckets presets by group, preserving first-appearance order", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", group: "Folder A", data: {} },
      { id: "a/2", name: "Two", group: "Folder B", data: {} },
      { id: "a/3", name: "Three", group: "Folder A", data: {} },
    ])
    expect(out.map((g) => g.group)).toEqual(["Folder A", "Folder B"])
    expect(out[0]!.presets.map((p) => p.id)).toEqual(["a/1", "a/3"])
    expect(out[1]!.presets.map((p) => p.id)).toEqual(["a/2"])
  })

  it("keeps ungrouped presets in their own leading null bucket", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", data: {} },
      { id: "a/2", name: "Two", group: "Folder A", data: {} },
    ])
    expect(out.map((g) => g.group)).toEqual([null, "Folder A"])
  })

  it("defaults groupKind to folder and respects an explicit section", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", group: "F", data: {} },
      { id: "a/2", name: "Two", group: "S", groupKind: "section", data: {} },
    ])
    expect(out[0]!.groupKind).toBe("folder")
    expect(out[1]!.groupKind).toBe("section")
  })
})

describe("generate-image factory preset data validity", () => {
  const imageAR = aspectRatioOptionsByKind("image")
  // Mirrors the frontend's getAspectRatiosForModel fallback (model-options.ts).
  const DEFAULT_AR = ["1:1", "16:9", "9:16", "4:3"]
  const presets = getFactoryPresets("generate-image")

  it("pairs every aspectRatio with a provider that actually supports it", () => {
    for (const p of presets) {
      const provider = p.data.provider as string | undefined
      const ar = p.data.aspectRatio as string | undefined
      if (!provider || !ar || ar === "auto") continue
      const valid = imageAR[provider]?.map((o) => o.value) ?? DEFAULT_AR
      expect(
        valid,
        `${p.id}: aspectRatio "${ar}" is not supported by provider "${provider}" — valid: ${valid.join(", ")}`,
      ).toContain(ar)
    }
  })

  it("only references known style ids", () => {
    for (const p of presets) {
      const style = p.data.style as string | undefined
      if (style === undefined) continue
      expect(STYLE_IDS, `${p.id}: unknown style "${style}"`).toContain(style)
    }
  })

  it("respects prompt (2000) and negativePrompt (5000) length caps", () => {
    for (const p of presets) {
      const prompt = (p.data.prompt as string | undefined) ?? ""
      const neg = (p.data.negativePrompt as string | undefined) ?? ""
      expect(prompt.length, `${p.id}: prompt exceeds 2000 chars`).toBeLessThanOrEqual(2000)
      expect(neg.length, `${p.id}: negativePrompt exceeds 5000 chars`).toBeLessThanOrEqual(5000)
    }
  })

  it("groups every preset under a folder (no stray ungrouped presets)", () => {
    for (const p of presets) {
      expect(p.group, `${p.id}: missing group`).toBeTruthy()
    }
  })
})

describe("modify-image factory preset data validity", () => {
  const presets = getFactoryPresets("modify-image")

  it("uses a known modify-image provider", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(MODIFY_IMAGE_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("only references known style ids", () => {
    for (const p of presets) {
      const style = p.data.style as string | undefined
      if (style === undefined) continue
      expect(STYLE_IDS, `${p.id}: unknown style "${style}"`).toContain(style)
    }
  })

  it("respects the prompt 2000-char cap", () => {
    for (const p of presets) {
      const prompt = (p.data.prompt as string | undefined) ?? ""
      expect(prompt.length, `${p.id}: prompt exceeds 2000 chars`).toBeLessThanOrEqual(2000)
    }
  })
})

describe("generate-video factory preset data validity", () => {
  const presets = getFactoryPresets("generate-video")
  const vidAR = aspectRatioOptionsByKind("video")
  // Mirrors the frontend's getAspectRatiosForVideoModel fallback (model-options.ts).
  const VIDEO_AR_FALLBACK = ["16:9", "9:16", "1:1"]
  const validDurations = (provider: string) =>
    new Set<number>([
      ...(durationsByMode("t2v")[provider] ?? []),
      ...(durationsByMode("i2v")[provider] ?? []),
    ])

  it("uses a known video provider when set", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(VIDEO_GEN_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("pairs every aspectRatio with a provider that supports it", () => {
    for (const p of presets) {
      const provider = p.data.provider as string | undefined
      const ar = p.data.aspectRatio as string | undefined
      if (!provider || !ar) continue
      const valid = vidAR[provider]?.map((o) => o.value) ?? VIDEO_AR_FALLBACK
      expect(
        valid,
        `${p.id}: aspectRatio "${ar}" not supported by "${provider}" (valid: ${valid.join(", ")})`,
      ).toContain(ar)
    }
  })

  it("pairs every duration with a provider that supports it", () => {
    for (const p of presets) {
      const provider = p.data.provider as string | undefined
      const dur = p.data.duration as number | undefined
      if (!provider || dur === undefined) continue
      const valid = validDurations(provider)
      if (valid.size === 0) continue // provider derives duration from input — no lever
      expect(
        [...valid],
        `${p.id}: duration ${dur}s not supported by "${provider}" (valid: ${[...valid].join(", ")})`,
      ).toContain(dur)
    }
  })

  it("respects prompt/negativePrompt length caps (2500)", () => {
    for (const p of presets) {
      expect(((p.data.prompt as string) ?? "").length, `${p.id}: prompt too long`).toBeLessThanOrEqual(2500)
      expect(((p.data.negativePrompt as string) ?? "").length, `${p.id}: negativePrompt too long`).toBeLessThanOrEqual(2500)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("suno-generate factory preset data validity", () => {
  const presets = getFactoryPresets("suno-generate")

  it("uses a known Suno model when set", () => {
    for (const p of presets) {
      if (p.data.model === undefined) continue
      expect(SUNO_MODELS, `${p.id}: unknown model`).toContain(p.data.model as never)
    }
  })

  it("respects Suno field caps (style/negativeStyle 500, title 200, lyrics/prompt 3000)", () => {
    for (const p of presets) {
      expect(((p.data.style as string) ?? "").length, `${p.id}: style > 500`).toBeLessThanOrEqual(500)
      expect(((p.data.negativeStyle as string) ?? "").length, `${p.id}: negativeStyle > 500`).toBeLessThanOrEqual(500)
      expect(((p.data.title as string) ?? "").length, `${p.id}: title > 200`).toBeLessThanOrEqual(200)
      expect(((p.data.lyrics as string) ?? "").length, `${p.id}: lyrics > 3000`).toBeLessThanOrEqual(3000)
      expect(((p.data.prompt as string) ?? "").length, `${p.id}: prompt > 3000`).toBeLessThanOrEqual(3000)
    }
  })

  it("keeps weights within 0-1 and vocalGender valid", () => {
    for (const p of presets) {
      for (const k of ["styleWeight", "weirdnessConstraint", "audioWeight"] as const) {
        const v = p.data[k] as number | undefined
        if (v === undefined) continue
        expect(v, `${p.id}: ${k} out of 0-1`).toBeGreaterThanOrEqual(0)
        expect(v, `${p.id}: ${k} out of 0-1`).toBeLessThanOrEqual(1)
      }
      if (p.data.vocalGender !== undefined) {
        expect(["male", "female"], `${p.id}: bad vocalGender`).toContain(p.data.vocalGender as never)
      }
      if (p.data.instrumental !== undefined) {
        expect(typeof p.data.instrumental, `${p.id}: instrumental must be boolean`).toBe("boolean")
      }
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("generate-music factory preset data validity", () => {
  const presets = getFactoryPresets("generate-music")

  it("uses a known music provider when set", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(MUSIC_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("keeps duration within the route's 1-30s range", () => {
    for (const p of presets) {
      const dur = p.data.duration as number | undefined
      if (dur === undefined) continue
      expect(dur, `${p.id}: duration ${dur} below 1`).toBeGreaterThanOrEqual(1)
      expect(dur, `${p.id}: duration ${dur} above 30`).toBeLessThanOrEqual(30)
    }
  })

  it("uses a boolean instrumental flag when set", () => {
    for (const p of presets) {
      if (p.data.instrumental === undefined) continue
      expect(typeof p.data.instrumental, `${p.id}: instrumental must be boolean`).toBe("boolean")
    }
  })

  it("respects prompt (2000) and lyrics (2000) caps", () => {
    for (const p of presets) {
      expect(((p.data.prompt as string) ?? "").length, `${p.id}: prompt too long`).toBeLessThanOrEqual(2000)
      expect(((p.data.lyrics as string) ?? "").length, `${p.id}: lyrics too long`).toBeLessThanOrEqual(2000)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("text-to-speech factory preset data validity", () => {
  const presets = getFactoryPresets("text-to-speech")
  const unit = (k: string, v: unknown, id: string) => {
    if (v === undefined) return
    expect(v, `${id}: ${k} must be a number`).toBeTypeOf("number")
    expect(v as number, `${id}: ${k} out of 0-1`).toBeGreaterThanOrEqual(0)
    expect(v as number, `${id}: ${k} out of 0-1`).toBeLessThanOrEqual(1)
  }

  it("uses a known TTS provider when set", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(TTS_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("keeps stability / similarityBoost / style in 0-1 and speed in 0.7-1.2", () => {
    for (const p of presets) {
      unit("stability", p.data.stability, p.id)
      unit("similarityBoost", p.data.similarityBoost, p.id)
      unit("style", p.data.style, p.id)
      const speed = p.data.speed as number | undefined
      if (speed !== undefined) {
        expect(speed, `${p.id}: speed below 0.7`).toBeGreaterThanOrEqual(0.7)
        expect(speed, `${p.id}: speed above 1.2`).toBeLessThanOrEqual(1.2)
      }
    }
  })

  it("does not pin a user-specific voiceId", () => {
    for (const p of presets) {
      expect(p.data.voiceId, `${p.id}: presets must not hardcode a voiceId`).toBeUndefined()
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("text-to-audio factory preset data validity", () => {
  const presets = getFactoryPresets("text-to-audio")

  it("uses a known text-to-audio provider when set", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(TEXT_TO_AUDIO_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("keeps duration in 0.5-30 and promptInfluence in 0-1, loop boolean", () => {
    for (const p of presets) {
      const dur = p.data.duration as number | undefined
      if (dur !== undefined) {
        expect(dur, `${p.id}: duration below 0.5`).toBeGreaterThanOrEqual(0.5)
        expect(dur, `${p.id}: duration above 30`).toBeLessThanOrEqual(30)
      }
      const pi = p.data.promptInfluence as number | undefined
      if (pi !== undefined) {
        expect(pi, `${p.id}: promptInfluence out of 0-1`).toBeGreaterThanOrEqual(0)
        expect(pi, `${p.id}: promptInfluence out of 0-1`).toBeLessThanOrEqual(1)
      }
      if (p.data.loop !== undefined) {
        expect(typeof p.data.loop, `${p.id}: loop must be boolean`).toBe("boolean")
      }
    }
  })

  it("respects the prompt 2000-char cap", () => {
    for (const p of presets) {
      expect(((p.data.prompt as string) ?? "").length, `${p.id}: prompt too long`).toBeLessThanOrEqual(2000)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("llm-chat factory preset data validity", () => {
  const presets = getFactoryPresets("llm-chat")

  it("keeps temperature in 0-2 and maxTokens in 1-16384", () => {
    for (const p of presets) {
      const t = p.data.temperature as number | undefined
      if (t !== undefined) {
        expect(t, `${p.id}: temperature below 0`).toBeGreaterThanOrEqual(0)
        expect(t, `${p.id}: temperature above 2`).toBeLessThanOrEqual(2)
      }
      const mt = p.data.maxTokens as number | undefined
      if (mt !== undefined) {
        expect(mt, `${p.id}: maxTokens below 1`).toBeGreaterThanOrEqual(1)
        expect(mt, `${p.id}: maxTokens above 16384`).toBeLessThanOrEqual(16384)
      }
    }
  })

  it("respects the systemPrompt 10000-char cap", () => {
    for (const p of presets) {
      expect(((p.data.systemPrompt as string) ?? "").length, `${p.id}: systemPrompt too long`).toBeLessThanOrEqual(10000)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})
