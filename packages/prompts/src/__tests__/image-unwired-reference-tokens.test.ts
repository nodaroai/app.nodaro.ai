import { describe, it, expect } from "vitest"
import { readPromptAffixes, type ConnectedReference } from "@nodaro/shared"
import { buildImagePrompt, buildImagePromptSegments, type BuildImagePromptConfig } from "../prompt-builder.js"
import { assembleImageInput } from "../assemble-image-input.js"
import { resolveReferenceTokens } from "../video-reference-resolver.js"
import { applyPromptAffixes } from "../resolve-prompt.js"
import { GENERATE_IMAGE_PRESETS } from "../factory-presets/generate-image.js"

/**
 * An `{image:N}` token with no image at its position follows the VIDEO rule
 * (`resolveReferenceTokens`): a labelled token becomes its label, an unlabelled
 * one is dropped, and the horizontal gap it leaves is collapsed. Before this,
 * the image path shipped the raw token to the model — a preset written for a
 * wired photo (`Waist-up photo of {image:1:person}, …`) run without one sent
 * the literal `{image:1:person}`.
 *
 * A token that binds renders exactly as before (the wired golden pins that);
 * the tidy only runs when a token was actually dropped.
 */

const ZERO = { image: 0, video: 0, audio: 0 }
const PROVIDER = "nano-banana-pro"

const hat: ConnectedReference = { id: "up-hat", defaultName: "Hat", source: "wired-image", url: "https://r2/hat.png" }
const photo: ConnectedReference = { id: "up-photo", defaultName: "Photo", source: "wired-image", url: "https://r2/photo.png" }
const kira: ConnectedReference = {
  id: "char-kira",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2/kira.png",
  characterSlug: "kira",
  variantDisplayName: "canonical",
  characterCanonicalDescription: "auburn shoulder-length hair",
}

// The prompt shapes of the realism presets that ask for a wired photo (Creator
// at Home, Product in Hand, Skin Detail Sheet), as plain strings.
const CREATOR_AT_HOME =
  "Waist-up photo of {image:1:person}, an adult, standing at home in front of a plain wall, arms relaxed, empty hands."
const PRODUCT_IN_HAND =
  "An adult woman in her thirties holds {image:1:product} at chest height toward the viewer, label facing out, in a bright room at home."
const SKIN_DETAIL_SHEET =
  "Create a single skin detail reference sheet titled \"SKIN DETAIL SHEET\" from {image:1:person}, the single source of truth for identity, skin tone and features. Six panels: PANEL 01 — FULL FACE (front, eye level) · PANEL 02 — LEFT CHEEK & NOSE. In every panel: Skin shows its real structure. Plain neutral grey background, thin white panel labels in English."
// The Face Privacy presets on dev: an unlabelled `{image:1}`.
const FACE_PRIVACY = "remove persons faces from {image:1}, keep everything else the same"

const CREATOR_UNWIRED =
  "Waist-up photo of person, an adult, standing at home in front of a plain wall, arms relaxed, empty hands."

/** The three ways a prompt reaches `buildImagePrompt` with nothing wired. */
const UNWIRED_SHAPES: Record<string, (prompt: string) => BuildImagePromptConfig> = {
  "flat path": (prompt) => ({ prompt, provider: PROVIDER }),
  "connected refs, legacy": (prompt) => ({ prompt, provider: PROVIDER, connectedReferences: [] }),
  "connected refs, hybrid": (prompt) => ({ prompt, provider: PROVIDER, connectedReferences: [], referenceFormat: "hybrid" }),
}

