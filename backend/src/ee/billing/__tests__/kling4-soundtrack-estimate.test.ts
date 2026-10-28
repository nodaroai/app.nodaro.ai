// @test-units-by-name prices the node types it names (upload-audio, upload-video, generate-video)
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The server's workflow estimate prices a Kling 4.0 run whose first audio clip
 * plays as the soundtrack exactly like the same run with a reference video as
 * long as that clip: the audio's length, kept within [2 s, the output].
 */

const probe = vi.hoisted(() => ({ durations: new Map<string, number>() }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 40 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { CreditsService } from "../credits.js"
import { __forgetUploadClipLengths } from "../upload-clip-lengths.js"

const SONG = "https://cdn.example/song.mp3"
const CLIP = "https://cdn.example/clip.mp4"
const video = (data: Record<string, unknown> = {}) => ({ id: "gv", type: "generate-video", data: { provider: "kling-4", duration: 5, resolution: "720p", ...data } })
const audio = { id: "song", type: "upload-audio", data: { url: SONG } }
const clip = { id: "clip", type: "upload-video", data: { url: CLIP } }
const audioWire = [{ source: "song", target: "gv", sourceHandle: "audio", targetHandle: "audioReferences" }]
const videoWire = [{ source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }]
const estimate = (nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>, edges: typeof audioWire) =>
  CreditsService.estimateWorkflowCredits(nodes, edges)

beforeEach(() => {
  __forgetUploadClipLengths()
})

describe("workflow estimate — Kling 4.0 audio soundtrack", () => {
  it("prices a 3.4 s soundtrack as a 3.4 s reference video", async () => {
    probe.durations = new Map([[SONG, 3.4], [CLIP, 3.4]])
    const withSoundtrack = (await estimate([audio, video()], audioWire)) - (await estimate([audio], []))
    const withClip = (await estimate([clip, video()], videoWire)) - (await estimate([clip], []))
    expect(withSoundtrack).toBe(withClip)
    expect(withSoundtrack).not.toBe(await estimate([video()], []))
  })

  it("prices a track longer than the video at the video's length", async () => {
    probe.durations = new Map([[SONG, 14], [CLIP, 5]])
    const withSoundtrack = (await estimate([audio, video()], audioWire)) - (await estimate([audio], []))
    const withClip = (await estimate([clip, video()], videoWire)) - (await estimate([clip], []))
    expect(withSoundtrack).toBe(withClip)
  })

  it("prices voice samples alone, with the soundtrack off, as a run with no reference video", async () => {
    probe.durations = new Map([[SONG, 3.4]])
    const voices = (await estimate([audio, video({ audioSoundtrack: false })], audioWire)) - (await estimate([audio], []))
    expect(voices).toBe(await estimate([video({ audioSoundtrack: false })], []))
  })
})
