import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

const create = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create } }),
}))

import { callStructuredLlm } from "../structured-llm.js"

beforeEach(() => create.mockReset())

const schema = z.object({ color: z.enum(["red", "blue"]).optional() }).strict()

describe("callStructuredLlm", () => {
  it("forces tool_choice and returns the validated tool input", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "emit", input: { color: "red" } }],
      usage: { input_tokens: 10, output_tokens: 2 },
    })
    const { output } = await callStructuredLlm({
      schema, modelId: "claude-sonnet-4-6", system: "s",
      content: [{ type: "text", text: "hi" }],
    })
    expect(output).toEqual({ color: "red" })
    const params = create.mock.calls[0][0]
    expect(params.tool_choice).toEqual({ type: "tool", name: "emit" })
    expect(params.tools[0].input_schema.type).toBe("object")
  })

  it("retries on validation failure then succeeds", async () => {
    create
      .mockResolvedValueOnce({ content: [{ type: "tool_use", name: "emit", input: { color: "green" } }], usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ content: [{ type: "tool_use", name: "emit", input: { color: "blue" } }], usage: { input_tokens: 1, output_tokens: 1 } })
    const { output } = await callStructuredLlm({ schema, modelId: "claude-sonnet-4-6", system: "s", content: [{ type: "text", text: "hi" }], maxRetries: 1 })
    expect(output).toEqual({ color: "blue" })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("throws after exhausting retries", async () => {
    create.mockResolvedValue({ content: [{ type: "tool_use", name: "emit", input: { color: "green" } }], usage: { input_tokens: 1, output_tokens: 1 } })
    await expect(callStructuredLlm({ schema, modelId: "claude-sonnet-4-6", system: "s", content: [{ type: "text", text: "hi" }], maxRetries: 1 })).rejects.toThrow()
  })
})
