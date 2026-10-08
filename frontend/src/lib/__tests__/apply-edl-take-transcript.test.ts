/**
 * A picked Apply EDL take's Transcript, read back from the job that rendered it
 * (decided 2026-10-04).
 *
 * The pick clears the node's Transcript output when the take kept none of its
 * own; this module then fills it from the take's job, and only when:
 *   - the take's id is a real job id (never a synthetic `iter-…` / `exec-…`);
 *   - the job's output is the take's own file (the server-run lane can pair a
 *     fan-out take with a sibling's job id);
 *   - the node still selects that take, with its Transcript output still
 *     cleared, when the job answers.
 */
import { describe, it, expect, vi } from "vitest"
import {
  readableTakeJobId,
  restorePickedTakeTranscript,
  takeKeptTranscript,
  takeTranscriptFromJob,
  type ApplyEdlTake,
  type TakeTranscriptDeps,
} from "../apply-edl-take-transcript"

const JOB_1 = "7c1e2f4a-5b6d-4e8f-9a0b-1c2d3e4f5a6b"
const JOB_2 = "2b9d4c6e-8f1a-4b3c-8d5e-6f7a8b9c0d1e"
const URL_1 = "https://media.test/apply-cut-take-1.mp4"
const URL_2 = "https://media.test/apply-cut-take-2.mp4"
const TRANSCRIPT_1 = { version: 1, words: [{ text: "back", startMs: 1310, endMs: 1650 }] }
const TRANSCRIPT_2 = { version: 1, words: [{ text: "back", startMs: 420, endMs: 760 }] }

const TAKE_1: ApplyEdlTake = { url: URL_1, jobId: JOB_1 }
const TAKE_2: ApplyEdlTake = { url: URL_2, jobId: JOB_2 }

/** The node right after the person picked take 1: selected, Transcript cleared. */
const picked = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  output: "video",
  generatedResults: [TAKE_2, TAKE_1],
  activeResultIndex: 1,
  generatedVideoUrl: URL_1,
  ...overrides,
})

function harness(nodeData: Record<string, unknown> | undefined, job: () => Promise<Record<string, unknown> | null | undefined>) {
  const fetchJobOutput = vi.fn(job)
  const updateNodeData = vi.fn()
  const deps: TakeTranscriptDeps = { fetchJobOutput, nodeData: () => nodeData, updateNodeData }
  return { deps, fetchJobOutput, updateNodeData }
}

