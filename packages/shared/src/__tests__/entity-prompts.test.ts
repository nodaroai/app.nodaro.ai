import { describe, it, expect } from "vitest"
import {
  buildCharacterPrompt,
  buildObjectPrompt,
  buildLocationPrompt,
  buildFaceTemplateInputs,
  buildMotionPrompt,
  PLACEHOLDER_CHARACTER_NAME,
  LOCATION_REFERENCE_PHOTO_KINDS,
  LOCATION_REFERENCE_PHOTO_KIND_LABELS,
  locationReferencePhotoKindLabel,
} from "../entity-prompts.js"

describe("buildCharacterPrompt", () => {
  it("combines name, gender, description with outfit and style", () => {
    const prompt = buildCharacterPrompt({
      name: "Aria",
      gender: "female",
      description: "silver hair",
      baseOutfit: "leather armour",
      style: "anime",
    })
    expect(prompt).toContain("Aria, female, silver hair")
    expect(prompt).toContain("wearing leather armour")
    expect(prompt).toContain("anime style")
    expect(prompt).toContain("front view, looking at camera")
    expect(prompt).toContain("full body portrait")
  })

  it("defaults style to realistic when unset", () => {
    const prompt = buildCharacterPrompt({ name: "Bob" })
    expect(prompt).toContain("realistic style")
  })

  it("omits outfit clause when baseOutfit is empty", () => {
    const prompt = buildCharacterPrompt({ name: "Bob" })
    expect(prompt).not.toContain("wearing")
  })

  it("skips missing gender/description fields in description block", () => {
    const prompt = buildCharacterPrompt({ name: "Solo" })
    // Should just have "Solo," — no extra commas for missing fields
    expect(prompt).toMatch(/^Solo,/)
  })

  it("drops the auto-assigned placeholder name from the prompt", () => {
    // Character Studio auto-assigns PLACEHOLDER_CHARACTER_NAME when the user
    // clicks Generate before naming. The string must not reach the model.
    const prompt = buildCharacterPrompt({
      name: PLACEHOLDER_CHARACTER_NAME,
      gender: "female",
      description: "red hair",
    })
    expect(prompt).not.toContain(PLACEHOLDER_CHARACTER_NAME)
    expect(prompt).toMatch(/^female, red hair,/)
  })
})

describe("buildObjectPrompt", () => {
  it("uses category and product-photography suffix", () => {
    const prompt = buildObjectPrompt({
      name: "pistol",
      category: "weapon",
      description: "brass fittings",
      style: "realistic",
    })
    expect(prompt).toContain("Single weapon pistol")
    expect(prompt).toContain("brass fittings")
    expect(prompt).toContain("realistic art style")
    expect(prompt).toContain("product photography style")
  })

  it("defaults category to 'object' when unset", () => {
    const prompt = buildObjectPrompt({ name: "widget" })
    expect(prompt).toContain("Single object widget")
  })
})

describe("buildLocationPrompt", () => {
  it("uses scene framing with establishing-shot suffix", () => {
    const prompt = buildLocationPrompt({
      name: "Neo Tokyo",
      category: "urban",
      description: "rain-slick streets",
      style: "3d-pixar",
    })
    expect(prompt).toContain("urban scene")
    expect(prompt).toContain("Neo Tokyo")
    expect(prompt).toContain("rain-slick streets")
    expect(prompt).toContain("3d-pixar art style")
    expect(prompt).toContain("wide establishing shot")
    expect(prompt).toContain("no people")
  })

  it("defaults category to 'location' when unset", () => {
    const prompt = buildLocationPrompt({ name: "The Grove" })
    expect(prompt).toContain("location scene")
  })
})

describe("buildFaceTemplateInputs", () => {
  it("combines name and description into one description string", () => {
    const inputs = buildFaceTemplateInputs({
      name: "Elena",
      description: "high cheekbones",
      style: "realistic",
    })
    expect(inputs.description).toBe("Elena, high cheekbones")
    expect(inputs.style).toBe("realistic")
  })

  it("omits missing description fields", () => {
    const inputs = buildFaceTemplateInputs({ name: "Solo" })
    expect(inputs.description).toBe("Solo")
    expect(inputs.style).toBe("realistic")
  })
})

describe("buildMotionPrompt", () => {
  it("composes character base + motion + style", () => {
    const out = buildMotionPrompt({
      name: "Alex",
      gender: "male",
      description: "tall, dark hair",
      style: "realistic",
      baseOutfit: "leather jacket",
      motionPrompt: "walking confidently",
    })
    expect(out).toBe("Alex, male, tall, dark hair, wearing leather jacket, walking confidently. realistic style.")
  })

  it("defaults style to realistic and omits outfit when missing", () => {
    const out = buildMotionPrompt({ name: "Mia", motionPrompt: "waving" })
    expect(out).toBe("Mia, waving. realistic style.")
  })

  it("drops the placeholder name; bare motion prompt is the result", () => {
    const out = buildMotionPrompt({ name: PLACEHOLDER_CHARACTER_NAME, motionPrompt: "waving" })
    expect(out).not.toContain(PLACEHOLDER_CHARACTER_NAME)
    expect(out).toBe("waving. realistic style.")
  })
})

// ---------------------------------------------------------------------------
// Phase 2 #3: kind-tagged reference-photo subject-line annotation. The map
// is the single source of truth for the human-friendly label each photo kind
// renders as in the assembled prompt; the helper is a typed wrapper.
// ---------------------------------------------------------------------------

describe("locationReferencePhotoKindLabel", () => {
  it("returns the expected label for each kind", () => {
    expect(locationReferencePhotoKindLabel("wide")).toBe("wide-angle reference")
    expect(locationReferencePhotoKindLabel("interior")).toBe("interior reference")
    expect(locationReferencePhotoKindLabel("exterior")).toBe("exterior reference")
    expect(locationReferencePhotoKindLabel("detail")).toBe("detail reference")
    expect(locationReferencePhotoKindLabel("moodBoard")).toBe("mood-board reference")
    expect(locationReferencePhotoKindLabel("other")).toBe("reference")
  })

  it("LOCATION_REFERENCE_PHOTO_KIND_LABELS covers every kind in LOCATION_REFERENCE_PHOTO_KINDS", () => {
    // Guard against the kind enum drifting from the label map. The map is a
    // `Record<LocationReferencePhotoKind, string>` so TS would already catch
    // missing keys, but this runtime check also verifies labels are non-empty.
    for (const kind of LOCATION_REFERENCE_PHOTO_KINDS) {
      expect(LOCATION_REFERENCE_PHOTO_KIND_LABELS[kind]).toBeDefined()
      expect(LOCATION_REFERENCE_PHOTO_KIND_LABELS[kind].length).toBeGreaterThan(0)
    }
    expect(Object.keys(LOCATION_REFERENCE_PHOTO_KIND_LABELS).sort()).toEqual(
      [...LOCATION_REFERENCE_PHOTO_KINDS].sort(),
    )
  })
})
