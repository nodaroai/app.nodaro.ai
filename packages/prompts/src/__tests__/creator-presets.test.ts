// packages/prompts/src/__tests__/creator-presets.test.ts
import { describe, it, expect } from "vitest"
import { aspectRatioOptionsByKind, captionRoutesToRemotion, MODELS_WITH_REFERENCE_IMAGE_SUPPORT, normalizeNodeModelParams, presetApplyClearKeys, resolveNodeRefs, resolveNormalizedImageGen, type ConnectedReference, type SourceImageSize } from "@nodaro/shared"
import { getFactoryPresets, type FactoryPreset } from "../factory-presets.js"
import { assembleImageInput } from "../assemble-image-input.js"
import { computeNodePrompt } from "../resolve-prompt.js"
import { NEUTRAL_PERSON, REALISM_FINISH, REALISM_PASS_INSTRUCTION, REALISM_SKIN, realismEmptyHands, realismViewpoint } from "../realism-wording.js"

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

/** Every prompt-bearing field, joined — what the device and slot checks read. */
const allText = (d: Readonly<Record<string, unknown>>) =>
  ["promptPrefix", "prompt", "promptSuffix", "negativePrompt"].map((k) => d[k]).filter((v): v is string => typeof v === "string").join(" ")
const wiredRunPrompts = (d: Readonly<Record<string, unknown>>): Record<"legacy" | "hybrid" | "urlsOnly", string> => {
  const userPrompt = resolveNodeRefs(computeNodePrompt("generate-image", { ...d }, { refMap: new Map() }), new Map())
  const wired = Math.max(0, ...[...userPrompt.matchAll(/\{image:(\d+)[^{}]*\}/gi)].map((m) => Number(m[1])))
  const refs: ConnectedReference[] = Array.from({ length: wired }, (_, i) => ({
    id: `ref-${i + 1}`, defaultName: `Reference ${i + 1}`, source: "wired-image", url: `https://example.com/ref-${i + 1}.jpg`,
  }))
  const provider = d.provider as string
  return {
    legacy: assembleImageInput({ userPrompt, provider, referenceFormat: "legacy", connectedReferences: refs }).prompt,
    hybrid: assembleImageInput({ userPrompt, provider, referenceFormat: "hybrid", connectedReferences: refs }).prompt,
    urlsOnly: assembleImageInput({ userPrompt, provider, extraReferenceImageUrls: refs.map((r) => r.url) }).prompt,
  }
}
/** What the image route makes of a preset's levers with `refs` photos connected (and, when known, the size of the photo
 *  being transformed): the credit tier, the ratio it runs at and anything it had to change. */
const imageRouteRun = (node: string, d: Readonly<Record<string, unknown>>, refs: number, sourceImage?: SourceImageSize) =>
  resolveNormalizedImageGen({
    provider: d.provider as string, aspectRatio: d.aspectRatio, resolution: d.resolution, quality: d.quality, refCount: refs, sourceImage,
    // Generate Image moves a text-to-image model to its image-to-image sibling once a photo is connected; Modify Image already names that sibling.
    swapToI2i: node === "generate-image",
  })
/** The aspect ratio the workflow write step stores for one node of `type` carrying `d`. */
const storedAspectRatio = (type: string, d: Readonly<Record<string, unknown>>) =>
  normalizeNodeModelParams([{ id: "node", type, data: { ...d } }]).nodes[0]!.data.aspectRatio
/** A preset's data without the named wording fields — what is left is its levers. */
const leversOf = (d: Readonly<Record<string, unknown>>, ...wording: string[]) => Object.fromEntries(Object.entries(d).filter(([k]) => !wording.includes(k)))

