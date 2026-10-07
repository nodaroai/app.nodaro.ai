import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode } from "@/types/nodes"

const node = (provider: unknown) =>
  ({ id: "d", type: "text-to-dialogue", position: { x: 0, y: 0 }, data: { label: "Dialogue", provider } }) as unknown as WorkflowNode

describe("Text to Dialogue price identifier (mirrors the backend estimator)", () => {
  it.each([undefined, "nope", "elevenlabs-v4", "constructor"])("is v3 dialogue's id for a node on %j", (provider) => {
    expect(getModelIdentifier(node(provider))).toBe("elevenlabs-dialogue")
  })

  it("is the node's own dialogue model when it names one", () => {
    expect(getModelIdentifier(node("elevenlabs-dialogue"))).toBe("elevenlabs-dialogue")
  })
})
