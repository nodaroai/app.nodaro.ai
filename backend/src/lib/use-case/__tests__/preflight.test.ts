import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph } from "@nodaro/render-rules"
import { NODARO_CONNECTION_REQUIRED_CODE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "../../nodaro-connection-messages.js"

const m = vi.hoisted(() => ({ credits: false, connected: false, keys: { ELEVENLABS_API_KEY: "", REPLICATE_API_TOKEN: "" }, onCloud: false }))
vi.mock("../../config.js", () => ({ config: m.keys, hasCredits: () => m.credits }))
vi.mock("../../nodaro-connect.js", () => ({ isNodaroConnected: async () => m.connected }))
vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => m.onCloud }))
import { usecasePreflight } from "../preflight.js"

const graph = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } })

beforeEach(() => { m.credits = false; m.connected = false; m.keys.ELEVENLABS_API_KEY = ""; m.keys.REPLICATE_API_TOKEN = ""; m.onCloud = false })

describe("usecasePreflight — refused before any row exists", () => {
  it("the built graph carries a cloud-exclusive step and an ElevenLabs transcribe (what the cases below rely on)", () => {
    expect(graph.nodes.some((n) => n.type === "edit-plan")).toBe(true)
    expect(graph.nodes.find((n) => n.type === "transcribe")?.data.provider).toBe("elevenlabs-stt")
  })
  it("cloud: never asks the connection (the exclusive steps run in-process)", async () => {
    m.credits = true; m.keys.ELEVENLABS_API_KEY = "k"
    expect(await usecasePreflight(graph)).toBeNull()
  })
  it("self-host, unconnected: 503 nodaro_connection_required (Edit Plan is a cloud step)", async () => {
    m.keys.ELEVENLABS_API_KEY = "k"
    expect(await usecasePreflight(graph)).toEqual({
      status: 503,
      code: NODARO_CONNECTION_REQUIRED_CODE,
      message: NODARO_CONNECTION_REQUIRED_MESSAGE,
    })
  })
  it("self-host, connected, with a key: runs", async () => {
    m.connected = true; m.keys.ELEVENLABS_API_KEY = "k"
    expect(await usecasePreflight(graph)).toBeNull()
  })
  it("self-host, connected, no ElevenLabs key, the connection covers transcribe: runs", async () => {
    m.connected = true; m.onCloud = true
    expect(await usecasePreflight(graph)).toBeNull()
  })
  it("self-host, connected, no ElevenLabs key, the connection does not cover it: the keyless refusal", async () => {
    m.connected = true; m.onCloud = false
    expect(await usecasePreflight(graph)).toMatchObject({ status: 503, code: "provider_key_missing" })
  })
  it("a Replicate key does not stand in for the ElevenLabs lane", async () => {
    m.credits = true; m.keys.REPLICATE_API_TOKEN = "r"
    expect(await usecasePreflight(graph)).toMatchObject({ status: 503, code: "provider_key_missing" })
  })
  it("cloud with no ElevenLabs key and no relay: the honest keyless refusal", async () => {
    m.credits = true
    const r = await usecasePreflight(graph)
    expect(r).toMatchObject({ status: 503, code: "provider_key_missing" })
    expect(r!.message).toMatch(/ELEVENLABS_API_KEY/)
  })
})
