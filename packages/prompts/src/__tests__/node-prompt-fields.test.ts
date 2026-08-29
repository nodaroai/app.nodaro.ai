import { describe, it, expect } from "vitest"
import { NODE_PROMPT_FIELDS, nodeSupportsPromptAffixes, PROMPT_AFFIX_NODE_TYPES, getPromptFields, promptAffixCoreField, promptFieldCarriesAffixes, PROMPT_AFFIX_CORE_FIELD_OVERRIDES } from "../node-prompt-fields.js"
import { NODE_PROMPT_CANDIDATE_FIELDS } from "../resolve-prompt.js"

describe("nodeSupportsPromptAffixes", () => {
  it("is true for every registered prompt node except explicit opt-outs", () => {
    for (const [type, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      expect(nodeSupportsPromptAffixes(type)).toBe(spec.affixes !== false)
    }
  })
  it("text-prompt (plain Text input) opts out", () => expect(nodeSupportsPromptAffixes("text-prompt")).toBe(false))
  it("generate-image / llm-chat / video-analysis support affixes", () => {
    for (const t of ["generate-image", "llm-chat", "video-analysis"]) expect(nodeSupportsPromptAffixes(t)).toBe(true)
  })
  it("unknown / undefined → false", () => {
    expect(nodeSupportsPromptAffixes("not-a-node")).toBe(false)
    expect(nodeSupportsPromptAffixes(undefined)).toBe(false)
  })
  it("PROMPT_AFFIX_NODE_TYPES is exactly the registry minus opt-outs (37 types)", () => {
    const expected = Object.entries(NODE_PROMPT_FIELDS).filter(([, s]) => s.affixes !== false).map(([t]) => t)
    expect([...PROMPT_AFFIX_NODE_TYPES].sort()).toEqual(expected.sort())
    expect(PROMPT_AFFIX_NODE_TYPES.size).toBe(37)
  })
  it("getPromptFields still resolves", () => expect(getPromptFields("generate-image")?.prompt).toBe("prompt"))
})

describe("promptAffixCoreField — the data key the RUN wraps with pre/post text", () => {
  it("most nodes: the editor's primary prompt field", () => {
    expect(promptAffixCoreField("generate-image")).toBe("prompt")
    expect(promptAffixCoreField("llm-chat")).toBe("userInput")
    expect(promptAffixCoreField("text-to-speech")).toBe("directText")
  })
  it("generate-script: the run wraps the topic `prompt`, NOT the editor's styleGuide (spec §7)", () => {
    expect(getPromptFields("generate-script")?.prompt).toBe("styleGuide")
    expect(promptAffixCoreField("generate-script")).toBe("prompt")
  })
  it("nodes with no affixes have no core field", () => {
    expect(promptAffixCoreField("text-prompt")).toBeUndefined()
    expect(promptAffixCoreField("not-a-node")).toBeUndefined()
    expect(promptAffixCoreField(undefined)).toBeUndefined()
  })
  it("every affix-capable type resolves to a core field", () => {
    for (const t of PROMPT_AFFIX_NODE_TYPES) expect(promptAffixCoreField(t)).toBeTruthy()
  })
  it("every override key is an affix-capable node type", () => {
    for (const t of Object.keys(PROMPT_AFFIX_CORE_FIELD_OVERRIDES)) {
      expect(PROMPT_AFFIX_NODE_TYPES.has(t)).toBe(true)
    }
  })
})

describe("promptFieldCarriesAffixes — does previewing this key show the run's affixes?", () => {
  it("the core field carries them; a sibling field does not", () => {
    expect(promptFieldCarriesAffixes("llm-chat", "userInput")).toBe(true)
    expect(promptFieldCarriesAffixes("llm-chat", "systemPrompt")).toBe(false)
    expect(promptFieldCarriesAffixes("generate-script", "prompt")).toBe(true)
    expect(promptFieldCarriesAffixes("generate-script", "styleGuide")).toBe(false)
  })
  it("a run-time FALLBACK candidate carries them too (i2v's legacy motionPrompt)", () => {
    // computeNodePrompt picks the first present of ["prompt", "motionPrompt"]
    // and wraps THAT with the affixes — so previewing motionPrompt must wrap.
    expect(promptFieldCarriesAffixes("image-to-video", "motionPrompt")).toBe(true)
    expect(promptFieldCarriesAffixes("generate-video", "motionPrompt")).toBe(true)
    expect(promptFieldCarriesAffixes("text-to-audio", "text")).toBe(true)
  })
  it("an affix-less node never carries them, whatever the field", () => {
    expect(promptFieldCarriesAffixes("text-prompt", "text")).toBe(false)
    expect(promptFieldCarriesAffixes("not-a-node", "prompt")).toBe(false)
  })
  it("omitting the field falls back to the node's primary prompt field", () => {
    expect(promptFieldCarriesAffixes("generate-image", undefined)).toBe(true)
    // generate-script's primary (styleGuide) is NOT the core → no wrap.
    expect(promptFieldCarriesAffixes("generate-script", undefined)).toBe(false)
    expect(promptFieldCarriesAffixes("text-prompt", undefined)).toBe(false)
  })
  it("no override type also declares run-time candidates (the two rules never collide)", () => {
    for (const t of Object.keys(PROMPT_AFFIX_CORE_FIELD_OVERRIDES)) {
      expect(NODE_PROMPT_CANDIDATE_FIELDS[t]).toBeUndefined()
    }
  })
})
