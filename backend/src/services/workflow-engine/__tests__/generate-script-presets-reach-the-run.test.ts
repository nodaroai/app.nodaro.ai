/**
 * Every field a Generate Script factory preset sets reaches the run.
 *
 * Presets used to set `structure` ("freeform" / "8-step"), a field neither
 * engine sends and the script prompt never reads, so picking "Explainer" or
 * "Story Beats" silently dropped the eight-step shape it promised (#1589).
 * This drives the real workflow payload builder: for each key a preset sets,
 * the payload built with it must differ from the payload built without it.
 */
import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS } from "@nodaro/prompts"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

const presets = FACTORY_PRESETS["generate-script"] ?? []

function payloadFor(data: Record<string, unknown>): unknown {
  const node: SimpleNode = { id: "n", type: "generate-script", data: { label: "Script", prompt: "a coffee grinder", ...data } }
  return buildPayload(node, "job-1", {}).payload
}

describe("Generate Script presets set only what the run reads", () => {
  it("has presets to check", () => {
    expect(presets.length).toBeGreaterThan(5)
  })

  for (const preset of presets) {
    it(preset.id, () => {
      const data = preset.data as Record<string, unknown>
      for (const key of Object.keys(data)) {
        const { [key]: _dropped, ...without } = data
        expect(payloadFor(data), `${preset.id}: "${key}" never reaches the run`).not.toEqual(payloadFor(without))
      }
    })
  }
})
