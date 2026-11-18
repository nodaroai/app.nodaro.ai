/**
 * Replace Audio's canvas run (replace-audio-execute.ts): the body is the shared
 * one, built from the node's settings and what is wired into it; a node the
 * shared rule refuses fails before any call, in the person's language; the take
 * lands with its speech, music and mix. The request itself: api-replace-audio.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const store = vi.hoisted(() => ({ updates: [] as Array<{ id: string; patch: Record<string, unknown> }> }))
const calls = vi.hoisted(() => ({ replaceAudio: vi.fn(), toastError: vi.fn(), poll: vi.fn() }))

import { REPLACE_AUDIO_MUSIC_PROMPT_MAX } from "@nodaro/render-rules"
import { executeReplaceAudio, replaceAudioProblemMessage } from "../replace-audio-execute"
import type { ExecutionContext } from "../types"
import type { ReplaceAudioRunDeps } from "../replace-audio-execute"
import type { ReplaceAudioNodeData, WorkflowNode } from "@/types/nodes"

const ctx = {} as ExecutionContext

/** The collaborators execute-node.ts hands in: the store write, the poll, the client call, the toast. */
const deps = {
  updateNodeData: (id: string, patch: Record<string, unknown>) => { store.updates.push({ id, patch }) },
  poll: (...a: unknown[]) => calls.poll(...a),
  start: (body: unknown) => calls.replaceAudio(body),
  toastError: (m: string) => calls.toastError(m),
} as unknown as ReplaceAudioRunDeps

function node(over: Partial<ReplaceAudioNodeData> = {}): WorkflowNode {
  const data: ReplaceAudioNodeData = {
    label: "Replace Audio",
    musicSource: "input",
    musicPrompt: "",
    mode: "keep-speech",
    musicVolume: 80,
    speechVolume: 100,
    duckAmount: 70,
    fieldMappings: {},
    ...over,
  }
  return { id: "ra", type: "replace-audio", position: { x: 0, y: 0 }, data } as WorkflowNode
}

beforeEach(() => {
  store.updates = []
  calls.replaceAudio.mockReset().mockResolvedValue({ jobId: "job-1" })
  calls.toastError.mockReset()
  calls.poll.mockReset().mockImplementation(async (_id: string, apiCall: () => Promise<{ jobId: string }>) => {
    await apiCall()
    return "https://cdn/out.mp4"
  })
})

describe("executeReplaceAudio — the request body", () => {
  it("sends the wired video and music with the node's levers, and polls the job", async () => {
    const out = await executeReplaceAudio(
      node({ mode: "keep-speech", musicVolume: 120, speechVolume: 90, duckAmount: 40 }),
      { videoUrl: "https://cdn/in.mp4", musicUrls: ["https://cdn/song.mp3"] }, ctx, deps)
    expect(out).toBe("https://cdn/out.mp4")
    expect(calls.replaceAudio).toHaveBeenCalledTimes(1)
    expect(calls.replaceAudio).toHaveBeenCalledWith({
      videoUrl: "https://cdn/in.mp4",
      musicUrl: "https://cdn/song.mp3",
      mode: "keep-speech",
      musicVolume: 120,
      speechVolume: 90,
      duckAmount: 40,
    })
    const [nodeId, , outputKey, label] = calls.poll.mock.calls[0]!
    expect([nodeId, outputKey, label]).toEqual(["ra", "generatedVideoUrl", "Replace Audio"])
  })

  it("a prompt sends the prompt and no music, clamping the levers", async () => {
    await executeReplaceAudio(
      node({ musicSource: "prompt", musicPrompt: "  lo-fi beat  ", mode: "replace-all", musicVolume: 999 }),
      { videoUrl: "https://cdn/in.mp4" }, ctx, deps)
    expect(calls.replaceAudio).toHaveBeenCalledWith({
      videoUrl: "https://cdn/in.mp4",
      musicPrompt: "lo-fi beat",
      mode: "replace-all",
      musicVolume: 200,
      speechVolume: 100,
      duckAmount: 70,
    })
  })

  it("falls back to the node's own video and music when nothing is wired", async () => {
    await executeReplaceAudio(node({ videoUrl: "https://cdn/own.mp4", musicUrl: "https://cdn/own.mp3" }), {}, ctx, deps)
    expect(calls.replaceAudio).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://cdn/own.mp4", musicUrl: "https://cdn/own.mp3" }))
  })

  it("lands the take's speech, music and mix on the result row", async () => {
    await executeReplaceAudio(node(), { videoUrl: "https://cdn/in.mp4", musicUrls: ["https://cdn/song.mp3"] }, ctx, deps)
    const opts = calls.poll.mock.calls[0]![7] as { resultFields: (od: Record<string, unknown>) => Record<string, unknown> }
    expect(opts.resultFields({
      videoUrl: "https://cdn/out.mp4",
      thumbnailUrl: "https://cdn/out.jpg",
      audioUrl: "https://cdn/mix.m4a",
      speechUrl: "https://cdn/speech.m4a",
      musicUrl: "https://cdn/music.m4a",
      speechKept: true,
    })).toEqual({
      thumbnailUrl: "https://cdn/out.jpg",
      speechUrl: "https://cdn/speech.m4a",
      musicUrl: "https://cdn/music.m4a",
      mixUrl: "https://cdn/mix.m4a",
    })
    // replace-all: no speech track.
    expect(opts.resultFields({ videoUrl: "v", audioUrl: "mix", musicUrl: "music", speechKept: false })).toEqual({ musicUrl: "music", mixUrl: "mix" })
  })
})

