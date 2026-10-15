/**
 * How many connected reference images a preset works from (`minReferences`,
 * served as `needsImage` / `minReferences` by `GET /v1/node-presets/factory`
 * and on every user preset).
 *
 * Two sources feed one number (`presetMinReferences`):
 *   - the `{image:N}` / `{image:N:label}` tokens in the preset's prompt fields —
 *     derived, so a template that names its references can never under-report;
 *   - a DECLARATION on the factory preset, for the families whose prompt says
 *     "the attached photo" in words (Reference Sheet, Portrait Transformations,
 *     Stylized Subject, Edits, …): no data field marks those, so the number is
 *     stated where the preset is written.
 *
 * The guards below keep the declarations honest: a declaration never states
 * less than the preset's own tokens, a group never mixes photo and text-only
 * presets unless it is listed with a reason, and the families the product
 * names as photo-based all resolve to at least one reference.
 */
import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, MAX_PRESET_REFERENCES, presetMinReferences, type FactoryPreset } from "../factory-presets.js"
import { NODE_PROMPT_CANDIDATE_FIELDS, computeNodePrompt } from "../resolve-prompt.js"
import { nodeSupportsPromptAffixes } from "../node-prompt-fields.js"

const all = (): Array<[nodeType: string, preset: FactoryPreset]> =>
  Object.entries(FACTORY_PRESETS).flatMap(([nodeType, list]) => list.map((p) => [nodeType, p] as [string, FactoryPreset]))

const effective = (nodeType: string, p: FactoryPreset): number => presetMinReferences(nodeType, p.data, p.minReferences)
const tokenFloor = (nodeType: string, p: FactoryPreset): number => presetMinReferences(nodeType, p.data)

describe("presetMinReferences — derived from the prompt's reference tokens", () => {
  it("is 0 for a prompt with no tokens, and for data with no prompt at all", () => {
    expect(presetMinReferences("generate-image", { prompt: "a red fox in the snow" })).toBe(0)
    expect(presetMinReferences("generate-image", {})).toBe(0)
  })

  it("reads the highest position over bare and labelled tokens", () => {
    expect(presetMinReferences("generate-image", { prompt: "make the persons in {image:1} faceless" })).toBe(1)
    expect(presetMinReferences("generate-image", { prompt: "{image:1:person} holds {image:2:product}" })).toBe(2)
    expect(presetMinReferences("generate-image", { prompt: "{image:3} beside {image:1:dog}" })).toBe(3)
    expect(presetMinReferences("generate-video", { prompt: "{IMAGE:2:product} spins" })).toBe(2)
  })

  it("reads the pre/post text and the negative prompt, where the node has them", () => {
    expect(presetMinReferences("generate-image", { promptPrefix: "keep {image:1} unchanged" })).toBe(1)
    expect(presetMinReferences("generate-image", { promptSuffix: "lit like {image:2:settings}" })).toBe(2)
    expect(presetMinReferences("generate-image", { negativePrompt: "anything unlike {image:1:face}" })).toBe(1)
  })

  it("ignores fields that are not the node's prompt fields, and values that are not text", () => {
    expect(presetMinReferences("generate-image", { style: "{image:4}", prompt: "a cat" })).toBe(0)
    expect(presetMinReferences("generate-image", { prompt: 42 as unknown as string })).toBe(0)
  })

  it("reads a node whose prompt lives in another field (llm-chat → userInput)", () => {
    expect(presetMinReferences("llm-chat", { userInput: "describe {image:1}" })).toBe(1)
    expect(presetMinReferences("llm-chat", { prompt: "describe {image:1}" })).toBe(0)
  })

  it("is 0 for a node type with no prompt fields (an app namespace such as recast-render)", () => {
    expect(presetMinReferences("recast-render", { schemaVersion: 1, prompt: "{image:2}" })).toBe(0)
    expect(presetMinReferences("does-not-exist", { prompt: "{image:2}" })).toBe(0)
  })

  it("never counts position 0 (positions start at 1)", () => {
    expect(presetMinReferences("generate-image", { prompt: "{image:0}" })).toBe(0)
  })

  it("takes a declaration when it is higher than the tokens, and never goes below them", () => {
    expect(presetMinReferences("generate-image", { prompt: "the attached photo" }, 1)).toBe(1)
    expect(presetMinReferences("generate-image", { prompt: "{image:2}" }, 1)).toBe(2)
    expect(presetMinReferences("generate-image", { prompt: "a cat" }, 0)).toBe(0)
  })

  it("never asks for more photos than any image model takes", () => {
    expect(MAX_PRESET_REFERENCES).toBeGreaterThanOrEqual(4)
    expect(MAX_PRESET_REFERENCES).toBeLessThan(100)
    expect(presetMinReferences("generate-image", { prompt: "{image:99999}" })).toBe(MAX_PRESET_REFERENCES)
    expect(presetMinReferences("generate-image", { prompt: "a cat" }, 5000)).toBe(MAX_PRESET_REFERENCES)
    expect(presetMinReferences("generate-image", { prompt: `{image:${MAX_PRESET_REFERENCES}}` })).toBe(MAX_PRESET_REFERENCES)
  })

  it("ignores a declaration that is not a positive whole number", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(presetMinReferences("generate-image", { prompt: "a cat" }, bad)).toBe(0)
    }
  })
})

