/**
 * Every Text to Dialogue run reserves on its dialogue model's own row (the
 * route's guard and the payload builder both call dialogueProviderOf). The
 * estimate priced a provider-less node at the node-type row instead
 * ("text-to-dialogue", 40 at the time) — what published apps advertised.
 */
import { describe, it, expect } from "vitest"
import { DEFAULT_DIALOGUE_PROVIDER } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

const quote = (data: Record<string, unknown>) =>
  CreditsService.estimateWorkflowBaseCredits([{ id: "d", type: "text-to-dialogue", data }], [])

describe("workflow estimate — Text to Dialogue", () => {
  it.each([undefined, "nope", "elevenlabs-v4", "constructor"])("a node on %j is quoted at v3 dialogue's row", (provider) => {
    expect(quote({ provider })).toBe(STATIC_CREDIT_COSTS[DEFAULT_DIALOGUE_PROVIDER])
  })

  it("an explicit v3 dialogue node is quoted at its row", () => {
    expect(quote({ provider: "elevenlabs-dialogue" })).toBe(STATIC_CREDIT_COSTS["elevenlabs-dialogue"])
  })

  it("the node-type row is the default model's figure by design, so a fallback could not be told apart by value", () => {
    // Decided 2026-10-06: the node-type fallback equals the default dialogue
    // model's flat row (it said 40 before). The cases above pin WHICH row the
    // estimate reads — a provider-less node quotes the default model's row.
    expect(STATIC_CREDIT_COSTS["text-to-dialogue"]).toBe(STATIC_CREDIT_COSTS[DEFAULT_DIALOGUE_PROVIDER])
  })
})