describe("executeReplaceAudio — a refused node fails before any call", () => {
  const cases: Array<[string, Partial<ReplaceAudioNodeData>, { videoUrl?: string; musicUrls?: string[] }, RegExp]> = [
    ["no video", {}, { musicUrls: ["https://cdn/song.mp3"] }, /no video/],
    ["no music", {}, { videoUrl: "https://cdn/in.mp4" }, /no music/],
    ["two music sources", {}, { videoUrl: "https://cdn/in.mp4", musicUrls: ["https://a.mp3", "https://b.mp3"] }, /2 music sources are connected/],
    ["a prompt and a wired music", { musicSource: "prompt", musicPrompt: "calm" }, { videoUrl: "https://cdn/in.mp4", musicUrls: ["https://a.mp3"] }, /made from a prompt, but a music source is connected/],
    ["no prompt", { musicSource: "prompt", musicPrompt: "   " }, { videoUrl: "https://cdn/in.mp4" }, /no music prompt/],
    ["a prompt over the limit", { musicSource: "prompt", musicPrompt: "x".repeat(REPLACE_AUDIO_MUSIC_PROMPT_MAX + 5) }, { videoUrl: "https://cdn/in.mp4" }, new RegExp(`${REPLACE_AUDIO_MUSIC_PROMPT_MAX + 5} characters; the longest is ${REPLACE_AUDIO_MUSIC_PROMPT_MAX}`)],
  ]

  it.each(cases)("%s", async (_name, data, wired, message) => {
    await expect(executeReplaceAudio(node(data), wired, ctx, deps)).rejects.toThrow(message)
    expect(calls.replaceAudio).not.toHaveBeenCalled()
    expect(calls.poll).not.toHaveBeenCalled()
    expect(calls.toastError).toHaveBeenCalledWith(expect.stringMatching(message))
    const failed = store.updates.find((u) => u.patch.executionStatus === "failed")
    expect(failed?.id).toBe("ra")
    expect(String(failed?.patch.errorMessage)).toMatch(message)
    expect(String(failed?.patch.errorMessage)).toContain("Replace Audio")
  })

  it("every refusal has its own words", () => {
    const texts = (["no-video", "no-music", "prompt-and-music", "no-prompt"] as const).map((code) => replaceAudioProblemMessage("RA", { code }))
    expect(new Set(texts).size).toBe(texts.length)
    expect(replaceAudioProblemMessage("RA", { code: "many-music", count: 3 })).toContain("3")
  })
})
