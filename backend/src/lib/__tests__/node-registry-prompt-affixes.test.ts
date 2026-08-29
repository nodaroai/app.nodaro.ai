import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"
import { nodeSupportsPromptAffixes } from "@nodaro/prompts"

describe("GET /v1/nodes advertises promptPrefix/promptSuffix on exactly the affix-capable nodes", () => {
  for (const d of NODE_REGISTRY) {
    it(d.type, () => {
      const keys = new Set((d.inputSchema?.fields ?? []).map((f) => f.key))
      const advertised = keys.has("promptPrefix") && keys.has("promptSuffix")
      expect(advertised).toBe(nodeSupportsPromptAffixes(d.type))
      if (advertised) {
        expect(d.inputSchema!.fields.filter((f) => f.key === "promptPrefix")).toHaveLength(1)
        expect(d.inputSchema!.fields.find((f) => f.key === "promptPrefix")!.type).toBe("text")
      }
    })
  }
})
