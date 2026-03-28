import {
  resolveTemplate,
  applyTemplate,
  DEFAULT_TEMPLATES,
} from "../prompt-templates.js"
import {
  buildImagePrompt,
  expandImagePositionRefs,
  buildScenePrompt,
  buildEnrichedScenePrompt,
  SCENE_PROMPT_MAX_LENGTH,
} from "../prompt-builder.js"
import type { CharacterDef, SceneData } from "../types.js"
import type { BuildImagePromptConfig, EnrichableScene } from "../prompt-builder.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SceneData with required fields, overridable via partial. */
function makeScene(overrides: Partial<SceneData> = {}): SceneData {
  return {
    shotType: "medium",
    cameraAngle: "eye-level",
    aspectRatio: "16:9",
    characters: [],
    objects: [],
    mood: [],
    visualStyle: "",
    depthOfField: "medium",
    lensType: "normal",
    cameraMovement: "static",
    colorPalette: [],
    summary: "",
    timeOfDay: "noon",
    weather: "clear",
    lighting: "natural",
    ...overrides,
  }
}

function makeCharDef(overrides: Partial<CharacterDef> = {}): CharacterDef {
  return {
    id: "c1",
    name: "Alice",
    type: "description",
    description: "a brave warrior",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------
describe("resolveTemplate", () => {
  it("returns default template for a known key", () => {
    expect(resolveTemplate("character-description")).toBe(
      DEFAULT_TEMPLATES["character-description"],
    )
  })

  it("returns empty string for an unknown key", () => {
    expect(resolveTemplate("nonexistent-key")).toBe("")
  })

  it("returns empty string for unknown key with empty overrides", () => {
    expect(resolveTemplate("nonexistent-key", {}, {})).toBe("")
  })

  it("user override takes precedence over default", () => {
    const userTemplates = { "character-description": "Custom: {name}" }
    expect(resolveTemplate("character-description", userTemplates)).toBe("Custom: {name}")
  })

  it("flow override takes precedence over user override", () => {
    const userTemplates = { "character-description": "User: {name}" }
    const flowTemplates = { "character-description": "Flow: {name}" }
    expect(resolveTemplate("character-description", userTemplates, flowTemplates)).toBe(
      "Flow: {name}",
    )
  })

  it("flow override takes precedence over default when no user override", () => {
    const flowTemplates = { "character-description": "Flow: {name}" }
    expect(resolveTemplate("character-description", undefined, flowTemplates)).toBe(
      "Flow: {name}",
    )
  })

  it("falls through to default when flow and user do not have the key", () => {
    const userTemplates = { "other-key": "irrelevant" }
    const flowTemplates = { "another-key": "irrelevant" }
    expect(resolveTemplate("character-description", userTemplates, flowTemplates)).toBe(
      DEFAULT_TEMPLATES["character-description"],
    )
  })
})

// ---------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------
describe("applyTemplate", () => {
  it("replaces named placeholders with values", () => {
    expect(applyTemplate("{name} is {description}", { name: "Foo", description: "bar" })).toBe(
      "Foo is bar",
    )
  })

  it("replaces missing vars with empty string", () => {
    expect(applyTemplate("{name} is {description}", { name: "Foo" })).toBe("Foo is {description}")
    // Note: only keys present in vars are replaced. Missing keys stay as-is in template.
    // But if a key IS present with empty value, it is replaced with "".
  })

  it("replaces vars that have empty string value with empty string", () => {
    expect(applyTemplate("{name} is {description}", { name: "", description: "bar" })).toBe(
      " is bar",
    )
  })

  it("replaces multiple occurrences of the same placeholder", () => {
    expect(applyTemplate("{x} and {x}", { x: "hello" })).toBe("hello and hello")
  })

  it("handles template with no placeholders", () => {
    expect(applyTemplate("no placeholders here", { name: "Foo" })).toBe("no placeholders here")
  })

  it("handles empty template", () => {
    expect(applyTemplate("", { name: "Foo" })).toBe("")
  })

  it("handles empty vars", () => {
    expect(applyTemplate("{name}", {})).toBe("{name}")
  })
})

// ---------------------------------------------------------------------------
// buildImagePrompt
// ---------------------------------------------------------------------------
describe("buildImagePrompt", () => {
  describe("basic prompt passthrough", () => {
    it("returns prompt unchanged when no extras are provided", () => {
      const result = buildImagePrompt({ prompt: "A sunset", provider: "nano-banana" })
      expect(result.prompt).toBe("A sunset")
      expect(result.nativeNegativePrompt).toBeUndefined()
      expect(result.referenceImageUrls).toBeUndefined()
    })

    it("trims nothing for short prompts", () => {
      const result = buildImagePrompt({ prompt: "short", provider: "flux" })
      expect(result.prompt).toBe("short")
    })
  })

  describe("style appending", () => {
    it("appends style on a new line", () => {
      const result = buildImagePrompt({
        prompt: "A sunset over mountains",
        provider: "flux",
        style: "cinematic",
      })
      expect(result.prompt).toBe("A sunset over mountains\nStyle: cinematic")
    })

    it("ignores whitespace-only style", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "flux",
        style: "   ",
      })
      expect(result.prompt).toBe("A sunset")
    })

    it("ignores undefined style", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "flux",
        style: undefined,
      })
      expect(result.prompt).toBe("A sunset")
    })
  })

  describe("negative prompt routing", () => {
    it("sets nativeNegativePrompt for imagen4 (native model)", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "imagen4",
        negativePrompt: "blurry",
      })
      expect(result.nativeNegativePrompt).toBe("blurry")
      expect(result.prompt).not.toContain("Avoid:")
    })

    it("sets nativeNegativePrompt for imagen4-fast", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "imagen4-fast",
        negativePrompt: "blurry, dark",
      })
      expect(result.nativeNegativePrompt).toBe("blurry, dark")
    })

    it("sets nativeNegativePrompt for ideogram-v3", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "ideogram-v3",
        negativePrompt: "ugly",
      })
      expect(result.nativeNegativePrompt).toBe("ugly")
    })

    it("sets nativeNegativePrompt for qwen", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "qwen",
        negativePrompt: "text",
      })
      expect(result.nativeNegativePrompt).toBe("text")
    })

    it("appends negative prompt as 'Avoid:' for non-native models", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "flux",
        negativePrompt: "blurry",
      })
      expect(result.nativeNegativePrompt).toBeUndefined()
      expect(result.prompt).toBe("A sunset\nAvoid: blurry")
    })

    it("appends negative prompt as 'Avoid:' for gpt-image", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "gpt-image",
        negativePrompt: "watermark",
      })
      expect(result.nativeNegativePrompt).toBeUndefined()
      expect(result.prompt).toContain("Avoid: watermark")
    })

    it("ignores whitespace-only negative prompt", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "flux",
        negativePrompt: "   ",
      })
      expect(result.nativeNegativePrompt).toBeUndefined()
      expect(result.prompt).not.toContain("Avoid:")
    })

    it("combines style and negative prompt correctly", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "flux",
        style: "cinematic",
        negativePrompt: "blurry",
      })
      expect(result.prompt).toBe("A sunset\nStyle: cinematic\nAvoid: blurry")
    })

    it("combines style with native negative prompt", () => {
      const result = buildImagePrompt({
        prompt: "A sunset",
        provider: "imagen4",
        style: "cinematic",
        negativePrompt: "blurry",
      })
      expect(result.prompt).toBe("A sunset\nStyle: cinematic")
      expect(result.nativeNegativePrompt).toBe("blurry")
    })
  })

  describe("character description expansion", () => {
    it("expands character descriptions using default templates", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ name: "Alice", description: "a brave warrior" }),
        ],
      })
      expect(result.prompt).toContain("A scene")
      expect(result.prompt).toContain("Include character 'Alice': a brave warrior.")
    })

    it("expands face category using face template", () => {
      const result = buildImagePrompt({
        prompt: "Portrait",
        provider: "flux",
        characterDefs: [
          makeCharDef({ name: "Bob", category: "face", description: "strong jawline" }),
        ],
      })
      expect(result.prompt).toContain("Include the exact face and facial features of 'Bob'")
    })

    it("expands location category using location template", () => {
      const result = buildImagePrompt({
        prompt: "Scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ name: "Castle", category: "location", description: "a medieval castle" }),
        ],
      })
      expect(result.prompt).toContain("Include location 'Castle': a medieval castle.")
    })

    it("expands object category using object template", () => {
      const result = buildImagePrompt({
        prompt: "Scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ name: "Sword", category: "object", description: "a glowing sword" }),
        ],
      })
      expect(result.prompt).toContain("Include object 'Sword': a glowing sword.")
    })

    it("skips reference-type characters (no description expansion)", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ type: "reference", description: undefined }),
        ],
      })
      // No character descriptions appended
      expect(result.prompt).toBe("A scene")
    })

    it("skips description-type characters with no description", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ description: undefined }),
        ],
      })
      expect(result.prompt).toBe("A scene")
    })

    it("joins multiple character descriptions with spaces", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        characterDefs: [
          makeCharDef({ id: "c1", name: "Alice", description: "warrior" }),
          makeCharDef({ id: "c2", name: "Bob", description: "wizard" }),
        ],
      })
      expect(result.prompt).toContain("Include character 'Alice': warrior.")
      expect(result.prompt).toContain("Include character 'Bob': wizard.")
    })

    it("uses flow template overrides for character expansion", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        characterDefs: [makeCharDef({ name: "Alice", description: "warrior" })],
        flowTemplates: { "character-description": "Show {name} who is {description}!" },
      })
      expect(result.prompt).toContain("Show Alice who is warrior!")
    })

    it("uses wrapper template to combine user prompt and descriptions", () => {
      const result = buildImagePrompt({
        prompt: "A battle",
        provider: "flux",
        characterDefs: [makeCharDef({ name: "Alice", description: "warrior" })],
        flowTemplates: {
          "generate-image-wrapper": "Prompt: {userPrompt} | Characters: {assetDescriptions}",
        },
      })
      expect(result.prompt).toContain("Prompt: A battle | Characters:")
    })
  })

  describe("truncation", () => {
    it("truncates prompt exceeding 2000 chars to 1997 + '...'", () => {
      const longPrompt = "x".repeat(2500)
      const result = buildImagePrompt({ prompt: longPrompt, provider: "flux" })
      expect(result.prompt.length).toBe(2000)
      expect(result.prompt.endsWith("...")).toBe(true)
      expect(result.prompt.slice(0, 1997)).toBe("x".repeat(1997))
    })

    it("does not truncate prompt at exactly 2000 chars", () => {
      const exactPrompt = "y".repeat(2000)
      const result = buildImagePrompt({ prompt: exactPrompt, provider: "flux" })
      expect(result.prompt.length).toBe(2000)
      expect(result.prompt).toBe(exactPrompt)
    })

    it("does not truncate prompt under 2000 chars", () => {
      const shortPrompt = "z".repeat(1999)
      const result = buildImagePrompt({ prompt: shortPrompt, provider: "flux" })
      expect(result.prompt).toBe(shortPrompt)
    })

    it("truncates after style and negative prompt are appended", () => {
      // Build a prompt that is under 2000 but goes over with style + avoid
      const basePrompt = "a".repeat(1980)
      const result = buildImagePrompt({
        prompt: basePrompt,
        provider: "flux",
        style: "cinematic",
        negativePrompt: "blurry",
      })
      expect(result.prompt.length).toBe(2000)
      expect(result.prompt.endsWith("...")).toBe(true)
    })
  })

  describe("reference image filtering", () => {
    it("passes refs through for nano-banana (supported model)", () => {
      const refs = ["https://img.example.com/1.png", "https://img.example.com/2.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toEqual(refs)
    })

    it("passes refs through for nano-banana-pro (supported model)", () => {
      const refs = ["https://img.example.com/1.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana-pro",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toEqual(refs)
    })

    it("passes refs through for nano-banana-2 (supported model)", () => {
      const refs = ["https://img.example.com/1.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana-2",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toEqual(refs)
    })

    it("returns undefined refs for gpt-image (unsupported model)", () => {
      const refs = ["https://img.example.com/1.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "gpt-image",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toBeUndefined()
    })

    it("returns undefined refs for flux (unsupported model)", () => {
      const refs = ["https://img.example.com/1.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "flux",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toBeUndefined()
    })

    it("returns undefined refs for imagen4 (unsupported model)", () => {
      const refs = ["https://img.example.com/1.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "imagen4",
        referenceImageUrls: refs,
      })
      expect(result.referenceImageUrls).toBeUndefined()
    })

    it("returns undefined refs when supported model has empty refs array", () => {
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana",
        referenceImageUrls: [],
      })
      expect(result.referenceImageUrls).toBeUndefined()
    })
  })

  describe("ancestor ref fallback", () => {
    it("uses ancestor refs when no direct refs are provided", () => {
      const ancestors = ["https://img.example.com/ancestor.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana",
        referenceImageUrls: [],
        ancestorRefs: ancestors,
      })
      expect(result.referenceImageUrls).toEqual(ancestors)
    })

    it("prefers direct refs over ancestor refs", () => {
      const directRefs = ["https://img.example.com/direct.png"]
      const ancestorRefs = ["https://img.example.com/ancestor.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "nano-banana",
        referenceImageUrls: directRefs,
        ancestorRefs: ancestorRefs,
      })
      expect(result.referenceImageUrls).toEqual(directRefs)
    })

    it("ancestor refs are also filtered by model support", () => {
      const ancestors = ["https://img.example.com/ancestor.png"]
      const result = buildImagePrompt({
        prompt: "A scene",
        provider: "gpt-image",
        referenceImageUrls: [],
        ancestorRefs: ancestors,
      })
      expect(result.referenceImageUrls).toBeUndefined()
    })
  })

  describe("{image:N} expansion in prompt", () => {
    it("expands {image:1} when refs are available", () => {
      const result = buildImagePrompt({
        prompt: "{image:1} shows a cat",
        provider: "nano-banana",
        referenceImageUrls: ["https://img.example.com/1.png", "https://img.example.com/2.png"],
      })
      expect(result.prompt).toContain("[reference image 1] shows a cat")
    })

    it("expands multiple image references", () => {
      const result = buildImagePrompt({
        prompt: "{image:1} and {image:2}",
        provider: "nano-banana",
        referenceImageUrls: ["https://a.png", "https://b.png"],
      })
      expect(result.prompt).toContain("[reference image 1] and [reference image 2]")
    })

    it("does not expand {image:N} for out-of-range index", () => {
      const result = buildImagePrompt({
        prompt: "{image:3} is missing",
        provider: "nano-banana",
        referenceImageUrls: ["https://a.png", "https://b.png"],
      })
      expect(result.prompt).toContain("{image:3} is missing")
    })

    it("uses ancestor ref count for image expansion when no direct refs", () => {
      const result = buildImagePrompt({
        prompt: "{image:1} from ancestor",
        provider: "nano-banana",
        referenceImageUrls: [],
        ancestorRefs: ["https://ancestor.png"],
      })
      expect(result.prompt).toContain("[reference image 1] from ancestor")
    })
  })
})

