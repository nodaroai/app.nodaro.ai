/**
 * How many tokens an LLM node's run may write: the orchestrator's default, and the
 * floor the request layer raises it to. One file answers it for the orchestrator,
 * the request layer and the listing, so the three cannot drift.
 */
import { describe, it, expect } from "vitest"
import { getLlmModel, reasoningOutputFloor } from "@nodaro/shared"
import { LLM_NODE_MAX_TOKENS_DEFAULTS, llmNodeMaxTokens, llmNodeOutputTokenCap, raiseToReasoningFloor } from "../llm-node-output-cap.js"
import { buildSyncHttpBody } from "../../services/workflow-engine/node-executor.js"

describe("llmNodeMaxTokens", () => {
  it("is the node's value, else the default the orchestrator sends", () => {
    expect(llmNodeMaxTokens("llm-chat", { maxTokens: 200 })).toBe(200)
    expect(llmNodeMaxTokens("llm-chat", {})).toBe(8192)
    expect(llmNodeMaxTokens("ai-writer", {})).toBe(4096)
  })

  it("reads a value the route would reject as the default", () => {
    for (const bad of [0, -5, Number.NaN, "200", null]) expect(llmNodeMaxTokens("llm-chat", { maxTokens: bad })).toBe(8192)
  })

  it("is what buildSyncHttpBody sends: the executor reads the same defaults", () => {
    for (const type of ["llm-chat", "ai-writer"]) {
      const body = buildSyncHttpBody({ id: "n", type, data: {} } as never, {} as never, { userId: "u" } as never)
      expect(body.maxTokens, type).toBe(LLM_NODE_MAX_TOKENS_DEFAULTS[type])
      expect(llmNodeMaxTokens(type, {}), type).toBe(body.maxTokens)
    }
  })
})

describe("raiseToReasoningFloor", () => {
  const thinks = getLlmModel("claude-opus-5")!
  const plain = getLlmModel("claude-sonnet-4.6")!

  it("raises the cap to the model's floor when thinking shares the budget, never lowers it", () => {
    expect(raiseToReasoningFloor(thinks, undefined, 200)).toBe(reasoningOutputFloor(thinks))
    expect(raiseToReasoningFloor(thinks, undefined, 99999)).toBe(99999)
    expect(raiseToReasoningFloor(plain, "max", 200)).toBe(reasoningOutputFloor(plain))
    expect(raiseToReasoningFloor(plain, "xhigh", 200)).toBe(reasoningOutputFloor(plain))
  })

  it("leaves the cap alone otherwise", () => {
    expect(raiseToReasoningFloor(plain, undefined, 200)).toBe(200)
    expect(raiseToReasoningFloor(plain, "high", 200)).toBe(200)
  })
})

describe("llmNodeOutputTokenCap", () => {
  it("is the node's maxTokens on a model that does not reason by default", () => {
    expect(llmNodeOutputTokenCap("llm-chat", { llmModel: "claude-sonnet-4.6", maxTokens: 200 })).toBe(200)
  })

  it("reads the feature's default model when the node names none (Prompt: a reasoning Gemini, 8192-token floor)", () => {
    expect(llmNodeOutputTokenCap("llm-chat", { maxTokens: 200 })).toBe(8192)
    expect(llmNodeOutputTokenCap("ai-writer", { maxTokens: 200 })).toBe(200)
  })

  it("reads an effort the model supports, and an Advanced-mode node on the direct lane's wider ladder", () => {
    expect(llmNodeOutputTokenCap("llm-chat", { llmModel: "claude-sonnet-4.6", maxTokens: 200, reasoningEffort: "max" })).toBe(reasoningOutputFloor(getLlmModel("claude-sonnet-4.6")!))
    expect(llmNodeOutputTokenCap("llm-chat", { llmModel: "claude-sonnet-4.6", maxTokens: 200, reasoningEffort: "high" })).toBe(200)
  })

  it("takes the largest value an exposed slider allows over the node's own", () => {
    expect(llmNodeOutputTokenCap("llm-chat", { llmModel: "claude-sonnet-4.6", maxTokens: 200 }, 16384)).toBe(16384)
  })

  it("a model no registry knows has no floor", () => {
    expect(llmNodeOutputTokenCap("llm-chat", { llmModel: "nope", maxTokens: 200 })).toBe(200)
  })
})