const REALISM_IDS = [
  "unretouched-portrait", "phone-selfie", "candid-snapshot", "mirror-selfie",
  "creator-at-home", "video-call-frame", "macro-skin-study", "product-in-hand",
].map((s) => `generate-image/${s}`)
const REALISM_REFERENCE_IDS = ["generate-image/creator-at-home", "generate-image/product-in-hand"]
/** Each Realism preset's levers, and the credit tier the image route charges for them (its reference connected where it takes one). */
const REALISM_RUNS: Readonly<Record<string, readonly [levers: Readonly<Record<string, string>>, creditId: string]>> = {
  "generate-image/unretouched-portrait": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "3:4" }, "gpt-image-2:2K"],
  "generate-image/phone-selfie": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "3:4" }, "gpt-image-2:2K"],
  "generate-image/candid-snapshot": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "3:4" }, "gpt-image-2:2K"],
  "generate-image/mirror-selfie": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "9:16" }, "gpt-image-2:2K"],
  "generate-image/creator-at-home": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "9:16" }, "gpt-image-2-i2i:2K"],
  "generate-image/video-call-frame": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "16:9" }, "gpt-image-2:2K"],
  "generate-image/macro-skin-study": [{ provider: "seedream-5-pro", quality: "high", aspectRatio: "1:1" }, "seedream-5-pro:high"],
  "generate-image/product-in-hand": [{ provider: "gpt-image-2", resolution: "2K", aspectRatio: "3:4" }, "gpt-image-2-i2i:2K"],
}

describe("Wave 1 — Realism & Authentic", () => {
  const group = () => getFactoryPresets("generate-image").filter((p) => p.group === "Realism & Authentic")

  it("ships exactly these eight presets, in order, each on its model with that model's one lever, and no negativePrompt", () => {
    expect(group().map((p) => p.id)).toEqual(REALISM_IDS)
    expect(Object.keys(REALISM_RUNS)).toEqual(REALISM_IDS)
    for (const p of group()) {
      expect(leversOf(p.data, "prompt"), p.id).toEqual(REALISM_RUNS[p.id]![0])
      expect(p.data.negativePrompt, p.id).toBeUndefined()
    }
  })

  it("the image route runs each one on its levers unchanged, at its model's tier", () => {
    for (const id of REALISM_IDS) {
      const run = imageRouteRun("generate-image", preset("generate-image", id).data, REALISM_REFERENCE_IDS.includes(id) ? 1 : 0)
      expect(run.adjustments, id).toEqual([])
      expect(run.identifier, id).toBe(REALISM_RUNS[id]![1])
    }
  })

  it("composes the selected fragments", () => {
    const text = (slug: string) => preset("generate-image", `generate-image/${slug}`).data.prompt as string
    for (const slug of ["unretouched-portrait", "phone-selfie", "candid-snapshot", "mirror-selfie", "creator-at-home", "macro-skin-study"]) expect(text(slug), slug).toContain(REALISM_SKIN)
    for (const slug of ["unretouched-portrait", "phone-selfie", "candid-snapshot", "mirror-selfie", "creator-at-home", "video-call-frame", "product-in-hand"]) expect(text(slug), slug).toContain(REALISM_FINISH)
    expect(text("phone-selfie")).toContain(realismViewpoint(NEUTRAL_PERSON))
    expect(text("phone-selfie")).toContain(realismEmptyHands(NEUTRAL_PERSON))
  })

  it("names no device — the mirror self-portrait may say phone", () => {
    for (const id of REALISM_IDS) {
      const text = allText(preset("generate-image", id).data)
      // A mirror self-portrait shows the phone in hand.
      const scanned = id === "generate-image/mirror-selfie" ? text.replace(/\bphone\b/gi, "") : text
      expect(scanned, id).not.toMatch(DEVICE_WORDS)
    }
  })

  it("every subject slot has a default naming an adult; every setting slot has a default", () => {
    for (const id of REALISM_IDS) {
      const text = allText(preset("generate-image", id).data)
      for (const m of text.matchAll(/\{subject([^{}]*)\}/g)) {
        expect(m[1], `${id}: {subject} needs a default`).toMatch(/\|\|/)
        expect(m[1]!.split("||")[1], `${id}: the default names an adult`).toMatch(ADULT)
      }
      for (const m of text.matchAll(/\{setting([^{}]*)\}/g)) expect(m[1], `${id}: {setting} needs a default`).toMatch(/\|\|\s*\S/)
    }
  })

  it("labels every reference token, and reads whole when the references are wired", () => {
    const TOKEN = /\{(?:image|video|audio):\d+(:[^{}]*)?\}/gi
    const count = (s: string, part: string) => s.split(part).length - 1
    for (const id of REALISM_REFERENCE_IDS) expect(MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(preset("generate-image", id).data.provider as string), id).toBe(true)
    const withTokens: string[] = []
    for (const id of REALISM_IDS) {
      const d = preset("generate-image", id).data
      const text = allText(d)
      const labels: string[] = []
      for (const m of text.matchAll(TOKEN)) {
        expect(m[1], `${id}: ${m[0]} needs a label`).toBeTruthy()
        labels.push(m[1]!.slice(1))
      }
      if (labels.length > 0) withTokens.push(id)
      const bare = text.replace(TOKEN, "")
      for (const [path, out] of Object.entries(wiredRunPrompts(d))) {
        const legacyReferenceLine = path === "legacy" ? 1 : 0
        for (const label of new Set(labels)) {
          const tokens = labels.filter((l) => l === label).length
          expect(count(out, label), `${id} (${path}): ${label}`).toBeGreaterThanOrEqual(count(bare, label) + tokens + legacyReferenceLine)
        }
        expect(out, `${id} (${path})`).not.toMatch(/ {2}/)
        expect(out, `${id} (${path})`).not.toMatch(/[{}]/)
        expect(out, `${id} (${path})`).not.toMatch(/\bfrom\s+[.,;:!?]/)
      }
    }
    expect(withTokens).toEqual(REALISM_REFERENCE_IDS)
  })
})

