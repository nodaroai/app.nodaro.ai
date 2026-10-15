/**
 * `minReferences` / `needsImage` is what a client reads before running a preset
 * with `presetId` (`POST /v1/generate-image`, MCP `generate_image`), and that
 * run goes through ONE function: `buildGenerateImagePresetBody`
 * (apply-image-preset.ts), the editor's build. So the two must agree:
 *
 *   - the tokens counted from a preset's stored data are the tokens in the
 *     prompt the run assembles from it (the editor's node, `computeNodePrompt`,
 *     the negative prompt) — one reading, not two;
 *   - a photo-based factory preset run with `minReferences` images sends every
 *     one of them to its model — none dropped by the model's reference gate.
 */
import { describe, it, expect } from "vitest"
import { getFactoryPresets, presetMinReferences } from "@nodaro/prompts/presets"
import { computeNodePrompt } from "@nodaro/prompts/prompt-fields"
import { buildGenerateImagePresetBody, editorNodeData, PresetVariablesRequiredError } from "../apply-image-preset.js"
import { referenceFields } from "../preset-view.js"

const NODE_TYPE = "generate-image"
const PRESETS = getFactoryPresets(NODE_TYPE)

/** The body the run builds, with a value for any placeholder that has no default. */
function runBody(data: Readonly<Record<string, unknown>>, referenceImageUrls: string[]): Record<string, unknown> {
  try {
    return buildGenerateImagePresetBody(data, { referenceImageUrls })
  } catch (err) {
    if (!(err instanceof PresetVariablesRequiredError)) throw err
    const variables = Object.fromEntries(err.tokens.map((t) => [t, "Acme"]))
    return buildGenerateImagePresetBody(data, { referenceImageUrls }, variables)
  }
}

describe("generate-image presets — the photo count and the run agree", () => {
  it("counts the same {image:N} tokens in a preset's data as in the prompt the run assembles from it", () => {
    const wrong: string[] = []
    for (const p of PRESETS) {
      const node = editorNodeData(p.data, {})
      const assembled = computeNodePrompt(NODE_TYPE, node, { refMap: new Map(), appendWired: true })
      const fromRun = presetMinReferences(NODE_TYPE, { prompt: assembled, negativePrompt: node.negativePrompt })
      const fromData = presetMinReferences(NODE_TYPE, p.data)
      if (fromRun !== fromData) wrong.push(`${p.id}: data ${fromData}, run ${fromRun}`)
    }
    expect(wrong).toEqual([])
    expect(PRESETS.filter((p) => presetMinReferences(NODE_TYPE, p.data) > 0).length).toBeGreaterThan(0)
  })

  it("a photo-based preset run with minReferences images sends every one of them to its model", () => {
    const photoPresets = PRESETS.filter((p) => referenceFields(NODE_TYPE, p.data, p.minReferences).needsImage)
    expect(photoPresets.length).toBeGreaterThan(30)
    const dropped: string[] = []
    for (const p of photoPresets) {
      const { minReferences } = referenceFields(NODE_TYPE, p.data, p.minReferences)
      const urls = Array.from({ length: minReferences }, (_, i) => `https://cdn.example.test/images/ref-${i + 1}.png`)
      const sent = runBody(p.data, urls).referenceImageUrls
      const count = Array.isArray(sent) ? sent.length : 0
      if (count !== minReferences) dropped.push(`${p.id} (${String(p.data.provider)}): ${minReferences} attached, ${count} sent`)
    }
    expect(dropped).toEqual([])
  })
})
