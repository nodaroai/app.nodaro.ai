import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// Stub supabase — the 3 creature Studio tools proxy through fastify.inject()
// and never touch the client directly (read tools are deferred, same as
// object). The stub is only here in case a registration codepath touches it.
vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("../../../config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "test-secret" },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

const { registerCreatureTools } = await import("../creatures.js")

const DRAGON_ID = "11111111-1111-4111-8111-111111111111"
const CANDIDATE_JOB_ID = "00000000-0000-0000-0000-000000000099"

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Creature MCP Studio tools — 1:1 mirror of the object Studio surface
 * (`tools/objects.ts`): `approve_creature_main_image`, `recaption_creature`,
 * `generate_creature_motion`. The scope assignments mirror object verbatim:
 *   - assets:write     — approve_creature_main_image, recaption_creature
 *   - workflows:execute — generate_creature_motion
 *
 * Test mechanics mirror `locations.test.ts` (stub the REST route via a real
 * Fastify instance, invoke the tool through the SDK's tools/call handler).
 */

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read"] as Scope[],
    clientName: "Claude",
  })
}

function writeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read", "assets:write"] as Scope[],
    clientName: "Claude",
  })
}

function executeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read", "assets:write", "workflows:execute"] as Scope[],
    clientName: "Claude",
  })
}

// ── approve_creature_main_image ──────────────────────────────────────────────

describe("approve_creature_main_image tool", () => {
  it("proxies to /v1/creatures/:id/approve-main-image with candidate_job_id", async () => {
    const fastify = Fastify()
    const MAIN_URL = "https://r2/creature-main.png"
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/creatures/:id/approve-main-image", async (req) => {
      received = req.body as Record<string, unknown>
      return { sourceImageUrl: MAIN_URL, canonicalDescription: "a scaled green dragon" }
    })

    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_creature_main_image", {
      creature_id: DRAGON_ID,
      candidate_job_id: CANDIDATE_JOB_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.creatureId).toBe(DRAGON_ID)
    expect(result.structuredContent?.sourceImageUrl).toBe(MAIN_URL)
    expect(result.structuredContent?.canonicalDescription).toBe("a scaled green dragon")
    expect(received?.candidateJobId).toBe(CANDIDATE_JOB_ID)
    expect(received?.userId).toBe("u1")
  })

  it("returns an empty caption + retry hint when the route reports a sub-failed caption", async () => {
    const fastify = Fastify()
    fastify.post("/v1/creatures/:id/approve-main-image", async () => {
      // approval route returns 200 with canonicalDescription:"" on LLM sub-failure
      return { sourceImageUrl: "https://r2/c.png", canonicalDescription: "" }
    })

    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_creature_main_image", {
      creature_id: DRAGON_ID,
      candidate_job_id: CANDIDATE_JOB_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.canonicalDescription).toBe("")
    expect(result.content[0]?.text).toContain("recaption_creature")
  })

  it("surfaces the candidate_creature_mismatch IDOR error from the route", async () => {
    const fastify = Fastify()
    fastify.post("/v1/creatures/:id/approve-main-image", async (_req, reply) => {
      return reply
        .status(400)
        .send({ error: { code: "candidate_creature_mismatch", message: "wrong creature" } })
    })

    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "approve_creature_main_image", {
      creature_id: DRAGON_ID,
      candidate_job_id: CANDIDATE_JOB_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("candidate_creature_mismatch")
  })
})

// ── recaption_creature ───────────────────────────────────────────────────────

describe("recaption_creature tool", () => {
  it("proxies to /v1/creatures/:id/llm-caption", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/creatures/:id/llm-caption", async (req) => {
      received = req.body as Record<string, unknown>
      return { canonicalDescription: "fresh creature caption" }
    })

    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_creature", {
      creature_id: DRAGON_ID,
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.creatureId).toBe(DRAGON_ID)
    expect(result.structuredContent?.canonicalDescription).toBe("fresh creature caption")
    expect(received?.userId).toBe("u1")
  })

  it("surfaces 502 LLM failures from the route (caption is FATAL here)", async () => {
    const fastify = Fastify()
    fastify.post("/v1/creatures/:id/llm-caption", async (_req, reply) => {
      return reply
        .status(502)
        .send({ error: { code: "caption_failed", message: "LLM failed" } })
    })

    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify })
    const result = await callTool(server, "recaption_creature", {
      creature_id: DRAGON_ID,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("caption_failed")
  })
})

// ── generate_creature_motion ─────────────────────────────────────────────────

