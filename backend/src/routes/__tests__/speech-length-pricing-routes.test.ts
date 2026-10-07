/**
 * Seam 1 — the REST routes' credit guards price speech by length while
 * SPEECH_LENGTH_PRICING_ENABLED is on, and pass NO computeCredits while it is
 * off (byte-identical code path: the guard looks the flat row up as today).
 * The flag is read at route registration, so each describe registers its own
 * app under its own flag value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

type GuardCapture = {
  resolver: (req: { body: unknown }) => string
  opts?: { denyResolvedModel?: boolean; computeCredits?: (body: unknown, req: unknown) => number | Promise<number> }
}

const flag = vi.hoisted(() => ({ on: false }))
const guard = vi.hoisted(() => ({
  pending: [] as Array<{ resolver: (req: { body: unknown }) => string; opts?: { denyResolvedModel?: boolean; computeCredits?: (body: unknown, req: unknown) => number | Promise<number> } }>,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", ELEVENLABS_API_KEY: "k" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  speechLengthPricingEnabled: () => flag.on,
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: { body: unknown }) => string, opts?: { denyResolvedModel?: boolean; computeCredits?: (body: unknown, req: unknown) => number | Promise<number> }) => {
    guard.pending.push({ resolver, opts })
    return async () => {}
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "elevenlabs-turbo:per-100-chars" ? 2 : id.endsWith(":per-100-chars") ? 4 : 30,
    isEnabled: true,
    tierRestriction: null,
  })),
}))

import { textToSpeechRoutes, resolveTextToSpeechGuardProvider } from "../text-to-speech.js"
import { textToDialogueRoutes } from "../text-to-dialogue.js"

let app: FastifyInstance

async function registerBoth(on: boolean): Promise<{ tts: GuardCapture; dialogue: GuardCapture }> {
  flag.on = on
  guard.pending.length = 0
  app = Fastify({ logger: false })
  await app.register(async (i) => { await textToSpeechRoutes(i) })
  const tts = guard.pending.pop()!
  await app.register(async (i) => { await textToDialogueRoutes(i) })
  const dialogue = guard.pending.pop()!
  await app.ready()
  return { tts, dialogue }
}

afterEach(async () => { await app?.close() })

describe("flag OFF — the guards are built exactly as today", () => {
  it("passes no computeCredits to either route's guard; the resolver still names the model", async () => {
    const { tts, dialogue } = await registerBoth(false)
    // The only option either guard carries is the surface-deny flag (every speech route has it, flag or no flag).
    expect(tts.opts).toEqual({ denyResolvedModel: true })
    expect(dialogue.opts).toEqual({ denyResolvedModel: true })
    expect(tts.resolver({ body: { text: "hi", provider: "elevenlabs-v3" } })).toBe("elevenlabs-v3")
    expect(tts.resolver({ body: { text: "hi", provider: "elevenlabs" } })).toBe("elevenlabs-turbo")
    expect(dialogue.resolver({ body: {} })).toBe("elevenlabs-dialogue")
  })
})

describe("flag ON — computeCredits prices the body by length, on the model the resolver names", () => {
  let tts: GuardCapture
  let dialogue: GuardCapture
  beforeEach(async () => { ({ tts, dialogue } = await registerBoth(true)) })

  it("keeps the surface-deny flag beside computeCredits", () => {
    expect(tts.opts?.denyResolvedModel).toBe(true)
    expect(dialogue.opts?.denyResolvedModel).toBe(true)
  })

  it.each([
    [{ text: "a".repeat(100), provider: "elevenlabs-v4" }, 32],
    [{ text: "a".repeat(1000), provider: "elevenlabs-v3" }, 40],
    [{ text: "a".repeat(6000), provider: "elevenlabs-v3" }, 200], // the handler clamps to 5,000 — priced as 5,000
    [{ text: "a".repeat(100), provider: "elevenlabs-turbo" }, 16],
    [{ text: "a".repeat(1000), provider: "elevenlabs" }, 20], // alias → turbo's row
    [{ text: "a".repeat(100) }, 32], // omitted → the default model (v4)
    [{ text: "a".repeat(12000) }, 240], // omitted + long → turbo (the length rule), 120 units × 2
    [{ text: "[whispers] " + "a".repeat(100), provider: "elevenlabs-turbo" }, 16], // tag stripped before counting
  ])("text-to-speech %o → %i base credits", async (body, credits) => {
    expect(await tts.opts!.computeCredits!(body, {})).toBe(credits)
  })

  it("prices the model the resolver names — one function for both", () => {
    for (const body of [{ text: "hi", provider: "elevenlabs" }, { text: "hi" }, { text: "a".repeat(12000) }, { text: 5 }]) {
      expect(tts.resolver({ body })).toBe(resolveTextToSpeechGuardProvider(body as Record<string, unknown>))
    }
  })

  it("a hostile text-to-speech body prices the floor of the model the resolver names and never throws (Zod then answers 400, nothing is reserved)", async () => {
    // `{ text: 42 }`: today's resolver reads `42.length` (undefined) → the length rule says turbo → turbo's floor.
    for (const [body, floor] of [[{}, 32], [{ text: 42 }, 16], [{ text: ["a"] }, 32], [{ text: null }, 32]] as const) {
      await expect(tts.opts!.computeCredits!(body, {}), JSON.stringify(body)).resolves.toBe(floor)
    }
  })

  it.each([
    [{ dialogue: [{ text: "a".repeat(100), voice: "Rachel" }] }, 32],
    [{ dialogue: [{ text: "a".repeat(2500), voice: "Rachel" }, { text: "b".repeat(2500), voice: "George" }] }, 200],
    [{ dialogue: "not lines" }, 32],
    [{}, 32],
    [{ provider: "elevenlabs-dialogue-v4", dialogue: [{ text: "a".repeat(100), voice: "Rachel" }] }, 32], // v4 dialogue: its own row, the same floor
    [{ provider: "elevenlabs-dialogue-v4", dialogue: [{ text: "a".repeat(1000), voice: "Rachel" }] }, 40],
  ])("text-to-dialogue %o → %i base credits", async (body, credits) => {
    expect(await dialogue.opts!.computeCredits!(body, {})).toBe(credits)
  })

  it("text-to-dialogue reads the unit row of the model the body names", async () => {
    const { getModelCreditBaseCost } = await import("@/ee/billing/credits.js")
    await dialogue.opts!.computeCredits!({ provider: "elevenlabs-dialogue-v4", dialogue: [{ text: "a", voice: "R" }] }, {})
    expect(getModelCreditBaseCost).toHaveBeenLastCalledWith("elevenlabs-dialogue-v4:per-100-chars")
  })
})
