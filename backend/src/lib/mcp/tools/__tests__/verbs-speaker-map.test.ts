/**
 * speaker_map (POST /v1/speaker-map) and switch_cameras taking its result.
 * speaker_map is core and keyless, listed beside audio_sync, and unlisted while
 * the deployment does not offer the Speaker Map node to its users.
 * switch_cameras folds a Speaker Map result into its map by the canvas's own
 * rule (cameraSwitchSpeakerMap): a label in speaker_map wins, then the result,
 * then speaker n → camera n.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>() }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
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
const { statedPrices } = await import("../../../../ee/billing/stated-prices.js")

beforeEach(() => {
  h.denied = new Set()
})

const sources = [
  { id: "camA", url: "https://a/camA.m4a", kind: "audio" },
  { id: "camB", url: "https://a/camB.mp4" },
  { id: "wide", url: "https://a/wide.mp4" },
]
const transcript = { words: [{ text: "hi", start: 0, end: 1, speaker: "speaker_0" }, { text: "yo", start: 1, end: 2, speaker: "speaker_1" }] }
const offsets = { reference: "camA", offsets: [{ sourceId: "camB", offsetMs: 120, confidence: 0.9 }], notes: [] }

function serverWith(fastify?: FastifyInstance, session = executeSession()) {
  const server = buildServer()
  registerVerbs({ server, session, fastify: fastify ?? (Fastify() as unknown as FastifyInstance) })
  return server
}

describe("speaker_map", () => {
  it("posts { sources, transcript, offsets, masterSourceId, wideSourceId, marginDb, mcp_client, userId } to /v1/speaker-map", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-map", { jobId: "j-sm" })
    const result = await callTool(serverWith(fastify), "speaker_map", {
      sources,
      transcript,
      offsets,
      master_source_id: "camA",
      wide_source_id: "wide",
      margin_db: 4,
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-sm")
    expect(received.body).toEqual({
      sources,
      transcript,
      offsets,
      masterSourceId: "camA",
      wideSourceId: "wide",
      marginDb: 4,
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it("sends nothing it was not given", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-map", { jobId: "j-sm2" })
    await callTool(serverWith(fastify), "speaker_map", { sources: sources.slice(0, 2), transcript })
    expect(Object.keys(received.body ?? {}).sort()).toEqual(["mcp_client", "sources", "transcript", "userId"])
  })

  it("refuses one source before any request", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/speaker-map", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "speaker_map", { sources: sources.slice(0, 1), transcript })
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("states its charged price", async () => {
    const tool = (await listTools(serverWith())).find((t) => t.name === "speaker_map")
    expect(tool?.description).toContain(`${statedPrices().credits("speaker-map")} cr per run`)
    expect(tool?.description).toMatch(/speaker_map_result/)
  })

  it("is not listed for a caller the node is denied to; audio_sync still is", async () => {
    h.denied = new Set(["speaker-map"])
    const names = (await listTools(serverWith())).map((t) => t.name)
    expect(names).not.toContain("speaker_map")
    expect(names).toContain("audio_sync")
  })

  it("is not listed without workflows:execute", async () => {
    const session = newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" })
    expect((await listTools(serverWith(undefined, session))).map((t) => t.name)).not.toContain("speaker_map")
  })
})

describe("switch_cameras takes a Speaker Map result", () => {
  const edl = {
    version: 1,
    master: "camA",
    sources: [
      { id: "camA", kind: "video", url: "https://a/camA.mp4" },
      { id: "camB", kind: "video", url: "https://a/camB.mp4" },
      { id: "camC", kind: "video", url: "https://a/camC.mp4" },
    ],
    segments: [{ inMs: 0, outMs: 2000, video: "camA", audio: "camA" }],
  }
  const threeSpeakers = { words: [...transcript.words, { text: "ok", start: 2, end: 3, speaker: "speaker_2" }] }
  const result = { version: 1, speakerMap: { speaker_0: "camB", speaker_1: "" }, confidence: {}, notes: [] }

  it("folds the result into speakerMap: speaker_map wins, then the result, then speaker n → camera n", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/camera-switch", { jobId: "j-cs" })
    const out = await callTool(serverWith(fastify), "switch_cameras", {
      edl,
      transcript: threeSpeakers,
      speaker_map: { speaker_1: "camC" },
      speaker_map_result: JSON.stringify(result),
    })
    expect(out.isError).toBeUndefined()
    expect(received.body?.speakerMap).toEqual({ speaker_0: "camB", speaker_1: "camC", speaker_2: "camC" })
    expect(received.body && "speaker_map_result" in received.body).toBe(false)
    expect(received.body && "speakerMapResult" in received.body).toBe(false)
  })

  it("keeps a speaker the result gave no camera on \"\" (the wide shot)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/camera-switch", { jobId: "j-cs2" })
    await callTool(serverWith(fastify), "switch_cameras", { edl, transcript, speaker_map_result: result })
    expect(received.body?.speakerMap).toEqual({ speaker_0: "camB", speaker_1: "" })
  })

  it("without a result, sends speaker_map as given (unchanged)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/camera-switch", { jobId: "j-cs3" })
    await callTool(serverWith(fastify), "switch_cameras", { edl, transcript, speaker_map: { speaker_0: "camB" } })
    expect(received.body?.speakerMap).toEqual({ speaker_0: "camB" })
  })

  it("refuses something that is not a Speaker Map result, before any request", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/camera-switch", { jobId: "never" })
    const out = await callTool(serverWith(fastify), "switch_cameras", { edl, transcript, speaker_map_result: { speakerMap: { speaker_0: "camB" } } })
    expect(out.isError).toBe(true)
    expect(JSON.stringify(out.content)).toMatch(/not a speaker_map result/)
    expect(received.body).toBeUndefined()
  })
})