describe("Wave 1 — Skin Detail Sheet", () => {
  it("is a Reference Sheet board on seedream-5-pro at high quality, carrying the never-merge clause in pre/post text and no negativePrompt", () => {
    const p = preset("generate-image", "generate-image/skin-detail-sheet")
    expect(p.group).toBe("Reference Sheet")
    expect(leversOf(p.data, "promptPrefix", "promptSuffix")).toEqual({ provider: "seedream-5-pro", quality: "high", aspectRatio: "3:2" })
    expect(MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(p.data.provider as string)).toBe(true)
    // The connected face photo moves the run to Seedream's image-to-image model, at the same tier.
    const run = imageRouteRun("generate-image", p.data, 1)
    expect(run.adjustments).toEqual([])
    expect(run.identifier).toBe("seedream-5-pro-i2i:high")
    expect(p.data.prompt).toBeUndefined()
    expect(p.data.promptPrefix as string).toContain("never merging or omitting a panel")
    expect(p.data.promptPrefix as string).toContain(REALISM_SKIN)
    expect(p.data.negativePrompt).toBeUndefined()
    expect(allText(p.data)).not.toMatch(DEVICE_WORDS)
    const ids = getFactoryPresets("generate-image").map((x) => x.id)
    expect(ids[ids.indexOf("generate-image/pet-board") + 1]).toBe("generate-image/skin-detail-sheet")
  })
})

