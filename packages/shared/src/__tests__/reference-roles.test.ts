// packages/shared/src/__tests__/reference-roles.test.ts
import { describe, it, expect } from "vitest"
import { REFERENCE_ROLE_PRESETS, roleToPhrase, defaultRoleForSource } from "../reference-roles.js"
import { DEFAULT_LABEL_BY_SOURCE } from "../types.js"

describe("reference-roles registry", () => {
  it("every source's default role is present in its preset list", () => {
    for (const source of Object.keys(DEFAULT_LABEL_BY_SOURCE) as Array<keyof typeof DEFAULT_LABEL_BY_SOURCE>) {
      const presets = REFERENCE_ROLE_PRESETS[source]
      expect(presets, source).toBeTruthy()
      const def = defaultRoleForSource(source)
      // Media sources (manual / wired-image) default to ref-only = the empty
      // label (a bare {image:N} token). Empty is not a preset role.
      if (def === "") continue
      expect(presets, source).toContain(def)
    }
  })

  it("media sources default to ref-only (empty label)", () => {
    expect(DEFAULT_LABEL_BY_SOURCE["manual"]).toBe("")
    expect(DEFAULT_LABEL_BY_SOURCE["wired-image"]).toBe("")
  })

  it("defaultRoleForSource mirrors DEFAULT_LABEL_BY_SOURCE", () => {
    expect(defaultRoleForSource("wired-character")).toBe("person")
    expect(defaultRoleForSource("wired-location")).toBe("background")
    expect(defaultRoleForSource("wired-object")).toBe("object")
    expect(defaultRoleForSource("wired-creature")).toBe("creature")
  })

  it("renders noun roles as 'the {role} from {binding}'", () => {
    expect(roleToPhrase("person", "reference image A")).toBe("the person from reference image A")
    expect(roleToPhrase("face", "@image_3")).toBe("the face from @image_3")
  })

  it("renders the non-noun specials naturally", () => {
    expect(roleToPhrase("as-is", "reference image A")).toBe("reference image A, used as-is")
    expect(roleToPhrase("empty background", "reference image A"))
      .toBe("the background from reference image A (without its foreground objects)")
  })

  it("renders a custom single-word label via the default template", () => {
    expect(roleToPhrase("hoodie", "reference image B")).toBe("the hoodie from reference image B")
  })
})

describe("ref-only role", () => {
  it("renders as the bare binding (no descriptive phrase)", () => {
    expect(roleToPhrase("ref-only", "reference image A")).toBe("reference image A")
    expect(roleToPhrase("ref-only", "@image_3")).toBe("@image_3")
  })
  it("is a curated preset for character and location (honored by the preset-gated resolvers)", () => {
    expect(REFERENCE_ROLE_PRESETS["wired-character"]).toContain("ref-only")
    expect(REFERENCE_ROLE_PRESETS["wired-location"]).toContain("ref-only")
  })
})
