import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"

describe("voice-changer-pro node registry", () => {
  it("is discoverable via GET /v1/nodes with audio output and a voices field", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "voice-changer-pro")
    expect(d).toBeDefined()
    expect(d?.outputType).toBe("audio")
    expect(d?.inputSchema?.fields.some((f) => f.key === "orderedVoices")).toBe(true)
  })
})
