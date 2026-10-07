/**
 * The director reads its word timings from the speech job when the speech
 * model returned them (decided 2026-10-06), and runs the forced-alignment job
 * exactly as before when it did not. The progress stages are a public
 * contract and stay the same either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
const { mockBake } = vi.hoisted(() => ({ mockBake: vi.fn() }))
vi.mock("@/services/shot-sequence/baker.js", () => ({ bakeShotSequence: mockBake }))
import { runVideoDirector, defaultDirectorDeps } from "../orchestrate.js"
import { AUDIO_URL, ALIGNMENT, MOCK_PLAN, MOCK_AUTHORED, BASE_OPTS, buildDeps } from "./orchestrate-fixtures.js"
import { DEFAULT_TTS_PROVIDER } from "@nodaro/shared"

const TRANSCRIPT = { version: 1, words: [{ text: "Ship", startMs: 100, endMs: 400 }] }
const STAGES = ["authoring", "speech", "alignment", "resolve", "render"]

/** waitForJob answering per job id: the speech job's output is `speech`, the others as the fixtures. */
function waitFor(speech: Record<string, unknown>) {
  return vi.fn(async (jobId: string) => {
    if (jobId === "speech-1") return { output: speech }
    if (jobId === "align-1") return { output: { alignment: ALIGNMENT } }
    return { output: { videoUrl: "https://cdn.example.com/result.mp4" } }
  })
}

describe("runVideoDirector — timings from the speech job", () => {
  beforeEach(() => { vi.clearAllMocks(); mockBake.mockReturnValue({ plan: MOCK_PLAN, warnings: [] }) })

  it("a speech output with a transcript: no alignment job; the baker gets the transcript's words in seconds; stages unchanged", async () => {
    const log: string[] = []
    const deps = buildDeps({ onProgress: (s: string) => { log.push(s) }, waitForJob: waitFor({ audioUrl: AUDIO_URL, transcript: TRANSCRIPT }) })
    await runVideoDirector(BASE_OPTS, deps)
    expect(deps.createAlignmentJob).not.toHaveBeenCalled()
    expect(mockBake).toHaveBeenCalledWith(MOCK_AUTHORED.shotSequenceBrief, [{ word: "Ship", start: 0.1, end: 0.4 }], AUDIO_URL)
    expect(log).toEqual(STAGES)
  })

  it.each([
    ["no transcript", { audioUrl: AUDIO_URL }],
    ["a transcript with no words", { audioUrl: AUDIO_URL, transcript: { version: 1, words: [] } }],
    ["garbage", { audioUrl: AUDIO_URL, transcript: "x" }],
  ])("%s on the speech output: the forced-alignment job runs exactly as today", async (_label, speech) => {
    const log: string[] = []
    const deps = buildDeps({ onProgress: (s: string) => { log.push(s) }, waitForJob: waitFor(speech) })
    await runVideoDirector(BASE_OPTS, deps)
    expect(deps.createAlignmentJob).toHaveBeenCalledWith(AUDIO_URL, MOCK_AUTHORED.voScript, BASE_OPTS.userId)
    expect(mockBake).toHaveBeenCalledWith(MOCK_AUTHORED.shotSequenceBrief, ALIGNMENT, AUDIO_URL)
    expect(log).toEqual(STAGES)
  })
})

describe("defaultDirectorDeps().createSpeechJob", () => {
  it("asks the text-to-speech route for timings on the default speech model", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify({ jobId: "tts-1" }) })
    const deps = defaultDirectorDeps({ inject } as never)
    await deps.createSpeechJob("Voice-over line.", "user-1")
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({
      url: "/v1/text-to-speech",
      payload: { text: "Voice-over line.", provider: DEFAULT_TTS_PROVIDER, userId: "user-1", withTimestamps: true },
    }))
  })
})
