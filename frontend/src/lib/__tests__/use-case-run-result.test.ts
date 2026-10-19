import { describe, it, expect } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { applyEdlRunCutFields, applyEdlTakeTranscriptField } from "@/lib/apply-edl-cut"
import { runResultIdentity } from "@/lib/run-result-identity"
import { usecaseFailedRunFields } from "@/lib/use-case-run-result"

const PLAN = { version: 1, sources: [{ id: "rec", url: "https://r2/ep.mp4" }], clips: [{ sourceId: "rec", inMs: 0, outMs: 1000 }] }
const NEW_PLAN = { ...PLAN, clips: [{ sourceId: "rec", inMs: 0, outMs: 2000 }] }
const TRANSCRIPT = { words: [{ text: "hi", startMs: 0, endMs: 100 }] }

describe("a Tighten Episode run lands on the node through the lanes' one mapping", () => {
  it("an audio episode clears an earlier video, and the plan and transcript land", () => {
    const fields = applyEdlRunCutFields("tighten-episode", { audioUrl: "https://r2/ep.m4a", json: PLAN, plan: PLAN, transcript: TRANSCRIPT }, { generatedVideoUrl: "https://r2/old.mp4" })
    expect(fields).toEqual({ generatedAudioUrl: "https://r2/ep.m4a", generatedVideoUrl: undefined, generatedJson: PLAN, generatedTranscript: TRANSCRIPT })
  })

  it("a video episode clears an earlier audio one", () => {
    const fields = applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN }, {})
    expect(fields).toMatchObject({ generatedVideoUrl: "https://r2/ep.mp4", generatedAudioUrl: undefined })
    // A run with no transcript clears an earlier run's.
    expect(fields).toHaveProperty("generatedTranscript", undefined)
  })

  it("keeps the person's edit made on this very plan, drops one made on an older plan", () => {
    const edit = { v: 1, kind: "edl", basis: editPlanBasis(PLAN) }
    const same = applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN }, { editedEdl: edit })!
    expect(same).not.toHaveProperty("editedEdl")
    const changed = applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: NEW_PLAN }, { editedEdl: edit })!
    expect(changed).toHaveProperty("editedEdl", undefined)
    expect(changed.generatedJson).toEqual(NEW_PLAN)
  })

  it("a run that reports only its plan still lands it (no medium written)", () => {
    expect(applyEdlRunCutFields("tighten-episode", { json: PLAN }, {})).toEqual({ generatedJson: PLAN, generatedTranscript: undefined })
  })

  it("the take keeps its plan and transcript; another take keeps none", () => {
    const output = { videoUrl: "https://r2/ep.mp4", json: PLAN, transcript: TRANSCRIPT }
    expect(applyEdlTakeTranscriptField("tighten-episode", output, "https://r2/ep.mp4")).toEqual({ generatedJson: PLAN, generatedTranscript: TRANSCRIPT })
    expect(applyEdlTakeTranscriptField("tighten-episode", output, "https://r2/other.mp4")).toBeUndefined()
  })

  it("a review-on run's take is stamped as the preview it is", () => {
    expect(runResultIdentity("tighten-episode", { videoUrl: "https://r2/p.mp4", quality: "proxy" })).toEqual({ quality: "proxy" })
    expect(runResultIdentity("tighten-episode", { videoUrl: "https://r2/p.mp4" })).toEqual({})
  })
})

describe("a server run of a Tighten Episode keeps its wrapper on the node, as the canvas's own run does", () => {
  it("a lane that lands a finished run writes the wrapper it names", () => {
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/p.mp4", json: PLAN, quality: "proxy" } as never, {}, "job-9")).toMatchObject({
      generatedVideoUrl: "https://r2/p.mp4", useCaseJobId: "job-9",
    })
    // No job named: nothing written for it (an earlier wrapper is not cleared).
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/p.mp4" }, {})).not.toHaveProperty("useCaseJobId")
    // Any other node: never.
    expect(applyEdlRunCutFields("apply-edl", { videoUrl: "https://r2/p.mp4" }, {}, "job-9") ?? {}).not.toHaveProperty("useCaseJobId")
  })

  it("a lane that lands a failed run keeps what it finished and its wrapper, for Continue", () => {
    expect(usecaseFailedRunFields("tighten-episode", { json: PLAN, transcript: TRANSCRIPT }, {}, "job-3")).toEqual({
      generatedJson: PLAN, generatedTranscript: TRANSCRIPT, useCaseJobId: "job-3", errorCode: undefined,
    })
    expect(usecaseFailedRunFields("tighten-episode", undefined, {}, "job-3")).toEqual({ useCaseJobId: "job-3", errorCode: undefined })
    expect(usecaseFailedRunFields("apply-edl", { json: PLAN }, {}, "job-3")).toBeUndefined()
  })

  it("a failure that names no wrapper (refused before its run started) clears an earlier run's job: nothing to continue", () => {
    for (const jobId of [undefined, null, ""]) {
      const fields = usecaseFailedRunFields("tighten-episode", undefined, { useCaseJobId: "job-old" }, jobId, "media_unreadable")!
      expect(Object.hasOwn(fields, "useCaseJobId"), String(jobId)).toBe(true)
      expect(fields.useCaseJobId).toBeUndefined()
    }
  })
})

