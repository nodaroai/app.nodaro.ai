import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, getFactoryPresets, groupFactoryPresets } from "../factory-presets.js"
import { extractPresetData, PRESET_APPLY_CLEAR_KEYS } from "../node-preset-extract.js"
import { COMPOSER_PLAN_MAP, COMPOSER_PLAN_FIELDS } from "../model-constants.js"
import {
  IMAGE_GEN_PROVIDERS,
  MODIFY_IMAGE_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  MUSIC_PROVIDERS,
  SUNO_MODELS,
  TTS_PROVIDERS,
  TEXT_TO_AUDIO_PROVIDERS,
  STYLE_IDS,
  ALL_CAPTION_STYLES,
  COMBINE_TRANSITION_IDS,
  AUDIO_CROSSFADE_CURVE_IDS,
  aspectRatioOptionsByKind,
  durationsByMode,
  IMAGE_PROMPT_MAX,
  MODEL_CATALOG,
  NATIVE_NEGATIVE_VIDEO_PROVIDERS,
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

describe("Seedance Director factory presets", () => {
  const pack = getFactoryPresets("generate-video").filter(
    (p) => p.group === "Seedance Director",
  )

  it("ships at least 10 presets in the Seedance Director group", () => {
    expect(pack.length).toBeGreaterThanOrEqual(10)
  })

  it("every pack preset targets a Seedance 2 provider with valid catalog settings", () => {
    for (const p of pack) {
      const provider = p.data.provider as string
      expect(["seedance-2", "seedance-2-fast"]).toContain(provider)
      const entry = MODEL_CATALOG[provider]!
      expect(entry.durations).toContain(p.data.duration as number)
      expect(entry.aspectRatios).toContain(p.data.aspectRatio as string)
      expect(p.data.generateAudio).toBe(true)
    }
  })

  it("never sets negativePrompt (Seedance has no native negative param — constraints live in the prompt)", () => {
    for (const p of pack) expect(p.data.negativePrompt).toBeUndefined()
  })

  it("never uses timestamped shots (officially unstable) and always carries the constraint tail", () => {
    for (const p of pack) {
      const prompt = p.data.prompt as string
      expect(prompt).not.toMatch(/\(\s*\d+\s*[-–]\s*\d+\s*s\s*\)/i) // "(0-3s)" style
      expect(prompt.length).toBeLessThanOrEqual(2000)
      expect(prompt).toContain("subtitle-free")
    }
  })

  it("uses curly braces ONLY for {slot || default} placeholders (no {} dialogue — Nodaro variable syntax)", () => {
    for (const p of pack) {
      const stripped = (p.data.prompt as string).replace(/\{[^{}]*\|\|[^{}]*\}/g, "")
      expect(stripped).not.toContain("{")
      expect(stripped).not.toContain("}")
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

  it("respects prompt (IMAGE_PROMPT_MAX) and negativePrompt (5000) length caps", () => {
    for (const p of presets) {
      const prompt = (p.data.prompt as string | undefined) ?? ""
      const neg = (p.data.negativePrompt as string | undefined) ?? ""
      expect(prompt.length, `${p.id}: prompt exceeds cap`).toBeLessThanOrEqual(IMAGE_PROMPT_MAX)
      expect(neg.length, `${p.id}: negativePrompt exceeds 5000 chars`).toBeLessThanOrEqual(5000)
    }
  })

  it("includes the Reference Sheet group with Character + Location boards", () => {
    const char = presets.find((p) => p.id === "generate-image/character-board")
    const loc = presets.find((p) => p.id === "generate-image/location-board")
    expect(char?.group).toBe("Reference Sheet")
    expect(char?.data.provider).toBe("nano-banana-pro")
    expect(char?.data.resolution).toBe("2K")
    expect(loc?.group).toBe("Reference Sheet")
    expect(loc?.data.provider).toBe("nano-banana-pro")
    expect(loc?.data.resolution).toBe("2K")
  })

  it("includes the four new Reference Sheet boards", () => {
    for (const id of [
      "generate-image/product-board", "generate-image/outfit-board",
      "generate-image/scene-board", "generate-image/creature-board",
    ]) {
      const b = presets.find((p) => p.id === id)
      expect(b, `${id} missing`).toBeTruthy()
      expect(b!.group).toBe("Reference Sheet")
      expect(b!.data.provider).toBe("nano-banana-pro")
      expect(b!.data.resolution).toBe("2K")
      expect((b!.data.negativePrompt as string)?.length).toBeGreaterThan(0)
    }
  })

  it("includes the five audit-expansion Reference Sheet boards", () => {
    for (const id of [
      "generate-image/pose-board", "generate-image/vehicle-board",
      "generate-image/food-board", "generate-image/mascot-board",
      "generate-image/pet-board",
    ]) {
      const b = presets.find((p) => p.id === id)
      expect(b, `${id} missing`).toBeTruthy()
      expect(b!.group).toBe("Reference Sheet")
      expect(b!.data.provider).toBe("nano-banana-pro")
      expect(b!.data.resolution).toBe("2K")
      expect((b!.data.negativePrompt as string)?.length).toBeGreaterThan(0)
    }
  })

  it("every Reference Sheet board enforces the render-all-panel-headings clause", () => {
    // 2026-06-10 provider experiment: nano-banana-pro merged the DETAILS panel
    // heading into a neighbor on a board run. The in-prompt "never merging or
    // omitting a panel" clause is the fix — guard it so a rewrite can't drop it.
    const boards = presets.filter((p) => p.group === "Reference Sheet")
    expect(boards.length).toBeGreaterThanOrEqual(11)
    for (const b of boards) {
      expect(b.data.prompt as string, `${b.id}: missing the never-merge-panels clause`).toContain(
        "never merging or omitting a panel",
      )
    }
  })

  it("includes the Cast & Consistency grids on nano-banana-2", () => {
    // Grids are FED BACK as identity references — they ride nano-banana-2
    // (cheap, consistency-strong) at 4K so reused panel faces stay sharp.
    for (const id of ["generate-image/character-reference-grid", "generate-image/cast-mega-grid"]) {
      const g = presets.find((p) => p.id === id)
      expect(g, `${id} missing`).toBeTruthy()
      expect(g!.group).toBe("Cast & Consistency")
      expect(g!.data.provider).toBe("nano-banana-2")
      expect(g!.data.aspectRatio).toBe("3:4")
      expect(g!.data.resolution).toBe("4K")
    }
    const scene = presets.find((p) => p.id === "generate-image/cast-scene")
    expect(scene?.group).toBe("Cast & Consistency")
    expect(scene?.data.provider).toBe("nano-banana-2")
  })

  it("ships the Handmade & Stop-Motion family with the in-prompt NOT-digital-CG clause", () => {
    // The "NOT digital CG" clause is what holds the tactile handmade look —
    // a negativePrompt alone is not enough. Guard it so edits can't drop it.
    const handmade = presets.filter((p) => p.group === "Handmade & Stop-Motion")
    expect(handmade.length).toBeGreaterThanOrEqual(6)
    for (const p of handmade) {
      expect(p.data.prompt as string, `${p.id}: missing the NOT digital CG clause`).toContain("NOT digital CG")
    }
  })

  it("shares the Doodle Overlay edits with modify-image (same catalog, provider valid for both)", () => {
    for (const nodeType of ["generate-image", "modify-image"] as const) {
      for (const slug of ["doodle-overlay", "doodle-overlay-expressive"]) {
        const p = getFactoryPresets(nodeType).find((x) => x.id === `${nodeType}/${slug}`)
        expect(p, `${nodeType}/${slug} missing`).toBeTruthy()
        expect(p!.group).toBe("Edits")
        expect(p!.data.provider).toBe("nano-banana-pro")
      }
    }
  })

  it("every generate-image preset has a non-empty negativePrompt", () => {
    for (const p of presets) {
      const neg = (p.data.negativePrompt as string | undefined) ?? ""
      expect(neg.trim().length, `${p.id}: missing negativePrompt`).toBeGreaterThan(0)
    }
  })

  it("non-style-pinned generate-image prompts are substantive (no thin one-liners)", () => {
    for (const p of presets) {
      if (p.data.style !== undefined) continue // style field carries the look; short prompt is fine
      const prompt = (p.data.prompt as string | undefined) ?? ""
      expect(prompt.trim().length, `${p.id}: prompt too thin (${prompt.length} chars)`).toBeGreaterThanOrEqual(40)
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

  it("every generate-video preset has a non-empty negativePrompt, or in-prompt constraints when the provider has no native negative support", () => {
    for (const p of presets) {
      const neg = ((p.data.negativePrompt as string | undefined) ?? "").trim()
      if (neg.length > 0) continue
      // Providers without a native negative_prompt param (e.g. seedance-*) get
      // "Avoid: …" appended to the prompt by applyVideoNegativePrompt — the
      // official Seedance doctrine puts constraints in the prompt text instead.
      const provider = p.data.provider as string
      expect(
        NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(provider),
        `${p.id}: missing negativePrompt on a native-negative provider`,
      ).toBe(false)
      expect(
        (p.data.prompt as string) ?? "",
        `${p.id}: omits negativePrompt but carries no in-prompt constraint tail`,
      ).toContain("subtitle-free")
    }
  })

  it("non-style-pinned generate-video prompts are substantive", () => {
    for (const p of presets) {
      if (p.data.style !== undefined) continue
      const prompt = (p.data.prompt as string | undefined) ?? ""
      expect(prompt.trim().length, `${p.id}: prompt too thin (${prompt.length} chars)`).toBeGreaterThanOrEqual(40)
    }
  })

  it("includes the board-driven Scene Recipes on seedance-2", () => {
    // Step-2 companions to the generate-image boards/grids — seedance-2 is the
    // one provider with native audio + quoted-line lip-sync + up-to-9 refs.
    for (const id of [
      "generate-video/viral-meteor-scene",
      "generate-video/cartoon-short-opening",
      "generate-video/cartoon-short-chase",
      "generate-video/cartoon-short-resolution",
      "generate-video/two-character-dialogue",
      "generate-video/disaster-reveal",
      "generate-video/chase-scene",
    ]) {
      const p = presets.find((x) => x.id === id)
      expect(p, `${id} missing`).toBeTruthy()
      expect(p!.group).toBe("Scene Recipes")
      expect(p!.data.provider).toBe("seedance-2")
    }
  })

  it("cartoon Scene Recipes hold the look with an in-prompt NOT-photorealistic clause", () => {
    // Mirror of the image catalog's "NOT digital CG" guard — the clause in the
    // positive prompt is what locks cartoon rendering; negativePrompt alone drifts.
    for (const id of [
      "generate-video/cartoon-short-opening",
      "generate-video/cartoon-short-chase",
      "generate-video/cartoon-short-resolution",
    ]) {
      const p = presets.find((x) => x.id === id)
      expect(p?.data.prompt as string, `${id}: missing the NOT photorealistic clause`).toContain("NOT photorealistic")
    }
  })

  it("reveal-timing negatives survive on the surprise Scene Recipes", () => {
    // The source guide's load-bearing line — without it the event fires too early.
    const meteor = presets.find((x) => x.id === "generate-video/viral-meteor-scene")
    expect(meteor?.data.negativePrompt as string).toContain("noticing the meteor before impact")
    const reveal = presets.find((x) => x.id === "generate-video/disaster-reveal")
    expect(reveal?.data.negativePrompt as string).toContain("noticing the event before the shockwave")
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

describe("generate-script factory preset data validity", () => {
  const presets = getFactoryPresets("generate-script")

  it("keeps sceneCount in 1-20 and targetLength in 5-600", () => {
    for (const p of presets) {
      const sc = p.data.sceneCount as number | undefined
      if (sc !== undefined) {
        expect(sc, `${p.id}: sceneCount below 1`).toBeGreaterThanOrEqual(1)
        expect(sc, `${p.id}: sceneCount above 20`).toBeLessThanOrEqual(20)
      }
      const tl = p.data.targetLength as number | undefined
      if (tl !== undefined) {
        expect(tl, `${p.id}: targetLength below 5`).toBeGreaterThanOrEqual(5)
        expect(tl, `${p.id}: targetLength above 600`).toBeLessThanOrEqual(600)
      }
    }
  })

  it("uses a valid structure and a tone within 200 chars", () => {
    for (const p of presets) {
      if (p.data.structure !== undefined) {
        expect(["freeform", "8-step", "custom"], `${p.id}: bad structure`).toContain(p.data.structure as never)
      }
      expect(((p.data.tone as string) ?? "").length, `${p.id}: tone too long`).toBeLessThanOrEqual(200)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("image-to-text factory preset data validity", () => {
  const presets = getFactoryPresets("image-to-text")

  it("uses a valid detailLevel and customPrompt within 2000 chars", () => {
    for (const p of presets) {
      if (p.data.detailLevel !== undefined) {
        expect(["brief", "detailed", "structured"], `${p.id}: bad detailLevel`).toContain(p.data.detailLevel as never)
      }
      expect(((p.data.customPrompt as string) ?? "").length, `${p.id}: customPrompt too long`).toBeLessThanOrEqual(2000)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("voice-design factory preset data validity", () => {
  const presets = getFactoryPresets("voice-design")

  it("keeps voiceDescription within 1000 chars", () => {
    for (const p of presets) {
      const vd = (p.data.voiceDescription as string) ?? ""
      expect(vd.length, `${p.id}: voiceDescription too long`).toBeLessThanOrEqual(1000)
      expect(vd.length, `${p.id}: voiceDescription empty`).toBeGreaterThan(0)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("voice-changer factory preset data validity", () => {
  const presets = getFactoryPresets("voice-changer")

  it("keeps stability/similarityBoost/style within 0-1 and removeBackgroundNoise boolean", () => {
    for (const p of presets) {
      for (const k of ["stability", "similarityBoost", "style"] as const) {
        const v = p.data[k] as number | undefined
        if (v === undefined) continue
        expect(v, `${p.id}: ${k} out of 0-1`).toBeGreaterThanOrEqual(0)
        expect(v, `${p.id}: ${k} out of 0-1`).toBeLessThanOrEqual(1)
      }
      if (p.data.removeBackgroundNoise !== undefined) {
        expect(typeof p.data.removeBackgroundNoise, `${p.id}: removeBackgroundNoise must be boolean`).toBe("boolean")
      }
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("add-captions factory preset data validity", () => {
  const presets = getFactoryPresets("add-captions")

  it("uses a known caption style and position, fontSize within 12-200", () => {
    for (const p of presets) {
      if (p.data.style !== undefined) {
        expect(ALL_CAPTION_STYLES, `${p.id}: unknown style`).toContain(p.data.style as never)
      }
      if (p.data.position !== undefined) {
        expect(["bottom", "top", "center"], `${p.id}: bad position`).toContain(p.data.position as never)
      }
      const fs = p.data.fontSize as number | undefined
      if (fs !== undefined) {
        expect(fs, `${p.id}: fontSize ${fs} out of 12-200`).toBeGreaterThanOrEqual(12)
        expect(fs, `${p.id}: fontSize ${fs} out of 12-200`).toBeLessThanOrEqual(200)
      }
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("video-to-video factory preset data validity", () => {
  const presets = getFactoryPresets("video-to-video")

  it("uses a known video-to-video provider when set", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(VIDEO_TO_VIDEO_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("respects prompt (5000) and negativePrompt (500) caps", () => {
    for (const p of presets) {
      expect(((p.data.prompt as string) ?? "").length, `${p.id}: prompt > 5000`).toBeLessThanOrEqual(5000)
      expect(((p.data.negativePrompt as string) ?? "").length, `${p.id}: negativePrompt > 500`).toBeLessThanOrEqual(500)
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("combine-videos factory preset data validity", () => {
  const presets = getFactoryPresets("combine-videos")

  it("uses a known transition, audioMode, and audio crossfade curve when set", () => {
    for (const p of presets) {
      if (p.data.transition !== undefined) {
        expect(COMBINE_TRANSITION_IDS, `${p.id}: unknown transition`).toContain(p.data.transition as never)
      }
      if (p.data.audioCrossfadeCurve !== undefined) {
        expect(AUDIO_CROSSFADE_CURVE_IDS, `${p.id}: unknown audioCrossfadeCurve`).toContain(p.data.audioCrossfadeCurve as never)
      }
      if (p.data.audioMode !== undefined) {
        expect(["keep", "crossfade", "remove"], `${p.id}: bad audioMode`).toContain(p.data.audioMode as never)
      }
    }
  })

  it("keeps trim frames int 0-120 and transitionDuration 0-5", () => {
    for (const p of presets) {
      for (const k of ["trimStartFrames", "trimEndFrames"] as const) {
        const v = p.data[k] as number | undefined
        if (v === undefined) continue
        expect(Number.isInteger(v), `${p.id}: ${k} not int`).toBe(true)
        expect(v, `${p.id}: ${k} out of 0-120`).toBeGreaterThanOrEqual(0)
        expect(v, `${p.id}: ${k} out of 0-120`).toBeLessThanOrEqual(120)
      }
      const td = p.data.transitionDuration as number | undefined
      if (td !== undefined) {
        expect(td, `${p.id}: transitionDuration out of 0-5`).toBeGreaterThanOrEqual(0)
        expect(td, `${p.id}: transitionDuration out of 0-5`).toBeLessThanOrEqual(5)
      }
    }
  })

  it("groups every preset under a folder", () => {
    for (const p of presets) expect(p.group, `${p.id}: missing group`).toBeTruthy()
  })
})

describe("motion-graphics factory preset data validity", () => {
  const presets = getFactoryPresets("motion-graphics")
  // MotionGraphicsData.aspectRatio union (frontend/src/types/nodes.ts).
  const ASPECTS = ["16:9", "9:16", "1:1", "4:5"]
  // The 6 groups, in spec §4 table order — exact set + order is the catalog contract.
  const GROUP_ORDER = [
    "Titles & Text", "Intros & Logos", "Social & CTA", "UI & Icons", "FX Overlays", "Backgrounds",
  ]
  // The authoritative slot contract from the spec §4 table — preset id → required sids.
  const SLOT_CONTRACT: Record<string, string[]> = {
    "motion-graphics/lower-third": ["primaryColor", "nameText", "roleText"],
    "motion-graphics/title-card": ["primaryColor", "titleText", "subtitleText"],
    "motion-graphics/kinetic-typography": ["accentColor", "wordOne", "wordTwo", "wordThree"],
    "motion-graphics/quote-card": ["accentColor", "quoteText", "attributionText"],
    "motion-graphics/end-card-cta": ["primaryColor", "headlineText", "ctaText"],
    "motion-graphics/logo-sting": ["brandColor", "brandName"],
    "motion-graphics/channel-intro": ["primaryColor", "channelName", "taglineText"],
    "motion-graphics/countdown": ["ringColor", "numberColor"],
    "motion-graphics/subscribe-reminder": ["buttonColor", "buttonText"],
    "motion-graphics/like-follow-bug": ["accentColor", "handleText"],
    "motion-graphics/sale-badge": ["badgeColor", "saleText", "detailText"],
    "motion-graphics/story-highlight": ["primaryColor", "headlineText", "subText"],
    "motion-graphics/loader-spinner": ["dotColor", "trailColor"],
    "motion-graphics/success-check": ["strokeColor", "ringColor"],
    "motion-graphics/error-cross": ["strokeColor", "ringColor"],
    "motion-graphics/progress-bar": ["barColor", "trackColor", "labelText"],
    "motion-graphics/notification-pop": ["cardColor", "titleText", "bodyText"],
    "motion-graphics/confetti-burst": ["colorA", "colorB", "colorC", "colorD"],
    "motion-graphics/sparkle-shimmer": ["sparkleColor"],
    "motion-graphics/speed-lines": ["lineColor"],
    "motion-graphics/gradient-blob-loop": ["colorA", "colorB"],
    "motion-graphics/geometric-pattern-loop": ["shapeColor", "backdropColor"],
  }
  // Rows the spec §4 table marks "transparent" — must be the fully-transparent overlay bg.
  const TRANSPARENT_IDS = new Set([
    "motion-graphics/lower-third",
    "motion-graphics/subscribe-reminder",
    "motion-graphics/like-follow-bug",
    "motion-graphics/sale-badge",
    "motion-graphics/loader-spinner",
    "motion-graphics/success-check",
    "motion-graphics/error-cross",
    "motion-graphics/progress-bar",
    "motion-graphics/notification-pop",
    "motion-graphics/confetti-burst",
    "motion-graphics/sparkle-shimmer",
    "motion-graphics/speed-lines",
  ])

  it("ships exactly the 22 catalog presets named in the spec table", () => {
    expect(presets.length).toBe(22)
    expect(new Set(presets.map((p) => p.id))).toEqual(new Set(Object.keys(SLOT_CONTRACT)))
  })

  it("every preset targets the Lottie engine", () => {
    for (const p of presets) expect(p.data.engine, `${p.id}: not lottie`).toBe("lottie")
  })

  it("every preset has a non-empty description and group", () => {
    for (const p of presets) {
      expect((p.description ?? "").trim().length, `${p.id}: missing description`).toBeGreaterThan(0)
      expect((p.group ?? "").trim().length, `${p.id}: missing group`).toBeGreaterThan(0)
    }
  })

  it("uses exactly the six spec groups, in table order", () => {
    const seen: string[] = []
    for (const p of presets) if (p.group && !seen.includes(p.group)) seen.push(p.group)
    expect(seen).toEqual(GROUP_ORDER)
  })

  it("aspectRatio is in the MotionGraphicsData union", () => {
    for (const p of presets) {
      expect(ASPECTS, `${p.id}: bad aspectRatio "${String(p.data.aspectRatio)}"`).toContain(p.data.aspectRatio as never)
    }
  })

  it("durationSeconds is between 2 and 8", () => {
    for (const p of presets) {
      const d = p.data.durationSeconds as number
      expect(d, `${p.id}: duration ${d} below 2`).toBeGreaterThanOrEqual(2)
      expect(d, `${p.id}: duration ${d} above 8`).toBeLessThanOrEqual(8)
    }
  })

  it("backgroundColor parses as a hex color", () => {
    for (const p of presets) {
      const bg = p.data.backgroundColor as string
      expect(bg, `${p.id}: bg "${bg}" not hex`).toMatch(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
    }
  })

  it("never carries motionPlan (generated state is solved generically, not per-preset)", () => {
    for (const p of presets) {
      expect("motionPlan" in p.data, `${p.id}: must not carry motionPlan`).toBe(false)
    }
  })

  it("every motionPrompt is a rich art-direction brief (>200 chars) ending in an Expose slots sentence", () => {
    for (const p of presets) {
      const prompt = p.data.motionPrompt as string
      expect(prompt.length, `${p.id}: prompt too thin (${prompt.length} chars)`).toBeGreaterThan(200)
      expect(prompt, `${p.id}: missing "Expose slots:"`).toMatch(/Expose slots:/)
    }
  })

  it("each prompt literally names every slot from its spec-table contract (stable-contract guard)", () => {
    for (const p of presets) {
      const sids = SLOT_CONTRACT[p.id]
      expect(sids, `${p.id}: not in the slot-contract table`).toBeTruthy()
      const prompt = p.data.motionPrompt as string
      for (const sid of sids!) {
        expect(prompt, `${p.id}: prompt is missing sid "${sid}"`).toContain(sid)
      }
    }
  })

  it("transparent-overlay presets use #00000000 and state transparency in the prompt", () => {
    for (const p of presets) {
      if (!TRANSPARENT_IDS.has(p.id)) continue
      expect(p.data.backgroundColor, `${p.id}: overlay bg must be #00000000`).toBe("#00000000")
      expect(p.data.motionPrompt as string, `${p.id}: prompt must mention transparency`).toMatch(/[Tt]ransparent/)
    }
  })

  it("Backgrounds presets are opaque and declare a seamless loop", () => {
    for (const p of presets) {
      if (p.group !== "Backgrounds") continue
      expect(p.data.backgroundColor, `${p.id}: backdrop must be opaque`).not.toBe("#00000000")
      expect(p.data.motionPrompt as string, `${p.id}: must declare a seamless loop`).toMatch(/[Ss]eamless loop/)
    }
  })
})

describe("PRESET_APPLY_CLEAR_KEYS", () => {
  it("equals every COMPOSER_PLAN_MAP plan field plus lottieUrl (drift guard)", () => {
    // Deliberately re-derived from COMPOSER_PLAN_MAP (not COMPOSER_PLAN_FIELDS):
    // asserting against the same constant production reads would be tautological.
    const expected = [...new Set(Object.values(COMPOSER_PLAN_MAP).map((m) => m.planField)), "lottieUrl"]
    expect([...PRESET_APPLY_CLEAR_KEYS].sort()).toEqual([...expected].sort())
  })

  it("covers the motion-graphics plan field + lottieUrl explicitly", () => {
    expect(PRESET_APPLY_CLEAR_KEYS).toContain("motionPlan")
    expect(PRESET_APPLY_CLEAR_KEYS).toContain("lottieUrl")
  })
})

describe("presets don't bake config-field values (framing) into the prompt", () => {
  // The aspectRatio field is the single source of truth for framing. If a prompt also NAMES a
  // ratio, the model follows the prompt — so changing the aspect-ratio dropdown silently fails
  // (e.g. a prompt that says "3:4" ignores a switch to 16:9). No prompt may name an aspect ratio.
  const RATIO_TOKENS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "2.39:1", "2.35:1", "1.85:1"]
  const ratioRe = new RegExp(`(^|[^0-9.])(${RATIO_TOKENS.map((t) => t.replace(/\./g, "\\.")).join("|")})([^0-9]|$)`)

  it("no factory preset prompt names an aspect ratio", () => {
    const offenders: string[] = []
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        const prompt = (p.data as Record<string, unknown>).prompt
        if (typeof prompt !== "string") continue
        const m = prompt.match(ratioRe)
        if (m) offenders.push(`${p.id} → "${m[2]}"`)
      }
    }
    expect(
      offenders,
      `prompts must not name an aspect ratio (the aspectRatio field controls framing):\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

describe("factory-presets split integrity", () => {
  // The exact node-type keys, in the exact insertion order the single-file
  // catalog declared them. The split's index.ts must reproduce this order.
  const EXPECTED_KEYS = [
    "generate-image", "modify-image", "generate-video", "text-to-speech",
    "text-to-audio", "generate-music", "suno-generate", "llm-chat",
    "generate-script", "image-to-text", "voice-design", "video-to-video",
    "voice-changer", "add-captions", "combine-videos", "motion-graphics",
  ]

  it("exposes exactly the expected node-type keys in order", () => {
    expect(Object.keys(FACTORY_PRESETS)).toEqual(EXPECTED_KEYS)
  })

  it("every declared node type has at least one preset", () => {
    for (const k of EXPECTED_KEYS) {
      expect(getFactoryPresets(k).length, `${k} is empty`).toBeGreaterThan(0)
    }
  })
})
