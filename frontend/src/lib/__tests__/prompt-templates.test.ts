import { describe, it, expect } from "vitest"
import {
  SYSTEM_PROMPT_TEMPLATES,
  TEMPLATE_GROUPS,
  WRAPPER_TEMPLATE_KEY,
  applyTemplate,
  resolveTemplate,
} from "../prompt-templates"

describe("SYSTEM_PROMPT_TEMPLATES", () => {
  const keys = Object.keys(SYSTEM_PROMPT_TEMPLATES)

  it("has exactly 9 template keys", () => {
    expect(keys).toHaveLength(9)
  })

  it("contains all expected keys", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "character-description",
        "object-description",
        "location-description",
        "face-description",
        "character-generation",
        "object-generation",
        "location-generation",
        "face-generation",
        "generate-image-wrapper",
      ])
    )
  })

  it("every template has required fields", () => {
    for (const [, info] of Object.entries(SYSTEM_PROMPT_TEMPLATES)) {
      expect(info.label).toBeTruthy()
      expect(info.template).toBeTruthy()
      expect(info.description).toBeTruthy()
      expect(Array.isArray(info.variables)).toBe(true)
    }
  })

  it("template variables match placeholders in template string", () => {
    for (const [, info] of Object.entries(SYSTEM_PROMPT_TEMPLATES)) {
      for (const v of info.variables) {
        expect(info.template).toContain(`{${v}}`)
      }
    }
  })
})

describe("TEMPLATE_GROUPS", () => {
  it("has exactly 4 groups", () => {
    expect(TEMPLATE_GROUPS).toHaveLength(4)
  })

  it("groups are Character, Object, Location, Face", () => {
    expect(TEMPLATE_GROUPS.map((g) => g.name)).toEqual([
      "Character",
      "Object",
      "Location",
      "Face",
    ])
  })

  it("group keys reference valid template keys", () => {
    for (const group of TEMPLATE_GROUPS) {
      expect(SYSTEM_PROMPT_TEMPLATES[group.descriptionKey]).toBeDefined()
      expect(SYSTEM_PROMPT_TEMPLATES[group.generationKey]).toBeDefined()
    }
  })
})

describe("WRAPPER_TEMPLATE_KEY", () => {
  it("equals generate-image-wrapper", () => {
    expect(WRAPPER_TEMPLATE_KEY).toBe("generate-image-wrapper")
  })

  it("references a valid template", () => {
    expect(SYSTEM_PROMPT_TEMPLATES[WRAPPER_TEMPLATE_KEY]).toBeDefined()
  })
})

describe("applyTemplate", () => {
  it("replaces a single variable", () => {
    expect(applyTemplate("Hello {name}!", { name: "World" })).toBe("Hello World!")
  })

  it("replaces multiple variables", () => {
    const result = applyTemplate("Include character '{name}': {description}.", {
      name: "Alice",
      description: "a tall warrior",
    })
    expect(result).toBe("Include character 'Alice': a tall warrior.")
  })

  it("replaces all occurrences of the same variable", () => {
    expect(applyTemplate("{x} and {x}", { x: "A" })).toBe("A and A")
  })

  it("replaces missing variable value with empty string", () => {
    expect(applyTemplate("Hello {name}!", { name: "" })).toBe("Hello !")
  })

  it("leaves unmatched placeholders when vars not provided for them", () => {
    expect(applyTemplate("{a} and {b}", { a: "X" })).toBe("X and {b}")
  })

  it("returns template unchanged when no vars match", () => {
    expect(applyTemplate("no vars here", {})).toBe("no vars here")
  })
})

describe("resolveTemplate", () => {
  it("returns flow template when provided (highest priority)", () => {
    const result = resolveTemplate(
      "character-description",
      { "character-description": "user version" },
      { "character-description": "flow version" }
    )
    expect(result).toBe("flow version")
  })

  it("returns user template when no flow template", () => {
    const result = resolveTemplate(
      "character-description",
      { "character-description": "user version" },
      {}
    )
    expect(result).toBe("user version")
  })

  it("returns system template when no user or flow templates", () => {
    const result = resolveTemplate("character-description")
    expect(result).toBe(SYSTEM_PROMPT_TEMPLATES["character-description"].template)
  })

  it("returns empty string for unknown key with no overrides", () => {
    expect(resolveTemplate("nonexistent-key")).toBe("")
  })

  it("handles undefined userTemplates and flowTemplates", () => {
    const result = resolveTemplate("character-description", undefined, undefined)
    expect(result).toBe(SYSTEM_PROMPT_TEMPLATES["character-description"].template)
  })
})