/**
 * One source of truth with how a preset RUNS: the run resolves a node's prompt
 * through `computeNodePrompt` (the editor's build, and `presetId` on
 * /v1/generate-image — lib/presets/apply-image-preset.ts), which joins the
 * node's candidate prompt fields and its pre/post text. A token in any field
 * the run reads must be counted, or a preset would run with fewer photos than
 * its prompt names.
 */
describe("presetMinReferences reads every field the run reads", () => {
  const cases = Object.entries(NODE_PROMPT_CANDIDATE_FIELDS).flatMap(([nodeType, fields]) => [
    ...fields.map((f) => [nodeType, f] as const),
    ...(nodeSupportsPromptAffixes(nodeType) ? (["promptPrefix", "promptSuffix"] as const).map((f) => [nodeType, f] as const) : []),
  ])

  it.each(cases)("%s: a token in %s counts", (nodeType, field) => {
    expect(presetMinReferences(nodeType, { [field]: "keep {image:3:subject} as is" })).toBe(3)
  })

  it("counts the same tokens in a factory preset's raw data as in the prompt the run assembles from it", () => {
    for (const [nodeType, p] of all()) {
      if (!(nodeType in NODE_PROMPT_CANDIDATE_FIELDS)) continue
      const assembled = computeNodePrompt(nodeType, { ...p.data }, { refMap: new Map() })
      const fromRun = presetMinReferences(nodeType, {
        prompt: assembled,
        negativePrompt: typeof p.data.negativePrompt === "string" ? p.data.negativePrompt : undefined,
      })
      expect(tokenFloor(nodeType, p), p.id).toBe(fromRun)
    }
  })
})