describe("generate_creature_motion tool", () => {
  const MOTION_SOURCE_URL = "https://r2/creatures/dragon-main.png"

  it("proxies to /v1/generate-creature-motion with motion + provider + attach fields", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-creature-motion", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "job-creature-motion-1" }
    })

    const server = buildServer()
    registerCreatureTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_creature_motion", {
      motion_prompt: "slow wing-flap hover",
      source_image_url: MOTION_SOURCE_URL,
      provider: "kling",
      name: "Emerald Dragon",
      category: "mythical",
      style: "realistic",
      canonical_description: "a scaled green dragon with leathery wings",
      attach_to_creature_id: DRAGON_ID,
      attach_name: "wing-flap",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.jobId).toBe("job-creature-motion-1")
    expect(received?.motionPrompt).toBe("slow wing-flap hover")
    expect(received?.sourceImageUrl).toBe(MOTION_SOURCE_URL)
    expect(received?.provider).toBe("kling")
    expect(received?.name).toBe("Emerald Dragon")
    expect(received?.category).toBe("mythical")
    expect(received?.style).toBe("realistic")
    expect(received?.canonicalDescription).toBe(
      "a scaled green dragon with leathery wings",
    )
    // Creature delta: attach column is attachToCreatureId (NOT attachToObjectId).
    expect(received?.attachToCreatureId).toBe(DRAGON_ID)
    expect(received?.attachName).toBe("wing-flap")
    expect(received?.userId).toBe("u1")
    expect(received?.mcp_client).toBe("Claude")
  })

  it("forwards the default provider when none supplied (kling-turbo)", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-creature-motion", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "job-creature-motion-2" }
    })

    const server = buildServer()
    registerCreatureTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_creature_motion", {
      motion_prompt: "idle breathing sway",
      source_image_url: MOTION_SOURCE_URL,
      name: "Wolf",
    })

    expect(result.isError).toBeUndefined()
    // Zod schema defaults `provider` to "kling-turbo" — the tool surface passes
    // the explicit default through so logs reflect the actual model.
    expect(received?.provider).toBe("kling-turbo")
  })

  it("rejects an invalid provider at the Zod boundary", async () => {
    const server = buildServer()
    registerCreatureTools({ server, session: executeSession(), fastify: Fastify() })
    const result = await callTool(server, "generate_creature_motion", {
      motion_prompt: "slow wing-flap hover",
      source_image_url: MOTION_SOURCE_URL,
      provider: "not-a-real-provider",
      name: "Emerald Dragon",
    })
    expect(result.isError).toBe(true)
  })

  it("surfaces 502 / backend errors via errorResult", async () => {
    const fastify = Fastify()
    fastify.post("/v1/generate-creature-motion", async (_req, reply) => {
      return reply
        .status(502)
        .send({ error: { code: "provider_error", message: "kling fail" } })
    })

    const server = buildServer()
    registerCreatureTools({ server, session: executeSession(), fastify })
    const result = await callTool(server, "generate_creature_motion", {
      motion_prompt: "slow wing-flap hover",
      source_image_url: MOTION_SOURCE_URL,
      provider: "kling",
      name: "Emerald Dragon",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("provider_error")
  })
})

// ── scope-gating cross-check (mirrors objects' assets:write + workflows:execute split) ─

describe("scope gating", () => {
  it("read-only session (assets:read) sees NONE of the creature Studio tools", async () => {
    const server = buildServer()
    registerCreatureTools({ server, session: readSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("approve_creature_main_image")).toBe(false)
    expect(names.has("recaption_creature")).toBe(false)
    expect(names.has("generate_creature_motion")).toBe(false)
  })

  it("write session (assets:write) adds approve + recaption but NOT generate_creature_motion", async () => {
    const server = buildServer()
    registerCreatureTools({ server, session: writeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("approve_creature_main_image")).toBe(true)
    expect(names.has("recaption_creature")).toBe(true)
    // workflows:execute is required for motion gen, NOT assets:write.
    expect(names.has("generate_creature_motion")).toBe(false)
  })

  it("execute session adds generate_creature_motion on top of the write tools", async () => {
    const server = buildServer()
    registerCreatureTools({ server, session: executeSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const names = new Set(tools.map((t) => t.name))
    expect(names.has("approve_creature_main_image")).toBe(true)
    expect(names.has("recaption_creature")).toBe(true)
    expect(names.has("generate_creature_motion")).toBe(true)
  })

  // Destructive-tool safety net — delete/restore must NEVER appear, mirroring
  // the object precedent (object exposes no destructive MCP tool either).
  it("destructive tools (delete_creature / restore_creature) are absent under EVERY session", async () => {
    for (const session of [readSession(), writeSession(), executeSession()]) {
      const server = buildServer()
      registerCreatureTools({ server, session, fastify: Fastify() })
      const tools = await listTools(server)
      const names = new Set(tools.map((t) => t.name))
      expect(names.has("delete_creature")).toBe(false)
      expect(names.has("restore_creature")).toBe(false)
    }
  })
})
