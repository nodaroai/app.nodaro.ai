import { describe, expect, it } from "vitest"
import { buildReplaceAudioSyncBody, replaceAudioFailure, REPLACE_AUDIO_SYNC_TYPES } from "../replace-audio-sync.js"
import { IDEMPOTENT_SYNC_HTTP_NODES, SYNC_HTTP_NODES, SYNC_HTTP_ROUTES, buildSyncHttpBody } from "../node-executor.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "../types.js"

// A server-run Replace Audio is a client of the Nodaro Cloud plugin's route, like the editor's run:
// the same body (@nodaro/render-rules), posted on the sync-HTTP lane, the job it answers polled.

const node = (data: Record<string, unknown>): SimpleNode => ({ id: "n1", type: "replace-audio", data } as unknown as SimpleNode)
const ctx = { userId: "u1" } as OrchestratorContext
const VIDEO = "https://cdn.example.com/v.mp4"
const MUSIC = "https://cdn.example.com/m.mp3"

describe("Replace Audio on the sync-HTTP lane", () => {
  it("posts to the plugin's route with the run's key", () => {
    expect([...REPLACE_AUDIO_SYNC_TYPES]).toEqual(["replace-audio"])
    expect(SYNC_HTTP_NODES.has("replace-audio")).toBe(true)
    expect(SYNC_HTTP_ROUTES["replace-audio"]).toBe("/v1/replace-audio")
    expect(IDEMPOTENT_SYNC_HTTP_NODES.has("replace-audio")).toBe(true)
  })

  it("sends the wired video and music with the node's levers", () => {
    const inputs: ResolvedInputs = { replaceAudio: { video: VIDEO, music: [MUSIC] } }
    expect(buildSyncHttpBody(node({ mode: "keep-speech", musicSource: "input", musicVolume: 60 }), inputs, ctx)).toEqual({
      videoUrl: VIDEO, musicUrl: MUSIC, mode: "keep-speech", musicVolume: 60, speechVolume: 100, duckAmount: 70, userId: "u1",
    })
  })

  it("sends the prompt when the node makes its music, and the defaults it never set", () => {
    const body = buildReplaceAudioSyncBody(node({ musicSource: "prompt", musicPrompt: " warm piano " }), { replaceAudio: { video: VIDEO, music: [] } }, ctx)
    expect(body).toEqual({ videoUrl: VIDEO, musicPrompt: "warm piano", mode: "keep-speech", musicVolume: 80, speechVolume: 100, duckAmount: 70, userId: "u1" })
  })

  it("falls back to a plain video input and the node's own music link", () => {
    const body = buildReplaceAudioSyncBody(node({ musicUrl: MUSIC, mode: "replace-all" }), { videoUrl: VIDEO }, ctx)
    expect(body).toMatchObject({ videoUrl: VIDEO, musicUrl: MUSIC, mode: "replace-all" })
  })

  it.each([
    ["no video", {}, { replaceAudio: { music: [MUSIC] } }, /Connect a video/],
    ["no music", {}, { replaceAudio: { video: VIDEO, music: [] } }, /Connect the new music/],
    ["two music sources", {}, { replaceAudio: { video: VIDEO, music: [MUSIC, MUSIC] } }, /one music source; 2/],
    ["a prompt with a wired music", { musicSource: "prompt", musicPrompt: "jazz" }, { replaceAudio: { video: VIDEO, music: [MUSIC] } }, /disconnect it/],
    ["an empty prompt", { musicSource: "prompt" }, { replaceAudio: { video: VIDEO, music: [] } }, /Write the music prompt/],
  ])("refuses %s before any call", (_what, data, inputs, message) => {
    expect(() => buildReplaceAudioSyncBody(node(data), inputs as ResolvedInputs, ctx)).toThrow(message)
  })

  it("reads a deployment that does not serve the route honestly, and a refusal as the route said it", () => {
    expect(replaceAudioFailure(404, "{\"message\":\"Route POST:/v1/replace-audio not found\"}")).toBe("Replace Audio runs on Nodaro Cloud: this server does not serve it.")
    expect(replaceAudioFailure(413, JSON.stringify({ error: { code: "media_duration_exceeds_limit", message: "The video is 601 seconds; the longest is 600 seconds." } }))).toBe("The video is 601 seconds; the longest is 600 seconds.")
    expect(replaceAudioFailure(503, JSON.stringify({ error: { code: "replace_audio_unavailable", message: "Replace Audio needs a newer platform version." } }))).toBe("Replace Audio needs a newer platform version.")
    expect(replaceAudioFailure(500, "boom")).toBe("Replace Audio failed (500)")
  })
})
