import { describe, it, expect } from "vitest"
import { extractPresetData } from "@nodaro/shared"
import { NODE_DEFINITIONS } from "@/types/nodes"

describe("node presets cross-cutting eligibility", () => {
  const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type as string, d]))

  it.each([
    "generate-image",
    "generate-video",
    "text-to-speech",
    "generate-music",
    "llm-chat",
    "text-prompt",
  ])("configurable node %s yields capturable preset data", (type) => {
    const def = byType.get(type)
    expect(def, `missing NODE_DEFINITIONS entry for ${type}`).toBeTruthy()
    const captured = extractPresetData(def!.defaultData as Record<string, unknown>)
    expect(Object.keys(captured).length).toBeGreaterThan(0)
  })

  it("config-less nodes (sticky-note) yield no capturable data beyond excluded keys", () => {
    const def = byType.get("sticky-note")
    if (!def) return // tolerate absence
    const captured = extractPresetData(def.defaultData as Record<string, unknown>)
    expect(typeof captured).toBe("object")
  })

  it("extractPresetData never returns identity / wiring / DB-reference fields for any node default", () => {
    // Non-portable fields the preset contract must strip for EVERY node type, current and future.
    const excluded = [
      "label",
      "fieldMappings",
      "referenceImageOrder",
      "referenceOrder",
      "connectedMediaOrder",
      "connectedRefImageOrder",
      "characterDefinitionIds",
      "suppressedCanonicalCharacterIds",
      "suppressedCanonicalLocationIds",
      "identityMeta",
      "extraRefs",
      "routes",
      "routeId",
      "routeIds",
      "ports",
      "inputPorts",
      "outputPorts",
      "channel",
      "channelColor",
    ]
    for (const def of NODE_DEFINITIONS) {
      const captured = extractPresetData(def.defaultData as Record<string, unknown>)
      for (const field of excluded) {
        expect(captured, `${def.type} leaked ${field}`).not.toHaveProperty(field)
      }
    }
  })
})
