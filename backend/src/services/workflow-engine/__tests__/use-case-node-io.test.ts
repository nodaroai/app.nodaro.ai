/**
 * A Tighten Episode node's wires on the backend engine: what it reads (the
 * recording on `media`, the bed on `music`, one recording per fan-out row)
 * and what it hands on (its episode as the medium it made, its plan on
 * `json`) — live, from saved data, and rebuilt from its wrapper's row. And
 * what a Chapters node hands on: its show notes on `text`, its chapter list
 * on `json`.
 */
import { describe, it, expect } from "vitest"
import { planFanOut } from "@nodaro/shared/workflow"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, fanOutIterationValue, getPrimaryOutput } from "../output-extractor.js"
import { retainedOutputOfFailedJob } from "../failed-node-output.js"
import { executeJsonProcess } from "../inline-executor.js"
import { usecaseJobOutput } from "../use-case-output.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string | null, targetHandle: string | null): SimpleEdge => ({
  id: `${source}->${target}:${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
})
const done = (output: Record<string, unknown>): NodeExecutionState => ({ status: "completed", output }) as NodeExecutionState

describe("a Tighten Episode's inputs", () => {
  it("the recording on media, the bed on music — never the generic video/audio slots", () => {
    const target = node("t1", "tighten-episode")
    const rec = node("rec", "upload-video", { url: "https://r2/ep.mp4" })
    const bed = node("bed", "upload-audio", { url: "https://r2/bed.mp3" })
    const r = resolveNodeInputs(target, [edge("rec", "t1", "video", "media"), edge("bed", "t1", "audio", "music")], {}, [rec, bed, target])
    expect(r.useCaseMedia).toEqual([{ nodeId: "rec", url: "https://r2/ep.mp4" }])
    expect(r.useCaseMusic).toBe("https://r2/bed.mp3")
    expect(r.videoUrl).toBeUndefined()
    expect(r.audioUrl).toBeUndefined()
  })

  it("an audio recording on media is the recording too", () => {
    const target = node("t1", "tighten-episode")
    const rec = node("rec", "upload-audio", { url: "https://r2/ep.m4a" })
    const r = resolveNodeInputs(target, [edge("rec", "t1", "audio", "media")], {}, [rec, target])
    expect(r.useCaseMedia).toEqual([{ nodeId: "rec", url: "https://r2/ep.m4a" }])
  })

  it("a list of recordings fans out one run per row, each with its own recording", () => {
    const list = node("list1", "list", {
      columns: [{ id: "a", name: "episode", handleId: "col_a", type: "text" }],
      rows: [["https://r2/ep-1.mp4"], ["https://r2/ep-2.mp4"]],
    })
    const target = node("t1", "tighten-episode")
    const edges = [edge("list1", "t1", "col_a", "media")]
    const nodes = [list, target]
    const plan = planFanOut(getListFanOutForNode(target, edges, {}, nodes), target.type, target.data)
    expect(plan?.items).toHaveLength(2)
    const media = plan!.items.map((_, k) => resolveFanOutIterationInputs(target, plan!, k, edges, {}, nodes).useCaseMedia)
    expect(media).toEqual([[{ nodeId: "list1", url: "https://r2/ep-1.mp4" }], [{ nodeId: "list1", url: "https://r2/ep-2.mp4" }]])
  })
})

describe("what a Tighten Episode hands on", () => {
  it("its episode feeds downstream as the medium it made (video or audio); its json as the plan", () => {
    const combine = node("c", "combine-videos")
    const mix = node("m", "mix-audio")
    const extract = node("x", "extract-field")
    const video = { t1: done({ videoUrl: "https://r2/ep.mp4", json: { v: 1 } }) }
    const tv = node("t1", "tighten-episode", { output: "video" })
    expect(resolveNodeInputs(combine, [edge("t1", "c", "media", "in")], video, [tv, combine]).videoUrls).toEqual(["https://r2/ep.mp4"])
    const audio = { t1: done({ audioUrl: "https://r2/ep.m4a" }) }
    const ta = node("t1", "tighten-episode", { output: "audio" })
    expect(resolveNodeInputs(mix, [edge("t1", "m", "media", "in")], audio, [ta, mix]).audioUrls).toEqual(["https://r2/ep.m4a"])
    const json = resolveNodeInputs(extract, [edge("t1", "x", "json", "in")], video, [tv, extract])
    expect(json.videoUrl).toBeUndefined()
    expect(json.prompt).toBe(JSON.stringify({ v: 1 }))
  })

  it("live: json is the plan, any other pip the episode", () => {
    const output = { videoUrl: "https://r2/ep.mp4", json: { v: 1 } }
    expect(getPrimaryOutput(output, "tighten-episode", "json")).toBe(JSON.stringify({ v: 1 }))
    expect(getPrimaryOutput(output, "tighten-episode", "media")).toBe("https://r2/ep.mp4")
    expect(getPrimaryOutput({ audioUrl: "https://r2/ep.m4a" }, "tighten-episode", "media")).toBe("https://r2/ep.m4a")
    expect(getPrimaryOutput({ videoUrl: "https://r2/ep.mp4" }, "tighten-episode", "json")).toBeUndefined()
  })

  it("a fanned-out run keeps each iteration's episode as its row (video or audio take)", () => {
    expect(fanOutIterationValue({ videoUrl: "https://r2/ep-1.mp4", json: { v: 1 } }, "tighten-episode")).toBe("https://r2/ep-1.mp4")
    expect(fanOutIterationValue({ audioUrl: "https://r2/ep-2.m4a", json: { v: 1 } }, "tighten-episode")).toBe("https://r2/ep-2.m4a")
  })

  it("saved: the episode it shows and its plan with the person's review (a stale edit is ignored)", () => {
    const plan = { version: 1, segments: [{ start: 0, end: 10 }], dropped: [] }
    expect(extractSavedNodeOutput(node("t1", "tighten-episode", { generatedVideoUrl: "https://r2/ep.mp4", generatedJson: plan, editedEdl: { stale: true } })))
      .toEqual({ videoUrl: "https://r2/ep.mp4", json: plan })
    expect(extractSavedNodeOutput(node("t1", "tighten-episode", { generatedAudioUrl: "https://r2/ep.m4a" }))).toEqual({ audioUrl: "https://r2/ep.m4a" })
    expect(extractSavedNodeOutput(node("t1", "tighten-episode"))).toBeUndefined()
  })

  it("rebuilt from its wrapper's row: episode, plan, transcript, quality — never the wrapper's bookkeeping", () => {
    const row = { videoUrl: "https://r2/ep.mp4", json: { v: 1 }, plan: { v: 1 }, transcript: { words: [] }, quality: "proxy", _executionId: "exec-in" }
    expect(buildNodeOutputFromJobData(row, "tighten-episode")).toEqual({ videoUrl: "https://r2/ep.mp4", json: { v: 1 }, transcript: { words: [] }, quality: "proxy" })
  })

  it("rebuilt from its wrapper's row: the take's bases and the run's settings ride along", () => {
    const row = { videoUrl: "https://r2/ep.mp4", quality: "proxy", planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb", useCaseSettings: { reviewBeforeRender: true, captions: false }, _executionId: "e" }
    expect(buildNodeOutputFromJobData(row, "tighten-episode")).toMatchObject({
      planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb", useCaseSettings: { reviewBeforeRender: true, captions: false },
    })
    // No take, no take stamps; the run's settings still.
    const none = buildNodeOutputFromJobData({ planBasis: "aaaaaaaaaaaaaaaa", useCaseSettings: { captions: false } }, "tighten-episode")
    expect(none).not.toHaveProperty("planBasis")
    expect(none).toMatchObject({ useCaseSettings: { captions: false } })
  })

  it("a failed wrapper keeps its plan and transcript on the failed node; one that made nothing keeps nothing", () => {
    const failed = { json: { v: 1 }, plan: { v: 1 }, transcript: { words: [] }, quality: "final", _executionId: "exec-in", failedNodeId: "uc-render", failedStep: "Apply Cut" }
    expect(retainedOutputOfFailedJob(failed, "tighten-episode")).toEqual({ json: { v: 1 }, transcript: { words: [] } })
    expect(retainedOutputOfFailedJob({ quality: "final", _executionId: "exec-in", failedNodeId: "uc-transcribe", failedStep: "Transcribe" }, "tighten-episode")).toBeUndefined()
  })
})

describe("what a Chapters node hands on", () => {
  const rows = [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }]
  const notes = "0:00 Intro\n12:34 Main"
  const chapters = node("c1", "episode-chapters")
  const states = { c1: done({ text: notes, json: rows }) }

  it("a Chapters wrapper hands on its text and its chapter list", () => {
    expect(usecaseJobOutput({ text: "0:00 Intro", json: [{ startMs: 0, title: "Intro" }], quality: "final" })).toEqual({ text: "0:00 Intro", json: [{ startMs: 0, title: "Intro" }] })
    expect(buildNodeOutputFromJobData({ text: notes, json: rows, plan: { version: 1, chapters: rows }, quality: "final", _executionId: "e" }, "episode-chapters"))
      .toEqual({ text: notes, json: rows })
  })

  it("live: text is the show notes, json the chapter list", () => {
    expect(getPrimaryOutput({ text: notes, json: rows }, "episode-chapters", "text")).toBe(notes)
    expect(getPrimaryOutput({ text: notes, json: rows }, "episode-chapters", "json")).toBe(JSON.stringify(rows))
  })

  it("its text pip feeds an LLM prompt as text", () => {
    const llm = node("l", "llm-chat")
    const r = resolveNodeInputs(llm, [edge("c1", "l", "text", "prompt")], states, [chapters, llm])
    expect(r.prompt).toBe(notes)
    expect(r.videoUrl).toBeUndefined()
    expect(r.audioUrl).toBeUndefined()
  })

  it("an edge naming no pip reads the show notes, as the editor does", () => {
    expect(getPrimaryOutput({ text: notes, json: rows }, "episode-chapters", null)).toBe(notes)
    expect(getPrimaryOutput({ text: notes, json: rows }, "episode-chapters", undefined)).toBe(notes)
    const llm = node("l", "llm-chat")
    const r = resolveNodeInputs(llm, [edge("c1", "l", null, "prompt")], states, [chapters, llm])
    expect(r.prompt).toBe(notes)
    expect(r.videoUrl).toBeUndefined()
    expect(r.audioUrl).toBeUndefined()
    // Tighten Episode's unnamed pip is still its episode.
    expect(getPrimaryOutput({ videoUrl: "https://r2/ep.mp4", text: "x" }, "tighten-episode", null)).toBe("https://r2/ep.mp4")
  })

  it("its json pip feeds a JSON Process as the chapter list", () => {
    const jp = node("j", "json-process", { mode: "advanced", expression: ".[].title" })
    const out = executeJsonProcess(jp, [edge("c1", "j", "json", "in")], [chapters, jp], states)
    expect(out.listResults).toEqual(["Intro", "Main"])
    const r = resolveNodeInputs(jp, [edge("c1", "j", "json", "in")], states, [chapters, jp])
    expect(r.prompt).toBe(JSON.stringify(rows))
    expect(r.videoUrl).toBeUndefined()
  })

  it("saved: the show notes it shows and its chapter list", () => {
    expect(extractSavedNodeOutput(node("c1", "episode-chapters", { generatedText: notes, generatedJson: rows }))).toMatchObject({ text: notes, json: rows })
    expect(extractSavedNodeOutput(node("c1", "episode-chapters", { generatedText: notes }))).toEqual({ text: notes })
    expect(extractSavedNodeOutput(node("c1", "episode-chapters"))).toBeUndefined()
  })
})

describe("what a Trailer node hands on", () => {
  const trailer = node("tr", "episode-trailer")
  const formats = [{ format: "9:16", url: "https://r2/a.mp4" }, { format: "1:1", url: "https://r2/b.mp4" }]

  it("a Trailer wrapper hands on its deliveries as its list, the first as its media", () => {
    expect(usecaseJobOutput({ formats, videoUrl: "https://r2/a.mp4", quality: "final" })).toMatchObject({
      videoUrl: "https://r2/a.mp4",
      listResults: ["https://r2/a.mp4", "https://r2/b.mp4"],
      listResultStamps: [{ quality: "final" }, { quality: "final" }],
      quality: "final",
    })
    // A review-on run's preview: no deliveries yet, no list.
    expect(usecaseJobOutput({ formats: [], videoUrl: "https://r2/p.mp4", quality: "proxy" })).not.toHaveProperty("listResults")
  })

  it("rebuilt from its wrapper's row: the same list", () => {
    expect(buildNodeOutputFromJobData({ formats, videoUrl: "https://r2/a.mp4", quality: "final", _executionId: "e" }, "episode-trailer")).toMatchObject({
      videoUrl: "https://r2/a.mp4",
      listResults: ["https://r2/a.mp4", "https://r2/b.mp4"],
    })
  })

  it("a node after it, on its media pip, runs once per delivery; its json pip is one value", () => {
    const cap = node("cap", "add-captions")
    const states = { tr: done({ ...usecaseJobOutput({ formats, videoUrl: "https://r2/a.mp4", json: { v: 1 }, quality: "final" }) }) }
    const each = planFanOut(getListFanOutForNode(cap, [edge("tr", "cap", "media", "in")], states, [trailer, cap]), cap.type, cap.data)
    expect(each?.items).toEqual(["https://r2/a.mp4", "https://r2/b.mp4"])
    const extract = node("x", "extract-field")
    expect(planFanOut(getListFanOutForNode(extract, [edge("tr", "x", "json", "in")], states, [trailer, extract]), extract.type, extract.data)).toBeNull()
  })

  it("saved: its last run's deliveries are its own list", () => {
    expect(extractSavedNodeOutput(node("tr", "episode-trailer", { generatedVideoUrl: "https://r2/a.mp4", __listResults: ["https://r2/a.mp4", "https://r2/b.mp4"] })))
      .toEqual({ videoUrl: "https://r2/a.mp4", listResults: ["https://r2/a.mp4", "https://r2/b.mp4"] })
    expect(extractSavedNodeOutput(node("tr", "episode-trailer", { __listResults: ["https://r2/a.mp4"] }))).toEqual({ listResults: ["https://r2/a.mp4"] })
    // A single-result node never reads a saved list as its own.
    expect(extractSavedNodeOutput(node("t1", "tighten-episode", { generatedVideoUrl: "https://r2/ep.mp4", __listResults: ["https://r2/x.mp4"] }))).toEqual({ videoUrl: "https://r2/ep.mp4" })
    expect(extractSavedNodeOutput(node("tr", "episode-trailer"))).toBeUndefined()
  })
})