describe("factory presets — declared reference counts", () => {
  it("a declaration is a positive whole number (absence means: no photo needed beyond the tokens)", () => {
    const bad = all()
      .filter(([, p]) => p.minReferences !== undefined && !(Number.isInteger(p.minReferences) && p.minReferences > 0))
      .map(([, p]) => `${p.id}: ${p.minReferences}`)
    expect(bad).toEqual([])
  })

  it("no preset declares fewer references than its own prompt tokens name", () => {
    const under = all()
      .filter(([nodeType, p]) => p.minReferences !== undefined && p.minReferences < tokenFloor(nodeType, p))
      .map(([nodeType, p]) => `${p.id}: declares ${p.minReferences}, its tokens name ${tokenFloor(nodeType, p)}`)
    expect(under).toEqual([])
  })

  it("no preset declares exactly what its tokens already say (the declaration is for prose, not tokens)", () => {
    const redundant = all()
      .filter(([nodeType, p]) => p.minReferences !== undefined && p.minReferences === tokenFloor(nodeType, p))
      .map(([, p]) => p.id)
    expect(redundant).toEqual([])
  })

  /**
   * Groups whose presets mix photo-based and text-only entries on purpose.
   * Every other group is all-or-nothing, so a preset added to a photo group
   * without its declaration fails here instead of shipping as text-only.
   */
  const MIXED_GROUPS: Readonly<Record<string, string>> = {
    "generate-image/Realism & Authentic":
      "text-only realism shots beside two that put the user's own photo in the frame ({image:1:person}, {image:1:product})",
  }

  it("every group is all photo-based or all text-only, except the listed mixed groups", () => {
    const groups = new Map<string, { photo: string[]; text: string[] }>()
    for (const [nodeType, p] of all()) {
      if (!p.group) continue
      const key = `${nodeType}/${p.group}`
      const g = groups.get(key) ?? { photo: [], text: [] }
      ;(effective(nodeType, p) > 0 ? g.photo : g.text).push(p.id)
      groups.set(key, g)
    }
    const mixed = [...groups.entries()]
      .filter(([key, g]) => g.photo.length > 0 && g.text.length > 0 && !(key in MIXED_GROUPS))
      .map(([key, g]) => `${key}: photo [${g.photo.join(", ")}] vs text-only [${g.text.join(", ")}]`)
    expect(mixed).toEqual([])
  })

  it("each listed mixed group is still mixed (an entry that stopped mixing leaves the list)", () => {
    for (const key of Object.keys(MIXED_GROUPS)) {
      const [nodeType, ...rest] = key.split("/")
      const group = rest.join("/")
      const presets = (FACTORY_PRESETS[nodeType!] ?? []).filter((p) => p.group === group)
      const photo = presets.filter((p) => effective(nodeType!, p) > 0).length
      expect(photo, key).toBeGreaterThan(0)
      expect(presets.length - photo, key).toBeGreaterThan(0)
    }
  })

  /** The families the product names as working from a connected photo. */
  const PHOTO_FAMILIES: ReadonlyArray<[nodeType: string, group: string]> = [
    ["generate-image", "Reference Sheet"],
    ["generate-image", "Cast & Consistency"],
    ["generate-image", "Edit by Name"],
    ["generate-image", "Face Privacy"],
    ["generate-image", "Edits"],
    ["generate-image", "Portrait Transformations"],
    ["generate-image", "Stylized Subject"],
    ["modify-image", "Edits"],
    ["modify-image", "Stylized Subject"],
    ["generate-video", "UGC & Creator"],
  ]

  it.each(PHOTO_FAMILIES)("%s · %s: every preset needs at least one reference", (nodeType, group) => {
    const presets = (FACTORY_PRESETS[nodeType] ?? []).filter((p) => p.group === group)
    expect(presets.length).toBeGreaterThan(0)
    expect(presets.filter((p) => effective(nodeType, p) < 1).map((p) => p.id)).toEqual([])
  })

  it("every preset whose prompt uses {image:N} needs at least N references", () => {
    const short = all()
      .filter(([nodeType, p]) => effective(nodeType, p) < tokenFloor(nodeType, p))
      .map(([, p]) => p.id)
    expect(short).toEqual([])
    expect(all().filter(([nodeType, p]) => tokenFloor(nodeType, p) > 0).length).toBeGreaterThan(5)
  })

  it.each([
    ["generate-image", "generate-image/cast-mega-grid", 2],
    ["generate-image", "generate-image/character-board", 1],
    ["generate-image", "generate-image/faceless-3d-head", 1],
    ["generate-image", "generate-image/product-in-hand", 1],
    ["generate-image", "generate-image/cinematic-portrait", 0],
    ["modify-image", "modify-image/background-remove", 1],
    ["generate-video", "generate-video/ugc-product-closer", 2],
    ["generate-video", "generate-video/handheld-unboxing", 2],
    ["generate-video", "generate-video/ugc-talking-head", 1],
    ["generate-video", "generate-video/slow-push-in", 0],
  ] as const)("%s %s → %i", (nodeType, id, n) => {
    const preset = (FACTORY_PRESETS[nodeType] ?? []).find((p) => p.id === id)
    expect(preset, id).toBeDefined()
    expect(effective(nodeType, preset!)).toBe(n)
  })
})
