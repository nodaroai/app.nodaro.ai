import { describe, it, expect } from "vitest"
import { buildWizardAnalyzeSystem, buildWizardEnhanceSystem, buildWizardGenerateSystem } from "../prompt-wizard-system.js"

describe("buildWizardAnalyzeSystem", () => {
  it("frames reference order as priority in the per-image role questions", () => {
    const sys = buildWizardAnalyzeSystem({
      nodeType: "generate-image",
      nodeContext: { referenceImageCount: 2 },
    })
    expect(sys).toContain("Image 1 carries the most weight")
    expect(sys).toContain("reference-role-1")
  })

  it("pins the language doctrine: labels mirror the user's language, values are ALWAYS English", () => {
    // A Hebrew prompt produced Hebrew labels (fine — UI text) but nothing
    // pinned the option VALUES to English; values are prompt fragments fed
    // verbatim to generation models, which perform best in English.
    const sys = buildWizardAnalyzeSystem({ nodeType: "generate-image" })
    expect(sys).toContain("USER'S language")
    expect(sys).toMatch(/"value" string MUST be in ENGLISH/i)
  })
})

describe("buildWizardEnhanceSystem", () => {
  it("does NOT throw for a node type absent from the wizard category map (lip-sync)", () => {
    expect(() => buildWizardEnhanceSystem({ nodeType: "lip-sync" })).not.toThrow()
  })

  it("produces a one-shot prompt builder, not the analyze question form", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "generate-image", provider: "flux" })
    expect(sys).toContain('"prompt"')                  // generate-shaped JSON contract
    expect(sys).not.toContain("Available Categories")  // not the analyze form
    expect(sys).toMatch(/do not ask questions/i)
    expect(sys).toContain("Current provider: flux")
  })

  it("injects the Seedance doctrine when the current provider has one", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "text-to-video", provider: "seedance-2" })
    expect(sys).toContain("Provider Prompting Doctrine")
    expect(sys).toContain("Shot 1")           // untimed storyboard rule
    expect(sys).toContain("headshot")          // identity rule
    expect(sys).toContain("（")                // audio symbol semantics
  })

  it("omits the doctrine section for providers without one", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "text-to-video", provider: "veo3.1" })
    expect(sys).not.toContain("Provider Prompting Doctrine")
  })

  it("instructs ordinal reference binding when refs are attached", () => {
    const sys = buildWizardEnhanceSystem({
      nodeType: "generate-video",
      provider: "veo3.1",
      nodeContext: { referenceImageCount: 3 },
    })
    expect(sys).toContain("Image 1")
    expect(sys).toContain("Image 3")
    expect(sys).toMatch(/bind each subject/i)
    expect(sys).toMatch(/earlier references carry more weight/i)
  })

  it("no ordinal block without refs", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "generate-video", provider: "veo3.1" })
    expect(sys).not.toMatch(/bind each subject/i)
  })

  it("generate-form also receives the doctrine", () => {
    const sys = buildWizardGenerateSystem({
      nodeType: "text-to-video",
      provider: "seedance-2-fast",
      selections: [{ category: "mood-tone", value: "melancholic", isCustom: false }],
    })
    expect(sys).toContain("Provider Prompting Doctrine")
  })

  it("pins English output: the composed/optimized prompt translates non-English input", () => {
    const gen = buildWizardGenerateSystem({
      nodeType: "generate-image",
      selections: [{ category: "subject", value: "a desert road", isCustom: false }],
    })
    expect(gen).toMatch(/MUST be entirely in English/i)
    const enhance = buildWizardEnhanceSystem({ nodeType: "generate-image" })
    expect(enhance).toMatch(/MUST be entirely in English/i)
  })
})

describe("buildWizardGenerateSystem — suno style target emits tags", () => {
  const genCtx = (nodeType: string) => ({ nodeType, selections: [] })

  it("style target asks for comma-separated tags, not prose", () => {
    const sys = buildWizardGenerateSystem(genCtx("suno-generate:style"))
    expect(sys.toLowerCase()).toMatch(/comma-separated|style tags/)
    expect(sys).not.toMatch(/under 500 characters/i)
  })

  it("a normal target keeps the prose rule (unchanged)", () => {
    const sys = buildWizardGenerateSystem(genCtx("generate-image"))
    expect(sys).toMatch(/under 500 characters/i)
  })

  it("style target drops the prose Task line + keyword-stuff rule (whole prompt agrees)", () => {
    const sys = buildWizardGenerateSystem(genCtx("suno-generate:style"))
    // A tag list violates the base "do not keyword-stuff" rule, and the prose
    // Task line contradicts the tag-output rule — neither may survive for :style.
    expect(sys).not.toMatch(/do not keyword-stuff/i)
    expect(sys).not.toMatch(/Build a natural-language .* generation prompt/i)
  })

  it("a normal target keeps the prose Task line + keyword-stuff rule", () => {
    const sys = buildWizardGenerateSystem(genCtx("generate-image"))
    expect(sys).toMatch(/do not keyword-stuff/i)
    expect(sys).toMatch(/Build a natural-language image generation prompt/i)
  })
})

describe("buildWizardGenerateSystem — suno negativeStyle + lyrics targets (Task 5)", () => {
  const genCtx = (nodeType: string) => ({ nodeType, selections: [] })

  it("negativeStyle target asks for avoid/exclude tags (comma-separated), not 500-char prose", () => {
    const sys = buildWizardGenerateSystem(genCtx("suno-generate:negativeStyle"))
    // Avoid-tags framing: must instruct the model to EXCLUDE styles. Assert the
    // uppercase "EXCLUDE" token, which appears ONLY in the negativeStyle framing —
    // the shared template's static Rule #5 ("Avoid:") and the :style framing do
    // not, so this genuinely discriminates negativeStyle from a :style regression.
    expect(sys).toContain("EXCLUDE")
    // …as a comma-separated tag list (same shape as :style)…
    expect(sys.toLowerCase()).toContain("comma-separated")
    // …and must NOT carry the prose 500-char rule or the keyword-stuff rule.
    expect(sys).not.toMatch(/under 500 characters/i)
    expect(sys).not.toMatch(/do not keyword-stuff/i)
  })

  it("lyrics target asks for sectioned LYRICS — not tags, not 500-char prose", () => {
    const sys = buildWizardGenerateSystem(genCtx("suno-generate:lyrics"))
    // Sectioned-lyrics framing: actual sung words with section tags.
    expect(sys).toMatch(/verse|chorus|lyric/i)
    // Lyrics are PROSE lines, NOT a comma-separated tag list…
    expect(sys).not.toMatch(/comma-separated/i)
    // …and NOT the natural-language 500-char prompt rule.
    expect(sys).not.toMatch(/under 500 characters/i)
  })

  // BYTE-IDENTITY GUARD: the refactor only touches the Task line, output rule
  // (#1), and keyword rule (#3). Asserting those three lines VERBATIM for a
  // non-suno target proves the whole prompt is byte-identical to the original
  // (every other line of the template is untouched). The em-dash chars below
  // are copied from the source literals.
  it("a normal target stays byte-identical (Task/output/keyword lines verbatim)", () => {
    const sys = buildWizardGenerateSystem(genCtx("generate-image"))
    expect(sys).toContain("Build a natural-language image generation prompt from the user's selections.")
    expect(sys).toContain("Weave all selections into one concise, natural-language prompt — under 500 characters.")
    expect(sys).toContain("Weave style, mood, lighting naturally — do not keyword-stuff.")
  })
})