// ---------------------------------------------------------------------------
// expandImagePositionRefs
// ---------------------------------------------------------------------------
describe("expandImagePositionRefs", () => {
  it("replaces {image:1} with [reference image 1]", () => {
    expect(expandImagePositionRefs("{image:1} shows", 2)).toBe("[reference image 1] shows")
  })

  it("replaces multiple valid tokens", () => {
    expect(expandImagePositionRefs("{image:1} and {image:2}", 2)).toBe(
      "[reference image 1] and [reference image 2]",
    )
  })

  it("leaves {image:3} unchanged when count is 2", () => {
    expect(expandImagePositionRefs("{image:3}", 2)).toBe("{image:3}")
  })

  it("leaves {image:0} unchanged (1-indexed)", () => {
    expect(expandImagePositionRefs("{image:0}", 3)).toBe("{image:0}")
  })

  it("returns unchanged prompt with no tokens", () => {
    expect(expandImagePositionRefs("no tokens here", 5)).toBe("no tokens here")
  })

  it("returns unchanged prompt when count is 0", () => {
    expect(expandImagePositionRefs("{image:1}", 0)).toBe("{image:1}")
  })

  it("is case-insensitive", () => {
    expect(expandImagePositionRefs("{IMAGE:1}", 1)).toBe("[reference image 1]")
    expect(expandImagePositionRefs("{Image:2}", 3)).toBe("[reference image 2]")
  })

  it("handles adjacent tokens", () => {
    expect(expandImagePositionRefs("{image:1}{image:2}", 2)).toBe(
      "[reference image 1][reference image 2]",
    )
  })
})

