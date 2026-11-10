/**
 * speaker_view (POST /v1/speaker-view): an edit, or a whole video with its
 * diarized transcript, rendered with the speakers laid out on screen. Listed
 * beside switch_cameras on an edition with credits, and unlisted while the
 * deployment does not offer the Speaker View node. What the route would refuse
 * on the arguments alone is refused before any request, in the agent's words.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>(), credits: true }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))
vi.mock("../../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.js")>()),
  hasCredits: () => h.credits,
}))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../verbs.js")
const { registerSpeakerViewVerb } = await import("../verbs-speaker-view.js")

beforeEach(() => {
  h.denied = new Set()
  h.credits = true
})

const EDL = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://r2/cam.mp4", kind: "video", role: "master-audio" }],
  segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "cam", audio: "cam" }],
}
const TRANSCRIPT = { words: [{ text: "hi", start: 0, end: 1, speaker: "speaker_0" }, { text: "yo", start: 1, end: 2, speaker: "speaker_1" }] }

function serverWith(fastify?: FastifyInstance) {
  const server = buildServer()
  registerSpeakerViewVerb({ server, session: executeSession(), fastify: fastify ?? (Fastify() as unknown as FastifyInstance) })
  return server
}

describe("speaker_view: the request", () => {
  it("posts an edit with every setting, camelCased, to /v1/speaker-view", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "j-sv" })
    const result = await callTool(serverWith(fastify), "speaker_view", {
      edl: EDL,
      transcript: TRANSCRIPT,
      target_aspect: "9:16",
      layout: "stacked",
      switch: { type: "xfade:fade", duration_ms: 400 },
      emphasis: { style: "border+dim", duration_ms: 200 },
      quality: "proxy",
      speaker_regions: [{ source: "cam", speaker: "speaker_0", region: { x: 0, y: 0, w: 0.5, h: 1 } }],
      accent_color: "#FF8800",
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-sv")
    expect(received.body).toEqual({
      edl: EDL,
      transcript: TRANSCRIPT,
      targetAspect: "9:16",
      layout: "stacked",
      switch: { type: "xfade:fade", durationMs: 400 },
      emphasis: { style: "border+dim", durationMs: 200 },
      quality: "proxy",
      speakerRegions: [{ source: "cam", speaker: "speaker_0", region: { x: 0, y: 0, w: 0.5, h: 1 } }],
      accentColor: "#FF8800",
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it("an edit sent as a JSON string is sent parsed; nothing it was not given is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "j-sv" })
    await callTool(serverWith(fastify), "speaker_view", { edl: JSON.stringify(EDL), switch: { type: "cut" } })
    expect(received.body).toEqual({ edl: EDL, switch: { type: "cut" }, mcp_client: "Claude", userId: "u1" })
  })

  it("a video and its transcript: posts videoUrl, never an edl", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "j-sv" })
    await callTool(serverWith(fastify), "speaker_view", { video_url: "https://r2/talk.mp4", transcript: JSON.stringify(TRANSCRIPT) })
    expect(received.body).toEqual({ videoUrl: "https://r2/talk.mp4", transcript: TRANSCRIPT, mcp_client: "Claude", userId: "u1" })
  })

  it("takes no face tracks", async () => {
    const tool = (await listTools(serverWith())).find((t) => t.name === "speaker_view")
    const keys = Object.keys((tool?.inputSchema as { properties: Record<string, unknown> }).properties)
    expect(keys).not.toContain("tracks")
    expect(keys).not.toContain("motion")
  })
})

describe("speaker_view: refused before any request", () => {
  it.each([
    [{ edl: EDL, video_url: "https://r2/talk.mp4", transcript: TRANSCRIPT }, "pass `edl` or `video_url`, not both."],
    [{ transcript: TRANSCRIPT }, "pass `edl` (one edit"],
    [{ edl: "{not json" }, "`edl` is a string but not valid JSON"],
    [{ video_url: "https://r2/talk.mp4" }, "with `video_url`, pass `transcript`"],
    [{ video_url: "https://r2/talk.mp4", transcript: { words: [{ text: "hi", start: 0, end: 1 }] } }, "the transcript has no speaker labels"],
  ])("%j", async (args, message) => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "speaker_view", args)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain(message)
    expect(received.body).toBeUndefined()
  })

  it.each([
    [{ edl: EDL, switch: { type: "wipe" } }],
    [{ edl: EDL, emphasis: { style: "glow" } }],
    [{ edl: EDL, accent_color: "orange" }],
    [{ edl: EDL, switch: { type: "pan", duration_ms: 6000 } }],
    [{ edl: EDL, speaker_regions: [{ source: "cam", speaker: "speaker_0", region: { x: 0, y: 0, w: 0.001, h: 1 } }] }],
    // The route's region limits: inside the frame, ids of 200 characters at most, 500 crops at most.
    [{ edl: EDL, speaker_regions: [{ source: "cam", speaker: "speaker_0", region: { x: 0.6, y: 0, w: 0.5, h: 1 } }] }],
    [{ edl: EDL, speaker_regions: [{ source: "cam", speaker: "speaker_0", region: { x: 0, y: 0.3, w: 0.5, h: 0.8 } }] }],
    [{ edl: EDL, speaker_regions: [{ source: "c".repeat(201), speaker: "speaker_0", region: { x: 0, y: 0, w: 0.5, h: 1 } }] }],
    [{ edl: EDL, speaker_regions: [{ source: "cam", speaker: "s".repeat(201), region: { x: 0, y: 0, w: 0.5, h: 1 } }] }],
    [{ edl: EDL, speaker_regions: Array.from({ length: 501 }, (_, i) => ({ source: "cam", speaker: `s${i}`, region: { x: 0, y: 0, w: 0.5, h: 1 } })) }],
  ])("a setting the renderer does not draw, or a crop past the route's limits: %#", async (args) => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "speaker_view", args)
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })
})

describe("speaker_view: crops at the route's limits", () => {
  it("a crop touching the frame's edges, 200-character ids and 500 crops are sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-view", { jobId: "j-sv" })
    const regions = Array.from({ length: 500 }, (_, i) => ({ source: "c".repeat(200), speaker: `s${i}`.padEnd(200, "x"), region: { x: 0.5, y: 0.25, w: 0.5, h: 0.75 } }))
    const result = await callTool(serverWith(fastify), "speaker_view", { edl: EDL, speaker_regions: regions })
    expect(result.isError).toBeUndefined()
    expect((received.body?.speakerRegions as unknown[]).length).toBe(500)
  })
})

describe("speaker_view: where it is listed", () => {
  const names = async (session = executeSession()) => {
    const server = buildServer()
    registerVerbs({ server, session, fastify: Fastify() as unknown as FastifyInstance })
    return (await listTools(server)).map((t) => t.name)
  }

  it("beside switch_cameras on an edition with credits", async () => {
    expect(await names()).toEqual(expect.arrayContaining(["speaker_view", "switch_cameras"]))
  })

  it("not on an edition without credits, as switch_cameras", async () => {
    h.credits = false
    const listed = await names()
    expect(listed).not.toContain("speaker_view")
    expect(listed).not.toContain("switch_cameras")
  })

  it("not while the deployment does not offer the Speaker View node; switch_cameras still is", async () => {
    h.denied = new Set(["speaker-view"])
    const listed = await names()
    expect(listed).not.toContain("speaker_view")
    expect(listed).toContain("switch_cameras")
  })

  it("not without workflows:execute", async () => {
    expect(await names(newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" }))).not.toContain("speaker_view")
  })
})