describe("Wave 1 — Edits", () => {
  const SLUGS = ["add-skin-realism", "natural-photo-finish", "phone-camera-look", "undo-beauty-filter"]
  const FINISH = { provider: "nano-banana-2-1", aspectRatio: "auto", resolution: "2K" }
  const UNDO = { aspectRatio: "auto", quality: "high" }
  /** Each Edit's levers per node. Modify Image's provider list names Seedream's image-to-image id, not the text-to-image one. */
  const LEVERS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
    "generate-image": { "add-skin-realism": FINISH, "natural-photo-finish": FINISH, "phone-camera-look": FINISH, "undo-beauty-filter": { provider: "seedream-5-pro", ...UNDO } },
    "modify-image": { "add-skin-realism": FINISH, "natural-photo-finish": FINISH, "phone-camera-look": FINISH, "undo-beauty-filter": { provider: "seedream-5-pro-i2i", ...UNDO } },
  }

  it("ships the four Edits on both image nodes after the Doodle Overlay pair, each on its model and levers, as pre-text only", () => {
    for (const node of ["generate-image", "modify-image"]) {
      const ids = getFactoryPresets(node).map((x) => x.id)
      const i = ids.indexOf(`${node}/doodle-overlay-expressive`)
      expect(ids.slice(i + 1, i + 5)).toEqual(SLUGS.map((s) => `${node}/${s}`))
      for (const s of SLUGS) {
        const p = preset(node, `${node}/${s}`)
        expect(p.group).toBe("Edits")
        expect(typeof p.data.promptPrefix, p.id).toBe("string")
        expect(leversOf(p.data, "promptPrefix"), p.id).toEqual(LEVERS[node]![s])
        // Every Edit asks for "auto", to keep the photo's shape. Undo Beauty Filter's model lists no
        // native "auto"; how each node resolves it is pinned in the Undo Beauty Filter test below.
        expect(p.data.aspectRatio, p.id).toBe("auto")
        if (s !== "undo-beauty-filter") expect(aspectRatioOptionsByKind("image")[p.data.provider as string]?.map((o) => o.value), p.id).toContain("auto")
        expect((p.data.promptPrefix as string).length).toBeLessThanOrEqual(2000)
        expect(allText(p.data), p.id).not.toMatch(DEVICE_WORDS)
      }
    }
  })

  it("Undo Beauty Filter keeps the photo's shape on both nodes", () => {
    // The write step stores "auto" as written, and the run takes the model's listed ratio nearest the
    // connected photo's size, on Seedream 5 Pro's image-to-image model at high quality.
    const photos: ReadonlyArray<readonly [SourceImageSize, string]> = [[{ width: 1104, height: 1472 }, "3:4"], [{ width: 1600, height: 1000 }, "3:2"]]
    for (const node of ["generate-image", "modify-image"]) {
      const d = preset(node, `${node}/undo-beauty-filter`).data
      expect(storedAspectRatio(node, d), node).toBe("auto")
      for (const [photo, ratio] of photos) {
        const run = imageRouteRun(node, d, 1, photo)
        expect(run.aspectRatio, `${node} ${photo.width}x${photo.height}`).toBe(ratio)
        expect(run.modelId, node).toBe("seedream-5-pro-i2i")
        expect(run.identifier, node).toBe("seedream-5-pro-i2i:high")
      }
    }
  })

  it("Add Skin Realism is the realism instruction verbatim; the finish edits carry the finish sentence", () => {
    expect(preset("generate-image", "generate-image/add-skin-realism").data.promptPrefix).toBe(REALISM_PASS_INSTRUCTION)
    for (const s of ["natural-photo-finish", "phone-camera-look"])
      expect(preset("generate-image", `generate-image/${s}`).data.promptPrefix as string, s).toContain(REALISM_FINISH)
  })
})

describe("Wave 1 — Realism Audit", () => {
  it("is a structured Creative reading that answers ten yes/no questions and ends with a count", () => {
    const p = preset("image-to-text", "image-to-text/realism-audit")
    expect(p.group).toBe("Creative")
    expect(p.data.detailLevel).toBe("structured")
    const prompt = p.data.customPrompt as string
    expect(prompt).toContain("Tells found: N of 10")
    for (let n = 1; n <= 10; n++) expect(prompt).toContain(`${n}. `)
    expect(prompt.length).toBeLessThanOrEqual(2000)
  })
})