// ---------------------------------------------------------------------------
// buildScenePrompt
// ---------------------------------------------------------------------------
describe("buildScenePrompt", () => {
  describe("minimal scene", () => {
    it("produces shot + angle for minimal input", () => {
      const scene = makeScene()
      const result = buildScenePrompt(scene, [])
      expect(result).toBe("MEDIUM SHOT, eye level")
    })

    it("uses fallback for unknown shot type", () => {
      const scene = makeScene({ shotType: "unknown-shot" })
      const result = buildScenePrompt(scene, [])
      // Falls back to "MEDIUM SHOT" since unknown key is not in SHOT_LABELS
      expect(result).toBe("MEDIUM SHOT, eye level")
    })

    it("uses fallback for unknown camera angle", () => {
      const scene = makeScene({ cameraAngle: "unknown-angle" })
      const result = buildScenePrompt(scene, [])
      expect(result).toBe("MEDIUM SHOT, eye level")
    })
  })

  describe("shot types and angles", () => {
    it("renders close-up + low angle", () => {
      const scene = makeScene({ shotType: "close-up", cameraAngle: "low-angle" })
      const result = buildScenePrompt(scene, [])
      expect(result).toBe("CLOSE-UP, low angle")
    })

    it("renders extreme wide + birds eye", () => {
      const scene = makeScene({ shotType: "extreme-wide", cameraAngle: "birds-eye" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("EXTREME WIDE SHOT")
      expect(result).toContain("bird's eye view")
    })
  })

  describe("aspect ratio", () => {
    it("omits default aspect ratio (16:9)", () => {
      const scene = makeScene({ aspectRatio: "16:9" })
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("composition")
    })

    it("includes non-default aspect ratio", () => {
      const scene = makeScene({ aspectRatio: "9:16" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("vertical portrait composition")
    })

    it("includes 1:1 aspect ratio", () => {
      const scene = makeScene({ aspectRatio: "1:1" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("square composition")
    })
  })

  describe("characters", () => {
    it("includes character name and description from assets", () => {
      const scene = makeScene({
        characters: [{ assetId: "c1", mood: "", action: "" }],
      })
      const assets: CharacterDef[] = [
        makeCharDef({ id: "c1", name: "Alice", description: "brave warrior" }),
      ]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("of Alice, brave warrior")
    })

    it("includes character mood when present", () => {
      const scene = makeScene({
        characters: [{ assetId: "c1", mood: "angry", action: "" }],
      })
      const assets = [makeCharDef({ id: "c1", name: "Alice" })]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("angry")
    })

    it("includes character action when present", () => {
      const scene = makeScene({
        characters: [{ assetId: "c1", mood: "", action: "running" }],
      })
      const assets = [makeCharDef({ id: "c1", name: "Alice" })]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("running")
    })

    it("includes character position in frame", () => {
      const scene = makeScene({
        characters: [{ assetId: "c1", mood: "", action: "", positionInFrame: "left" }],
      })
      const assets = [makeCharDef({ id: "c1", name: "Alice" })]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("(left)")
    })

    it("joins multiple characters with 'and'", () => {
      const scene = makeScene({
        characters: [
          { assetId: "c1", mood: "", action: "" },
          { assetId: "c2", mood: "", action: "" },
        ],
      })
      const assets = [
        makeCharDef({ id: "c1", name: "Alice" }),
        makeCharDef({ id: "c2", name: "Bob" }),
      ]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("Alice")
      expect(result).toContain("and")
      expect(result).toContain("Bob")
    })

    it("falls back to 'a figure' when asset is not found", () => {
      const scene = makeScene({
        characters: [{ assetId: "missing", mood: "", action: "" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("a figure")
    })
  })

  describe("locations", () => {
    it("includes location name", () => {
      const scene = makeScene({
        locations: [{ assetId: "loc1", name: "Dark Forest" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("in Dark Forest")
    })

    it("falls back to asset description for location name", () => {
      const scene = makeScene({
        locations: [{ assetId: "loc1" }],
      })
      const assets = [
        makeCharDef({ id: "loc1", name: "Forest", description: "a dark enchanted forest" }),
      ]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("in a dark enchanted forest")
    })

    it("falls back to asset name when no description", () => {
      const scene = makeScene({
        locations: [{ assetId: "loc1" }],
      })
      const assets = [makeCharDef({ id: "loc1", name: "Forest", description: undefined })]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("in Forest")
    })

    it("falls back to 'location' when nothing is available", () => {
      const scene = makeScene({
        locations: [{ assetId: "missing" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("in location")
    })

    it("includes non-default env conditions in location parenthetical", () => {
      const scene = makeScene({
        locations: [{ assetId: "loc1", name: "Beach", timeOfDay: "sunset", weather: "foggy", lighting: "dramatic" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("Beach (sunset light, foggy, dramatic lighting)")
    })

    it("omits default env values (noon, clear, natural) from location", () => {
      const scene = makeScene({
        locations: [{ assetId: "loc1", name: "Beach", timeOfDay: "noon", weather: "clear", lighting: "natural" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("in Beach")
      expect(result).not.toContain("noon")
      expect(result).not.toContain("clear")
      expect(result).not.toContain("natural")
    })

    it("inherits scene-level env values when location-level are absent", () => {
      const scene = makeScene({
        timeOfDay: "dusk",
        weather: "rainy",
        lighting: "natural",
        locations: [{ assetId: "loc1", name: "Park" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("Park (dusk light, rainy)")
      expect(result).not.toContain("natural")
    })

    it("joins multiple locations with 'and'", () => {
      const scene = makeScene({
        locations: [
          { assetId: "l1", name: "Forest" },
          { assetId: "l2", name: "River" },
        ],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("Forest")
      expect(result).toContain("and")
      expect(result).toContain("River")
    })
  })

  describe("environment without locations", () => {
    it("omits default env values (noon, clear, natural)", () => {
      const scene = makeScene()
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("noon")
      expect(result).not.toContain("clear")
      expect(result).not.toContain("natural")
    })

    it("includes non-default timeOfDay", () => {
      const scene = makeScene({ timeOfDay: "dawn" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("dawn light")
    })

    it("includes non-default weather", () => {
      const scene = makeScene({ weather: "stormy" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("stormy")
    })

    it("includes non-default lighting", () => {
      const scene = makeScene({ lighting: "dramatic" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("dramatic lighting")
    })

    it("includes multiple non-default env values", () => {
      const scene = makeScene({ timeOfDay: "dusk", weather: "snowy", lighting: "neon" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("dusk light")
      expect(result).toContain("snowy")
      expect(result).toContain("neon lighting")
    })
  })

  describe("objects", () => {
    it("includes object description", () => {
      const scene = makeScene({
        objects: [{ assetId: "o1", description: "a glowing sword" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("with a glowing sword")
    })

    it("falls back to asset name when no object description", () => {
      const scene = makeScene({
        objects: [{ assetId: "o1" }],
      })
      const assets = [makeCharDef({ id: "o1", name: "Sword" })]
      const result = buildScenePrompt(scene, assets)
      expect(result).toContain("with Sword")
    })

    it("falls back to 'object' when nothing is available", () => {
      const scene = makeScene({
        objects: [{ assetId: "missing" }],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("with object")
    })

    it("joins multiple objects with commas", () => {
      const scene = makeScene({
        objects: [
          { assetId: "o1", description: "sword" },
          { assetId: "o2", description: "shield" },
        ],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("with sword, shield")
    })
  })

  describe("mood, visual style, camera movement", () => {
    it("includes mood as atmosphere", () => {
      const scene = makeScene({ mood: ["tense", "dark"] })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("tense, dark atmosphere")
    })

    it("includes visual style", () => {
      const scene = makeScene({ visualStyle: "noir" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("noir style")
    })

    it("includes non-static camera movement", () => {
      const scene = makeScene({ cameraMovement: "dolly" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("dolly shot")
    })

    it("omits static camera movement", () => {
      const scene = makeScene({ cameraMovement: "static" })
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("static camera")
    })
  })

  describe("low-priority parts", () => {
    it("includes non-default depth of field", () => {
      const scene = makeScene({ depthOfField: "shallow" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("shallow depth of field")
    })

    it("omits default (medium) depth of field", () => {
      const scene = makeScene({ depthOfField: "medium" })
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("depth of field")
    })

    it("includes non-default lens type", () => {
      const scene = makeScene({ lensType: "wide-angle" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("wide-angle lens")
    })

    it("omits default (normal) lens type", () => {
      const scene = makeScene({ lensType: "normal" })
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("lens")
    })

    it("includes color palette", () => {
      const scene = makeScene({ colorPalette: ["red", "gold"] })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("red, gold color palette")
    })

    it("includes summary", () => {
      const scene = makeScene({ summary: "An epic battle unfolds" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("An epic battle unfolds")
    })

    it("includes dialogue", () => {
      const scene = makeScene({
        dialogue: [
          { characterName: "Alice", text: "I will fight!", emotion: "determined" },
        ],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain('dialogue:')
      expect(result).toContain('Alice (determined): "I will fight!"')
    })

    it("skips dialogue entries with empty text", () => {
      const scene = makeScene({
        dialogue: [
          { characterName: "Alice", text: "   " },
          { characterName: "Bob", text: "Hello" },
        ],
      })
      const result = buildScenePrompt(scene, [])
      expect(result).not.toContain("Alice")
      expect(result).toContain("Bob")
    })

    it("includes director notes", () => {
      const scene = makeScene({ directorNotes: "Focus on tension" })
      const result = buildScenePrompt(scene, [])
      expect(result).toContain("Focus on tension")
    })
  })

  describe("progressive truncation", () => {
    it("drops low-priority parts first when exceeding safe length", () => {
      // Create a scene with low-priority parts that push over SCENE_PROMPT_SAFE_LENGTH (1800)
      const longNotes = "N".repeat(800)
      const longDialogue = "D".repeat(800)
      const scene = makeScene({
        summary: "S".repeat(400),
        directorNotes: longNotes,
        dialogue: [{ characterName: "A", text: longDialogue }],
        colorPalette: ["red", "blue"],
        depthOfField: "shallow",
      })
      const result = buildScenePrompt(scene, [])
      // The result should be within bounds
      expect(result.length).toBeLessThanOrEqual(SCENE_PROMPT_MAX_LENGTH)
    })

    it("drops medium-priority parts after all low are dropped", () => {
      // Stuff high+medium so that even without low, it still exceeds safe length
      const longSummary = "S".repeat(1000)
      const scene = makeScene({
        summary: longSummary,
        mood: ["tense"],
        visualStyle: "highly detailed cinematic ultra-realistic",
      })
      const result = buildScenePrompt(scene, [])
      expect(result.length).toBeLessThanOrEqual(SCENE_PROMPT_MAX_LENGTH)
    })

    it("hard-truncates if high parts alone exceed max length", () => {
      // Characters with very long descriptions can push high parts over the limit
      const longCharDescs = Array.from({ length: 20 }, (_, i) => ({
        assetId: `c${i}`,
        mood: "intense",
        action: "running quickly through the dense mysterious fog",
        positionInFrame: "center" as const,
      }))
      const assets = longCharDescs.map((_, i) =>
        makeCharDef({ id: `c${i}`, name: `Character${i}`, description: "X".repeat(100) }),
      )
      const scene = makeScene({ characters: longCharDescs })
      const result = buildScenePrompt(scene, assets)
      expect(result.length).toBeLessThanOrEqual(SCENE_PROMPT_MAX_LENGTH)
      expect(result.endsWith("...")).toBe(true)
    })
  })

  describe("forDisplay option", () => {
    it("disables truncation when forDisplay is true", () => {
      const longNotes = "N".repeat(2000)
      const scene = makeScene({
        directorNotes: longNotes,
        summary: "S".repeat(500),
        depthOfField: "shallow",
        lensType: "telephoto",
        colorPalette: ["red", "blue", "green"],
      })
      const result = buildScenePrompt(scene, [], { forDisplay: true })
      // Should contain the full director notes without truncation
      expect(result).toContain(longNotes)
      // Can exceed the max length
      expect(result.length).toBeGreaterThan(SCENE_PROMPT_MAX_LENGTH)
    })

    it("does not truncate character descriptions when forDisplay is true", () => {
      const longDesc = "D".repeat(300)
      const scene = makeScene({
        characters: [{ assetId: "c1", mood: "", action: "" }],
      })
      const assets = [makeCharDef({ id: "c1", name: "Hero", description: longDesc })]
      const result = buildScenePrompt(scene, assets, { forDisplay: true })
      expect(result).toContain(longDesc)
    })
  })

  describe("comprehensive scene", () => {
    it("produces a well-formed prompt with all parts populated", () => {
      const scene = makeScene({
        shotType: "close-up",
        cameraAngle: "low-angle",
        aspectRatio: "9:16",
        characters: [
          { assetId: "c1", mood: "determined", action: "swinging a sword", positionInFrame: "center" },
        ],
        locations: [{ assetId: "l1", name: "Castle Courtyard", timeOfDay: "dusk", weather: "foggy", lighting: "torchlight" }],
        objects: [{ assetId: "o1", description: "ancient shield" }],
        mood: ["epic", "intense"],
        visualStyle: "fantasy oil painting",
        depthOfField: "shallow",
        lensType: "telephoto",
        cameraMovement: "tracking",
        colorPalette: ["gold", "crimson"],
        summary: "A warrior stands her ground",
        dialogue: [{ characterName: "Alice", text: "Stand back!", emotion: "fierce" }],
        directorNotes: "Emphasize the scale of the castle",
      })
      const assets = [
        makeCharDef({ id: "c1", name: "Alice", description: "a fierce warrior in golden armor" }),
      ]
      const result = buildScenePrompt(scene, assets)

      expect(result).toContain("CLOSE-UP")
      expect(result).toContain("low angle")
      expect(result).toContain("vertical portrait composition")
      expect(result).toContain("Alice")
      expect(result).toContain("Castle Courtyard")
      expect(result).toContain("ancient shield")
      expect(result).toContain("epic, intense atmosphere")
      expect(result).toContain("fantasy oil painting style")
      expect(result.length).toBeLessThanOrEqual(SCENE_PROMPT_MAX_LENGTH)
    })
  })
})

// ---------------------------------------------------------------------------
// buildEnrichedScenePrompt
// ---------------------------------------------------------------------------
describe("buildEnrichedScenePrompt", () => {
  it("returns just visualDescription when no extras", () => {
    const scene: EnrichableScene = { visualDescription: "A beautiful sunset" }
    expect(buildEnrichedScenePrompt(scene)).toBe("A beautiful sunset")
  })

  it("appends cinematography with shotType and cameraAngle", () => {
    const scene: EnrichableScene = {
      visualDescription: "A warrior stands",
      cinematography: { shotType: "close-up", cameraAngle: "low angle" },
    }
    const result = buildEnrichedScenePrompt(scene)
    expect(result).toBe("A warrior stands. Camera: close-up low angle")
  })

  it("appends cinematography with only shotType", () => {
    const scene: EnrichableScene = {
      visualDescription: "Scene",
      cinematography: { shotType: "wide shot" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("Scene. Camera: wide shot")
  })

  it("appends cinematography with only cameraAngle", () => {
    const scene: EnrichableScene = {
      visualDescription: "Scene",
      cinematography: { cameraAngle: "eye level" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("Scene. Camera: eye level")
  })

  it("appends camera movement when present", () => {
    const scene: EnrichableScene = {
      visualDescription: "Scene",
      cinematography: { shotType: "wide", cameraMovement: "dolly zoom" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("Scene. Camera: wide with dolly zoom")
  })

  it("does not append Camera when cinematography has no shotType or cameraAngle", () => {
    const scene: EnrichableScene = {
      visualDescription: "Scene",
      cinematography: { cameraMovement: "dolly" },
    }
    // No shotType or cameraAngle, so the if condition fails
    expect(buildEnrichedScenePrompt(scene)).toBe("Scene")
  })

  it("appends location name", () => {
    const scene: EnrichableScene = {
      visualDescription: "A battle",
      location: { name: "Ancient Forest" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A battle. Setting: Ancient Forest")
  })

  it("appends location name with timeOfDay", () => {
    const scene: EnrichableScene = {
      visualDescription: "A battle",
      location: { name: "Ancient Forest", timeOfDay: "dusk" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A battle. Setting: Ancient Forest, dusk")
  })

  it("does not append Setting when location has no name", () => {
    const scene: EnrichableScene = {
      visualDescription: "A battle",
      location: { timeOfDay: "dusk" },
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A battle")
  })

  it("appends mood from array", () => {
    const scene: EnrichableScene = {
      visualDescription: "A scene",
      mood: ["tense", "dark"],
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A scene. Mood: tense, dark")
  })

  it("appends mood from string", () => {
    const scene: EnrichableScene = {
      visualDescription: "A scene",
      mood: "mysterious",
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A scene. Mood: mysterious")
  })

  it("does not append Mood for empty array", () => {
    const scene: EnrichableScene = {
      visualDescription: "A scene",
      mood: [],
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A scene")
  })

  it("does not append Mood for empty string", () => {
    const scene: EnrichableScene = {
      visualDescription: "A scene",
      mood: "",
    }
    expect(buildEnrichedScenePrompt(scene)).toBe("A scene")
  })

  it("combines all enrichments", () => {
    const scene: EnrichableScene = {
      visualDescription: "A warrior",
      cinematography: { shotType: "close-up", cameraAngle: "low", cameraMovement: "tracking" },
      location: { name: "Castle", timeOfDay: "dawn" },
      mood: ["epic", "tense"],
    }
    const result = buildEnrichedScenePrompt(scene)
    expect(result).toBe(
      "A warrior. Camera: close-up low with tracking. Setting: Castle, dawn. Mood: epic, tense",
    )
  })
})
