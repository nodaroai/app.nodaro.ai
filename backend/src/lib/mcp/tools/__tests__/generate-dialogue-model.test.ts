/**
 * `generate_dialogue` and the dialogue model: v3 dialogue by default, v4 on
 * request; a stability the chosen model does not take, or a script over its
 * total cap, is refused WITH the numbers before the route (nothing reserved);
 * and the tool never states a character figure its own schema forbids.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { DIALOGUE_PROVIDERS, getDialogueCapabilities } from "@nodaro/shared"
import { registerVerbs } from "../verbs.js"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

// The same supabase stand-in preset-apply.test.ts uses (registerVerbs reaches it at import).
vi.mock("../../../supabase.js", () => {
  const chain: Record<string, unknown> = {
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { mcp_preferences: {} }, error: null }),
  }
  return { supabase: { from: () => ({ select: () => chain }) } }
})

beforeEach(() => _resetRegistry())

const LINES = [{ text: "Hi.", voice_id: "Rachel" }, { text: "Hello.", voice_id: "George" }]

async function run(args: Record<string, unknown>) {
  const { fastify, received } = stubRoute("POST", "/v1/text-to-dialogue", { jobId: "j-dlg" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, "generate_dialogue", args)
  return { result, body: received.body }
}

describe("generate_dialogue — the model", () => {
  it("defaults to v3 dialogue", async () => {
    const { result, body } = await run({ dialogue: LINES })
    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("elevenlabs-dialogue")
  })

  it("accepts elevenlabs-dialogue-v4 with a stepless stability and similarity", async () => {
    const { result, body } = await run({ dialogue: LINES, model: "elevenlabs-dialogue-v4", stability: 0.3, similarity_boost: 0.8 })
    expect(result.isError).toBeUndefined()
    expect(body).toEqual(expect.objectContaining({ provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 }))
  })

  it("refuses a stepless stability on v3 dialogue with the steps, before the route", async () => {
    const { result, body } = await run({ dialogue: LINES, stability: 0.3 })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/elevenlabs-dialogue takes stability 0, 0\.5 or 1/)
    expect(body).toBeUndefined()
  })

  it("refuses a script over the chosen model's total cap with the numbers", async () => {
    const long = [{ text: "a".repeat(6000), voice_id: "Rachel" }, { text: "b".repeat(4001), voice_id: "George" }]
    const { result, body } = await run({ dialogue: long, model: "elevenlabs-dialogue-v4" })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/10001 characters in total; elevenlabs-dialogue-v4 takes at most 10000/)
    expect(body).toBeUndefined()
  })

  it("a script over v3 dialogue's cap but inside v4's runs on v4 and is refused on v3, each with its own number", async () => {
    const long = [{ text: "a".repeat(3000), voice_id: "Rachel" }, { text: "b".repeat(2001), voice_id: "George" }]
    const v4 = await run({ dialogue: long, model: "elevenlabs-dialogue-v4" })
    expect(v4.result.isError).toBeUndefined()
    expect(v4.body?.provider).toBe("elevenlabs-dialogue-v4")
    const v3 = await run({ dialogue: long })
    expect(v3.result.isError).toBe(true)
    expect((v3.result.content[0] as { text: string }).text).toMatch(/5001 characters in total; elevenlabs-dialogue takes at most 5000/)
    expect(v3.body).toBeUndefined()
  })

  it("never states a character figure larger than the largest dialogue cap", async () => {
    const server = buildServer()
    const { fastify } = stubRoute("POST", "/v1/text-to-dialogue", { jobId: "x" })
    registerVerbs({ server, session: executeSession(), fastify })
    const tool = (await listTools(server)).find((t) => t.name === "generate_dialogue")!
    const stated = [...JSON.stringify(tool).matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map((m) => Number(m[0].replace(/,/g, "")))
    expect(stated.length).toBeGreaterThan(0)
    const largestCap = Math.max(...DIALOGUE_PROVIDERS.map((id) => getDialogueCapabilities(id).maxChars))
    expect(largestCap).toBe(10000) // Dialogue v4 (measured 2026-10-06)
    expect(stated).toContain(largestCap) // the description names v4's own cap, not only v3's
    for (const n of stated) expect(n).toBeLessThanOrEqual(largestCap)
  })
})
