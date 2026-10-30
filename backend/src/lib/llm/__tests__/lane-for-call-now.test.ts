// laneForCallNow (lib/llm/router.ts) names the provider a call made now is
// served by. This drives it and BOTH router entry points over the key and
// direct-account latch matrix with stub lanes (each refuses at once when its
// key is unset, as the real one does), and holds them to the same answer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLlmModel } from "@nodaro/shared/llm-models"
import type { LlmRequest, LlmResponse } from "../types.js"

const cfg = vi.hoisted(() => ({
  KIE_API_KEY: "" as string | undefined,
  ANTHROPIC_API_KEY: "" as string | undefined,
  GEMINI_API_KEY: "" as string | undefined,
  NODE_ENV: "test",
}))
vi.mock("../../config.js", () => ({ config: cfg, hasCredits: () => false }))
vi.mock("../../nodaro-connect.js", () => ({ isNodaroConnected: async () => false }))

function served(lane: string, key: keyof typeof cfg): Promise<LlmResponse> {
  if (!cfg[key]) return Promise.reject(new Error(`${lane}: no key`))
  return Promise.resolve({ text: lane, usage: { inputTokens: 1, outputTokens: 1 } } as unknown as LlmResponse)
}
vi.mock("../kie-lane.js", async (orig) => ({
  ...(await orig<typeof import("../kie-lane.js")>()),
  callKie: () => served("kie", "KIE_API_KEY"),
  streamKie: () => served("kie", "KIE_API_KEY"),
}))
vi.mock("../anthropic-lane.js", async (orig) => ({
  ...(await orig<typeof import("../anthropic-lane.js")>()),
  callAnthropicDirect: () => served("anthropic", "ANTHROPIC_API_KEY"),
  streamAnthropicDirect: () => served("anthropic", "ANTHROPIC_API_KEY"),
}))
vi.mock("../../gemini/client.js", async (orig) => ({
  ...(await orig<typeof import("../../gemini/client.js")>()),
  callGeminiDirect: () => served("google", "GEMINI_API_KEY"),
  streamGeminiDirect: () => served("google", "GEMINI_API_KEY"),
}))

const { laneForCallNow, llmComplete, llmStream } = await import("../router.js")
const { latchDirectLaneExhausted, __resetPlatformExhaustionAlerts } = await import("../../llm-platform-exhaustion.js")

const MODELS = ["claude-opus-5.5", "gemini-3.6-flash", "gemini-4-argon", "gpt-5.5"] as const
const REQUESTS: Record<string, Partial<LlmRequest>> = {
  plain: {},
  effort: { reasoningEffort: "high" },
  "pin direct": { requireLane: "direct" },
  "pin kie": { requireLane: "kie" },
  "advanced pin": { requireLane: "direct", advancedMode: true },
}

interface Case { name: string; keys: [boolean, boolean, boolean]; latched: Array<"anthropic" | "google">; modelId: string; extra: Partial<LlmRequest> }
const cases: Case[] = []
for (const modelId of MODELS) {
  for (const [reqName, extra] of Object.entries(REQUESTS)) {
    for (let mask = 0; mask < 8; mask++) {
      const keys: [boolean, boolean, boolean] = [Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)]
      for (const latched of [[], ["anthropic"], ["google"]] as Array<Array<"anthropic" | "google">>) {
        cases.push({
          name: `${modelId} ${reqName} kie=${keys[0]} anthropic=${keys[1]} gemini=${keys[2]} latched=${latched.join(",") || "-"}`,
          keys, latched, modelId, extra,
        })
      }
    }
  }
}

async function outcome(run: () => Promise<LlmResponse>): Promise<string | null> {
  try {
    return (await run()).text
  } catch {
    return null
  }
}

describe("laneForCallNow agrees with the router", () => {
  beforeEach(() => {
    __resetPlatformExhaustionAlerts()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(cases)("$name", async ({ keys, latched, modelId, extra }) => {
    cfg.KIE_API_KEY = keys[0] ? "kie-key" : ""
    cfg.ANTHROPIC_API_KEY = keys[1] ? "anthropic-key" : ""
    cfg.GEMINI_API_KEY = keys[2] ? "gemini-key" : ""
    for (const provider of latched) latchDirectLaneExhausted({ provider, kind: "billing", detail: "test" })
    const req = { modelId, system: "", messages: [{ role: "user" as const, content: "hi" }], ...extra } as LlmRequest
    const model = getLlmModel(modelId)!

    const predicted = laneForCallNow(model, req)
    expect(await outcome(() => llmComplete(req))).toBe(predicted)
    expect(await outcome(() => llmStream(req, () => {}))).toBe(predicted)
  })

  it("a Gemini preferring its direct lane is served by Google", () => {
    cfg.KIE_API_KEY = "kie-key"
    cfg.GEMINI_API_KEY = "gemini-key"
    const gemini = { ...getLlmModel("gemini-3.6-flash")!, preferDirect: true as const }
    expect(laneForCallNow(gemini, { modelId: gemini.id, system: "", messages: [] } as LlmRequest)).toBe("google")
  })
})