describe("unwired {image:N} — parity with the video resolver", () => {
  // Prompts whose first letter is already upper-case, or that open on a
  // token, so the hybrid scene's line-initial capitalizer changes nothing and
  // the three image shapes and the video resolver must agree byte-for-byte.
  const PARITY_PROMPTS = [
    CREATOR_AT_HOME,
    PRODUCT_IN_HAND,
    SKIN_DETAIL_SHEET,
    "{image:1:person} with {image:2:face}",
    "Walk past {image:9} slowly, then {image:4:dog}  sits.",
  ]
  for (const [shapeName, shape] of Object.entries(UNWIRED_SHAPES)) {
    for (const prompt of PARITY_PROMPTS) {
      it(`${shapeName}: ${prompt.slice(0, 48)}…`, () => {
        const image = buildImagePrompt(shape(prompt)).prompt
        expect(image).toBe(resolveReferenceTokens(prompt, ZERO))
        expect(image).not.toMatch(/\{image:/i)
      })
    }
  }
})

describe("unwired {image:N} — flat path (references by URL only)", () => {
  const flat = (prompt: string, urls: string[] = [], extra: Partial<BuildImagePromptConfig> = {}) =>
    buildImagePrompt({ prompt, provider: PROVIDER, referenceImageUrls: urls, ...extra }).prompt

  it("a labelled token with nothing wired becomes its label", () => {
    expect(flat(CREATOR_AT_HOME)).toBe(CREATOR_UNWIRED)
  })

  it("an unlabelled token with nothing wired is dropped (punctuation is left as the video rule leaves it)", () => {
    expect(flat(FACE_PRIVACY)).toBe("remove persons faces from , keep everything else the same")
  })

  it("only the token past the last wired image drops; the wired one expands as before", () => {
    expect(flat("{image:1} and {image:3:dog} play", [hat.url!, photo.url!])).toBe("Image 1 and dog play")
  })

  it("{image:0} is never wired", () => {
    expect(flat("a {image:0:ghost} here", [hat.url!])).toBe("a ghost here")
  })

  it("collapses the gap a dropped token leaves, and trims", () => {
    expect(flat("walk past {image:9} slowly", [hat.url!])).toBe("walk past slowly")
    expect(flat("{image:2} a cat on a mat", [hat.url!])).toBe("a cat on a mat")
  })

  it("the collapse is horizontal only — the Avoid line keeps its own line", () => {
    expect(flat("a {image:2:dog}  runs", [hat.url!], { negativePrompt: "blurry" })).toBe("a dog runs\nAvoid: blurry")
  })

  it("nothing is tidied when every token binds", () => {
    expect(flat("a  cat {image:1}", [hat.url!])).toBe("a  cat Image 1")
  })

  it("the label is taken as written, whatever its characters", () => {
    expect(flat("a {image:1:man's jacket} on a hook")).toBe("a man's jacket on a hook")
    expect(flat("{IMAGE:1:Person} waves")).toBe("Person waves")
  })
})

describe("unwired {image:N} — connected references, legacy format", () => {
  it("the canvas shape with nothing wired (an empty reference list) drops to the label", () => {
    expect(buildImagePrompt({ prompt: CREATOR_AT_HOME, provider: PROVIDER, connectedReferences: [] }).prompt)
      .toBe(CREATOR_UNWIRED)
  })

  it("a wired token keeps its directive and expansion; the unwired one becomes its label", () => {
    const result = buildImagePrompt({
      prompt: "{image:1:hat} on {image:2:dog}",
      provider: PROVIDER,
      connectedReferences: [hat],
    })
    expect(result.prompt).toBe(
      "Use these references for the output image:\n- Image 1 (hat) — match exactly.\n\nCompose them naturally into a single image: Image 1 (hat) on dog",
    )
    expect(result.referenceImageUrls).toEqual([hat.url])
  })
})

describe("unwired {image:N} — connected references, hybrid format", () => {
  it("drops to the label with nothing wired (the label keeps its case, as on video)", () => {
    expect(buildImagePrompt({
      prompt: "{image:1:person} with {image:2:face}",
      provider: PROVIDER,
      connectedReferences: [],
      referenceFormat: "hybrid",
    }).prompt).toBe("person with face")
  })

  it("a wired token keeps its lettered phrase; the unwired one becomes its label and its seam collapses", () => {
    expect(buildImagePrompt({
      prompt: "a man wearing {image:1:hat} and {image:7:scarf}  in the park",
      provider: PROVIDER,
      connectedReferences: [hat],
      referenceFormat: "hybrid",
    }).prompt).toBe("A man wearing the hat from reference image A and scarf in the park")
  })

  it("an unlabelled Face Privacy token with nothing wired is dropped", () => {
    expect(buildImagePrompt({
      prompt: FACE_PRIVACY,
      provider: PROVIDER,
      connectedReferences: [],
      referenceFormat: "hybrid",
    }).prompt).toBe("Remove persons faces from , keep everything else the same")
  })
})

// `{image:N}` numbers the NON-character references: a wired Character is
// bound through its `@`-mention or its canonical directive, never through a
// positional token. So a token with only a Character wired has no image at its
// position and drops to its label, while the Character still attaches.
describe("unwired {image:N} — a wired Character is mention-only", () => {
  for (const referenceFormat of ["legacy", "hybrid"] as const) {
    it(`${referenceFormat}: Character unwired → the token drops to its label`, () => {
      expect(buildImagePrompt({
        prompt: CREATOR_AT_HOME,
        provider: PROVIDER,
        connectedReferences: [],
        referenceFormat,
      }).prompt).toBe(CREATOR_UNWIRED)
    })
  }

  it("legacy: Character wired → the token drops to its label, the canonical directive still attaches it", () => {
    const result = buildImagePrompt({ prompt: CREATOR_AT_HOME, provider: PROVIDER, connectedReferences: [kira] })
    expect(result.prompt.startsWith("Use these characters:\n- Image 1 (Kira) — auburn shoulder-length hair.")).toBe(true)
    expect(result.prompt.endsWith(`\n\n${CREATOR_UNWIRED}`)).toBe(true)
    expect(result.prompt).not.toContain("{image:")
    expect(result.referenceImageUrls).toEqual([kira.url])
  })

  it("hybrid: Character wired → the token drops to its label, the canonical phrase still attaches it", () => {
    const result = buildImagePrompt({
      prompt: CREATOR_AT_HOME,
      provider: PROVIDER,
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(result.prompt).toBe(`${CREATOR_UNWIRED}\nthe person from reference image A`)
    expect(result.referenceImageUrls).toEqual([kira.url])
  })

  it("legacy: Character + photo → {image:1} still binds the photo; {image:2} has no image and drops", () => {
    const result = buildImagePrompt({
      prompt: `${CREATOR_AT_HOME} {image:2:face}`,
      provider: PROVIDER,
      connectedReferences: [kira, photo],
    })
    expect(result.prompt.endsWith(
      "\n\nWaist-up photo of Image 2 (person), an adult, standing at home in front of a plain wall, arms relaxed, empty hands. face",
    )).toBe(true)
    expect(result.referenceImageUrls).toEqual([kira.url, photo.url])
  })

  it("hybrid: Character + photo → {image:1} still binds the photo; {image:2} has no image and drops", () => {
    expect(buildImagePrompt({
      prompt: `${CREATOR_AT_HOME} {image:2:face}`,
      provider: PROVIDER,
      connectedReferences: [kira, photo],
      referenceFormat: "hybrid",
    }).prompt).toBe(
      "Waist-up photo of the person from reference image B, an adult, standing at home in front of a plain wall, arms relaxed, empty hands. face\nthe person from reference image A",
    )
  })
})

describe("unwired {image:N} — the callers on top of the builder", () => {
  it("the segment decomposition still joins to the prompt", () => {
    const result = buildImagePromptSegments(
      { prompt: CREATOR_AT_HOME, provider: PROVIDER, connectedReferences: [] },
      [{ text: CREATOR_AT_HOME, origin: "user" }],
    )
    expect(result.prompt).toBe(CREATOR_UNWIRED)
    expect(result.segments.map((s) => s.text).join("")).toBe(result.prompt)
  })

  it("assembleImageInput applies it, and a prompt that was only an unwired bare token is empty", () => {
    expect(assembleImageInput({ userPrompt: CREATOR_AT_HOME, provider: PROVIDER, connectedReferences: [] }).prompt)
      .toBe(CREATOR_UNWIRED)
    expect(assembleImageInput({ userPrompt: "{image:1}", provider: PROVIDER, connectedReferences: [] }).prompt).toBe("")
    expect(() => assembleImageInput({
      userPrompt: "{image:1}",
      provider: PROVIDER,
      connectedReferences: [],
      throwOnEmpty: true,
    })).toThrow("No prompt")
  })
})

// The Face Privacy presets put their bare `{image:1}` in the PREFIX, so it
// reaches the builder through the affix path, not the typed prompt.
describe("unwired {image:N} — the Face Privacy presets' prefix", () => {
  const presets = GENERATE_IMAGE_PRESETS.filter((p) => p.group === "Face Privacy")
  const prefixed = (data: Readonly<Record<string, unknown>>): string =>
    applyPromptAffixes("", readPromptAffixes(data as Record<string, unknown>), new Map())

  it("prefix applied, then the builder: dropped with nothing wired, bound with the photo wired", () => {
    expect(presets.map((p) => p.id)).toEqual([
      "generate-image/faceless-3d-head",
      "generate-image/remove-faces",
      "generate-image/transparent-faces",
    ])
    for (const { data } of presets) {
      const prompt = prefixed(data)
      expect(prompt).toContain("{image:1}")
      const provider = data.provider as string
      const negativePrompt = data.negativePrompt as string
      const avoid = `\nAvoid: ${negativePrompt}`

      const unwired = buildImagePrompt({ prompt, provider, negativePrompt, connectedReferences: [] })
      expect(unwired.prompt).toBe(`${resolveReferenceTokens(prompt, ZERO)}${avoid}`)
      expect(unwired.referenceImageUrls).toBeUndefined()

      const wired = buildImagePrompt({ prompt, provider, negativePrompt, connectedReferences: [photo] })
      expect(wired.prompt).toBe(`${prompt.replace("{image:1}", "Image 1")}${avoid}`)
      expect(wired.referenceImageUrls).toEqual([photo.url])

      const wiredHybrid = buildImagePrompt({
        prompt, provider, negativePrompt, connectedReferences: [photo], referenceFormat: "hybrid",
      })
      expect(wiredHybrid.prompt).toContain("reference image A")
      expect(wiredHybrid.prompt).not.toMatch(/\{image:/i)
    }
  })
})