describe("restorePickedTakeTranscript", () => {
  it("reads the take's own Transcript from its job and makes it the node's Transcript output", async () => {
    const h = harness(picked(), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(true)
    expect(h.fetchJobOutput).toHaveBeenCalledOnce()
    expect(h.fetchJobOutput).toHaveBeenCalledWith(JOB_1)
    expect(h.updateNodeData).toHaveBeenCalledOnce()
    expect(h.updateNodeData).toHaveBeenCalledWith("apply-cut", { generatedJson: TRANSCRIPT_1 })
  })

  it("an audio take: the job's audio output must be the take's file", async () => {
    const take: ApplyEdlTake = { url: "https://media.test/apply-cut-take-1.m4a", jobId: JOB_1 }
    const data = picked({ output: "audio", generatedResults: [TAKE_2, take], generatedVideoUrl: undefined, generatedAudioUrl: take.url })
    const h = harness(data, async () => ({ audioUrl: take.url, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", take, h.deps)).resolves.toBe(true)
    expect(h.updateNodeData).toHaveBeenCalledWith("apply-cut", { generatedJson: TRANSCRIPT_1 })
  })

  it("never reads a job for an id that is not a real job's (the fan-out and fallback lanes stamp synthetic ones)", async () => {
    for (const jobId of ["iter-run-7-1", "exec-apply-cut", "exec-apply-cut-1", "", undefined]) {
      const take: ApplyEdlTake = { url: URL_1, jobId }
      const h = harness(picked({ generatedResults: [TAKE_2, take] }), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
      await expect(restorePickedTakeTranscript("apply-cut", take, h.deps)).resolves.toBe(false)
      expect(h.fetchJobOutput).not.toHaveBeenCalled()
      expect(h.updateNodeData).not.toHaveBeenCalled()
    }
  })

  it("never reads a job for a take that kept its own Transcript (the pick restored it)", async () => {
    const take: ApplyEdlTake = { url: URL_1, jobId: JOB_1, generatedJson: TRANSCRIPT_1 }
    const h = harness(picked({ generatedJson: TRANSCRIPT_1 }), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", take, h.deps)).resolves.toBe(false)
    expect(h.fetchJobOutput).not.toHaveBeenCalled()
  })

  it("a job whose output is another file (a sibling's job, paired by position) leaves the Transcript output cleared", async () => {
    const h = harness(picked(), async () => ({ videoUrl: URL_2, json: TRANSCRIPT_2 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.fetchJobOutput).toHaveBeenCalledOnce()
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })

  it("a take cut with no transcript wired has none: the Transcript output stays cleared", async () => {
    const h = harness(picked(), async () => ({ videoUrl: URL_1, thumbnailUrl: "https://media.test/t.jpg" }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })

  it("a job that cannot be read (not found, offline) leaves it cleared, and never throws", async () => {
    const h = harness(picked(), async () => {
      throw new Error("Job not found")
    })
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
    const empty = harness(picked(), async () => null)
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, empty.deps)).resolves.toBe(false)
  })

  it("the person picked another take before the job answered: no write", async () => {
    const h = harness(picked({ activeResultIndex: 0, generatedVideoUrl: URL_2 }), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })

  it("a run landed a new take before the job answered: no write", async () => {
    const landed = { url: "https://media.test/apply-cut-take-3.mp4", jobId: "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a" }
    const h = harness(picked({ generatedResults: [landed, TAKE_2, TAKE_1], activeResultIndex: 0 }), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })

  it("something wrote a Transcript since the pick cleared it: never overwritten", async () => {
    const h = harness(picked({ generatedJson: TRANSCRIPT_2 }), async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })

  it("the node is gone: no write", async () => {
    const h = harness(undefined, async () => ({ videoUrl: URL_1, json: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("apply-cut", TAKE_1, h.deps)).resolves.toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })
})

describe("the rules the pick and the read share", () => {
  it("takeKeptTranscript: a take that carries a Transcript of its own, even an empty one", () => {
    expect(takeKeptTranscript({ url: URL_1, jobId: JOB_1, generatedJson: TRANSCRIPT_1 })).toBe(true)
    expect(takeKeptTranscript({ url: URL_1, jobId: JOB_1 })).toBe(false)
  })

  it("readableTakeJobId: real job ids only", () => {
    expect(readableTakeJobId(TAKE_1)).toBe(JOB_1)
    expect(readableTakeJobId({ url: URL_1, jobId: "iter-run-7-1" })).toBeUndefined()
    expect(readableTakeJobId({ url: URL_1, jobId: "exec-apply-cut" })).toBeUndefined()
    expect(readableTakeJobId({ url: URL_1 })).toBeUndefined()
  })

  it("takeTranscriptFromJob: the job's Transcript only when its output is the take's file", () => {
    expect(takeTranscriptFromJob(TAKE_1, { videoUrl: URL_1, json: TRANSCRIPT_1 })).toEqual(TRANSCRIPT_1)
    expect(takeTranscriptFromJob(TAKE_1, { videoUrl: URL_2, json: TRANSCRIPT_2 })).toBeUndefined()
    expect(takeTranscriptFromJob(TAKE_1, { json: TRANSCRIPT_1 })).toBeUndefined()
    expect(takeTranscriptFromJob(TAKE_1, { videoUrl: URL_1, json: null })).toBeUndefined()
    expect(takeTranscriptFromJob(TAKE_1, null)).toBeUndefined()
  })
})

describe("Speaker View — a picked take's EDL and transcript, read back per field (decided 2026-10-08)", () => {
  const DRAWN = { version: 1, clock: "master", sources: [], segments: [] }

  it("fills both outputs a take kept neither of, from one read of its own job", async () => {
    const h = harness(picked(), async () => ({ videoUrl: URL_1, json: DRAWN, transcript: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("sv", TAKE_1, h.deps, "speaker-view")).resolves.toBe(true)
    expect(h.fetchJobOutput).toHaveBeenCalledOnce()
    expect(h.updateNodeData).toHaveBeenCalledWith("sv", { generatedJson: DRAWN, generatedTranscript: TRANSCRIPT_1 })
  })

  it("a take that kept its EDL but no transcript (landed before the output existed) reads only the transcript", async () => {
    const take: ApplyEdlTake = { ...TAKE_1, generatedJson: DRAWN }
    const h = harness(picked({ generatedJson: DRAWN }), async () => ({ videoUrl: URL_1, json: { other: true }, transcript: TRANSCRIPT_1 }))
    await expect(restorePickedTakeTranscript("sv", take, h.deps, "speaker-view")).resolves.toBe(true)
    expect(h.updateNodeData).toHaveBeenCalledWith("sv", { generatedTranscript: TRANSCRIPT_1 })
  })

  it("a take that kept both reads nothing; a job from an older plugin (no transcript) leaves the transcript cleared", async () => {
    const kept = harness(picked(), async () => ({}))
    await expect(restorePickedTakeTranscript("sv", { ...TAKE_1, generatedJson: DRAWN, generatedTranscript: undefined }, kept.deps, "speaker-view")).resolves.toBe(false)
    expect(kept.fetchJobOutput).not.toHaveBeenCalled()
    const old = harness(picked({ generatedJson: DRAWN }), async () => ({ videoUrl: URL_1, json: DRAWN }))
    await expect(restorePickedTakeTranscript("sv", { ...TAKE_1, generatedJson: DRAWN }, old.deps, "speaker-view")).resolves.toBe(false)
    expect(old.updateNodeData).not.toHaveBeenCalled()
  })

  it("takeKeptTranscript / takeTranscriptFromJob read the field they are asked for", () => {
    expect(takeKeptTranscript({ url: URL_1, generatedTranscript: undefined }, "generatedTranscript")).toBe(true)
    expect(takeKeptTranscript({ url: URL_1, generatedJson: DRAWN }, "generatedTranscript")).toBe(false)
    expect(takeTranscriptFromJob(TAKE_1, { videoUrl: URL_1, json: DRAWN, transcript: TRANSCRIPT_1 }, "transcript")).toEqual(TRANSCRIPT_1)
  })
})