describe("a refused Render final lands as a failure naming the final", () => {
  const F = "00000000-0000-4000-8000-00000000000f"
  it("the code rides along, and the named final's take is put on show", () => {
    const data = { generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "x" }, { url: "https://r2/f.mp4", quality: "final", jobId: F }], activeResultIndex: 0 }
    expect(usecaseFailedRunFields("tighten-episode", { useCaseFinalJobId: F }, data, undefined, "render_final_already_rendered")).toEqual({
      activeResultIndex: 1, generatedVideoUrl: "https://r2/f.mp4", generatedAudioUrl: undefined, errorCode: "render_final_already_rendered",
    })
  })
  it("a final the node does not hold leaves the take; a failure with no code clears an earlier one", () => {
    expect(usecaseFailedRunFields("tighten-episode", { useCaseFinalJobId: "y" }, { generatedResults: [] }, undefined, "already_running")).toEqual({ errorCode: "already_running" })
    expect(usecaseFailedRunFields("tighten-episode", undefined, {}, "job-3")).toEqual({ useCaseJobId: "job-3", errorCode: undefined })
  })
})

describe("a Chapters run (a text result) lands on the node through the same mapping, in every lane", () => {
  const NOTES = "0:00 Intro\n12:34 Main"
  const ROWS = [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }]
  const JOB = "00000000-0000-4000-8000-0000000000c1"

  it("the show notes on generatedText, the chapter list on generatedJson (no review rule), the transcript and the wrapper", () => {
    const fields = applyEdlRunCutFields("episode-chapters", { text: NOTES, json: ROWS, transcript: TRANSCRIPT }, { editedEdl: { basis: "x" } }, JOB)
    expect(fields).toEqual({ generatedText: NOTES, generatedJson: ROWS, generatedTranscript: TRANSCRIPT, useCaseJobId: JOB })
  })

  it("never an episode, even when an output carries a URL", () => {
    const fields = applyEdlRunCutFields("episode-chapters", { text: NOTES, json: ROWS, videoUrl: "https://r2/x.mp4" }, {})
    expect(fields).not.toHaveProperty("generatedVideoUrl")
    expect(fields).not.toHaveProperty("generatedAudioUrl")
  })

  it("a list that is not rows is not landed as one; a run with no text clears an earlier run's", () => {
    expect(applyEdlRunCutFields("episode-chapters", { json: { version: 1, chapters: ROWS }, transcript: TRANSCRIPT }, {})).toEqual({ generatedText: undefined, generatedJson: undefined, generatedTranscript: TRANSCRIPT })
  })

  it("a run that reports nothing writes nothing", () => {
    expect(applyEdlRunCutFields("episode-chapters", {}, {})).toEqual({})
  })

  it("a failed run keeps its transcript and its wrapper for Continue", () => {
    expect(usecaseFailedRunFields("episode-chapters", { transcript: TRANSCRIPT }, {}, JOB)).toEqual({
      generatedText: undefined, generatedJson: undefined, generatedTranscript: TRANSCRIPT, useCaseJobId: JOB, errorCode: undefined,
    })
  })

  it("a take never keeps a Chapters run (it has no takes)", () => {
    expect(applyEdlTakeTranscriptField("episode-chapters", { text: NOTES, json: ROWS }, "https://r2/x.mp4")).toBeUndefined()
  })
})

describe("a multicam run's cameras report lands on the node (useCaseCameras), in every lane", () => {
  const REPORT = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 2, marginDb: 7.5 }], syncNotes: [], mapNotes: [] }
  it("the wrapper job's `cameras` (the canvas run, a reopen, a reconcile)", () => {
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN, cameras: REPORT }, {})).toMatchObject({ useCaseCameras: REPORT })
  })
  it("the server engine's node output `useCaseCameras` (a server run's node state)", () => {
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN, useCaseCameras: REPORT }, {})).toMatchObject({ useCaseCameras: REPORT })
  })
  it("a later episode with no report clears an earlier one; a node that holds none gets no key at all", () => {
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN }, { useCaseCameras: REPORT })).toHaveProperty("useCaseCameras", undefined)
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN }, {})).not.toHaveProperty("useCaseCameras")
  })
  it("a report of another shape is not landed", () => {
    expect(applyEdlRunCutFields("tighten-episode", { videoUrl: "https://r2/ep.mp4", json: PLAN, cameras: { speakers: "x" } }, {})).not.toHaveProperty("useCaseCameras")
  })
  it("a failed run that got as far as its cameras keeps their report", () => {
    expect(usecaseFailedRunFields("tighten-episode", { cameras: REPORT }, {}, "job-1")).toMatchObject({ useCaseCameras: REPORT })
  })
})
