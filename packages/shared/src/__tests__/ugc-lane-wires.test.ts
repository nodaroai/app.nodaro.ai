/**
 * The UGC wires of a video whose clips are cut from one recorded speech: UGC Clips' prelude, the
 * script's language, the Script (sized) output that carries the finish call, and UGC Finish. The
 * URLs and texts are placeholders; nothing here reads what a call says.
 */
import { describe, expect, it } from "vitest"
import {
  FAN_IN_TARGETS,
  UGC_FINISH_CLIPS_TYPE,
  UGC_NODE_MESSAGES,
  UGC_NODE_TYPES,
  UGC_OVERRIDABLE_FIELDS,
  UGC_PRELUDE_ROUTES,
  UGC_PRIMARY_HANDLE,
  VIDEO_PRODUCER_TYPES,
  defaultEdgeOutputMode,
  getInputFieldExtraKeys,
  isFanInEdge,
  isFanInNodeType,
  ugcClipsOutputs,
  ugcClipsPhase,
  ugcClipsPhase2Body,
  ugcFinishOutputs,
  ugcFinishPlan,
  ugcFinishWired,
  ugcLaneNeedsFinish,
  ugcPrelude,
  ugcPreludeOutput,
  ugcScriptBody,
} from "../index.js"

const PHASE1 = {
  errors: [],
  lane: "segmented-reference",
  phase: 1,
  speech: { tool: "generate_speech", args: { text: "one two three", model: "speech-model", language_code: "xx", voice_id: "voice-1", voice_type: "library" } },
  align: { tool: "forced_alignment", args: { transcript: "one two three" } },
  split: { tool: "ugc_split_speech", args: { plan: { v: 1, hook: "one" } } },
}
const SEGMENTS = [{ index: 1, text: "one two" }, { index: 2, text: "three" }]
const PHASE2 = {
  errors: [],
  phase: 2,
  tickets: [{ v: 1, index: 0, durationSec: 7 }, { v: 1, index: 1, durationSec: 7 }],
  sizedPlan: { hook: "one", clipBreaks: [], clipDurations: [14] },
  transcript: "one two three",
  hasCards: false,
  speechCheckCall: { tool: "transcribe", args: { language: "xx" } },
  finish: { tool: "ugc_finish_clips", args: { segments: SEGMENTS } },
}

describe("the script's language", () => {
  it("the node's choice goes to the script route; none, or one this app does not know, is English", () => {
    const body = (language: unknown) => (ugcScriptBody({ site: "Acme", screenshots: [], language }) as { body: Record<string, unknown> }).body.language
    expect(body("he")).toBe("he")
    expect(body("en")).toBe("en")
    expect(body(undefined)).toBe("en")
    expect(body("fr")).toBe("en")
  })
  it("is an overridable field and an extra app-input key, together", () => {
    expect(UGC_OVERRIDABLE_FIELDS["ugc-script"]).toContain("language")
    expect(getInputFieldExtraKeys("ugc-script")).toEqual([{ key: "language", type: "select" }])
  })
})

describe("UGC Clips' prelude", () => {
  it("reads an answer's phase: 1 runs the prelude, 2 the clips, none is one call", () => {
    expect(ugcClipsPhase(PHASE1)).toBe(1)
    expect(ugcClipsPhase(PHASE2)).toBe(2)
    expect(ugcClipsPhase({ tickets: [] })).toBeNull()
  })
  it("maps the three calls to the routes their MCP tools dispatch to, argument by argument", () => {
    const p = ugcPrelude(PHASE1)
    if ("error" in p) throw new Error(p.error)
    expect(p.speech).toEqual({ text: "one two three", voice: "voice-1", voiceType: "library", provider: "speech-model", languageCode: "xx" })
    expect(p.alignment("https://cdn.example/s.mp3")).toEqual({ transcript: "one two three", audioUrl: "https://cdn.example/s.mp3" })
    expect(p.split("https://cdn.example/s.mp3", [{ word: "one", start: 0, end: 1 }])).toEqual({
      plan: { v: 1, hook: "one" }, audioUrl: "https://cdn.example/s.mp3", alignment: [{ word: "one", start: 0, end: 1 }],
    })
    expect(UGC_PRELUDE_ROUTES).toEqual({
      speech: { path: "/v1/text-to-speech", jobType: "text-to-speech" },
      alignment: { path: "/v1/forced-alignment", jobType: "forced-alignment" },
      split: { path: "/v1/ugc/segments", jobType: "ugc-segments" },
    })
  })
  it("an answer missing a call, or naming another tool, is the newer-app sentence", () => {
    expect(ugcPrelude({ ...PHASE1, align: undefined })).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
    expect(ugcPrelude({ ...PHASE1, speech: { tool: "generate_dialogue", args: { text: "x" } } })).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
    expect(ugcPrelude({ ...PHASE1, split: { tool: "ugc_split_speech", args: {} } })).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
  })
  it("reads each step's job output: the speech's audio, the word timings, the segments", () => {
    expect(ugcPreludeOutput("speech", { audioUrl: "https://cdn.example/s.mp3" })).toEqual({ value: "https://cdn.example/s.mp3" })
    expect(ugcPreludeOutput("alignment", { alignment: [{ word: "a" }] })).toEqual({ value: [{ word: "a" }] })
    expect(ugcPreludeOutput("split", { segments: SEGMENTS })).toEqual({ value: SEGMENTS })
    for (const [step, out] of [["speech", {}], ["alignment", { alignment: [] }], ["split", undefined]] as const) {
      expect(ugcPreludeOutput(step, out as never)).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
    }
  })
  it("the second call is the first call's body with the segments", () => {
    expect(ugcClipsPhase2Body({ plan: { v: 1 }, surface: "canvas", userId: "u" }, SEGMENTS)).toEqual({ plan: { v: 1 }, surface: "canvas", userId: "u", segments: SEGMENTS })
  })
  it("the phase-2 answer's Script (sized) output carries the finish call's arguments; an answer without one is unchanged", () => {
    const read = ugcClipsOutputs(PHASE2)
    if ("error" in read) throw new Error(read.error)
    expect(JSON.parse(read.outputs["plan-out"]!)).toEqual({ v: 1, plan: PHASE2.sizedPlan, transcribeArgs: { language: "xx" }, finish: { segments: SEGMENTS } })
    const { finish: _f, phase: _p, ...english } = PHASE2
    const en = ugcClipsOutputs(english)
    if ("error" in en) throw new Error(en.error)
    expect(JSON.parse(en.outputs["plan-out"]!)).toEqual({ v: 1, plan: PHASE2.sizedPlan, transcribeArgs: { language: "xx" } })
  })
  it("is refused before anything is spent when no UGC Finish reads this UGC Clips' Script (sized) output", () => {
    const nodes = [{ id: "clips", type: "ugc-clips" }, { id: "fin", type: UGC_FINISH_CLIPS_TYPE }, { id: "join", type: "combine-videos" }]
    const wired = [{ source: "clips", target: "fin", sourceHandle: "plan-out", targetHandle: "plan" }]
    expect(ugcFinishWired(wired, nodes, "clips")).toBe(true)
    expect(ugcLaneNeedsFinish(wired, nodes, "clips")).toBeNull()
    // Another UGC Clips' finish, another output, or no UGC Finish at all: refused.
    expect(ugcLaneNeedsFinish(wired, nodes, "other")).toBe(UGC_NODE_MESSAGES.needsFinish)
    expect(ugcLaneNeedsFinish([{ ...wired[0]!, sourceHandle: "transcript" }], nodes, "clips")).toBe(UGC_NODE_MESSAGES.needsFinish)
    expect(ugcLaneNeedsFinish([{ ...wired[0]!, target: "join" }], nodes, "clips")).toBe(UGC_NODE_MESSAGES.needsFinish)
  })
})

describe("UGC Finish", () => {
  const PLAN_OUT_EN = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
  const PLAN_OUT_LANE = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {}, finish: { segments: SEGMENTS } })
  const CLIPS = ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"]

  it("is a registered UGC node, a video producer, and folds its clips into one run (never fanned out)", () => {
    expect(UGC_NODE_TYPES.has(UGC_FINISH_CLIPS_TYPE)).toBe(true)
    expect(VIDEO_PRODUCER_TYPES.has(UGC_FINISH_CLIPS_TYPE)).toBe(true)
    expect(FAN_IN_TARGETS[UGC_FINISH_CLIPS_TYPE]).toEqual(["clips"])
    expect(isFanInNodeType(UGC_FINISH_CLIPS_TYPE)).toBe(true)
    expect(isFanInEdge(UGC_FINISH_CLIPS_TYPE, "clips")).toBe(true)
    expect(isFanInEdge(UGC_FINISH_CLIPS_TYPE, "plan")).toBe(false)
    expect(UGC_PRIMARY_HANDLE[UGC_FINISH_CLIPS_TYPE]).toBe("video-out")
    // Its output is one value per edge by default; a Bundle edge hands on the whole list.
    expect(defaultEdgeOutputMode(UGC_FINISH_CLIPS_TYPE, "video-out")).toBe("last")
  })
  it("English (no finish call on the plan): the clips pass through as they came — no call, no job", () => {
    expect(ugcFinishPlan({ planOutWire: PLAN_OUT_EN, clipUrls: CLIPS })).toEqual({ kind: "pass", clips: CLIPS })
  })
  it("the segmented lane: the finish job's body — the segments as they came, one roll per clip, in order", () => {
    expect(ugcFinishPlan({ planOutWire: PLAN_OUT_LANE, clipUrls: CLIPS })).toEqual({
      kind: "job", path: "/v1/ugc/finish",
      body: { segments: SEGMENTS, clips: [{ clip: 1, rolls: [CLIPS[0]] }, { clip: 2, rolls: [CLIPS[1]] }] },
    })
  })
  it("refuses before any call: no clips, no plan, or a clip count that is not the segment count", () => {
    expect(ugcFinishPlan({ planOutWire: PLAN_OUT_LANE, clipUrls: [] })).toEqual({ error: UGC_NODE_MESSAGES.finishNeedsClips })
    expect(ugcFinishPlan({ planOutWire: undefined, clipUrls: CLIPS })).toEqual({ error: UGC_NODE_MESSAGES.needsPlanOut })
    expect(ugcFinishPlan({ planOutWire: PLAN_OUT_LANE, clipUrls: CLIPS.slice(0, 1) })).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
  })
  it("a finished job → the clips in clip order with their real length; a dry finish's warning rides every clip", () => {
    const out = ugcFinishOutputs({
      ready: true,
      clips: [{ clip: 2, url: "https://cdn.example/f2.mp4", sec: 5.2 }, { clip: 1, url: "https://cdn.example/f1.mp4", sec: 6.1 }],
      warnings: [{ code: "ACOUSTICS_SKIPPED", cause: null, reason: "r" }],
    })
    expect(out).toEqual({
      clips: [
        { url: "https://cdn.example/f1.mp4", meta: { warnings: ["ACOUSTICS_SKIPPED"], durationSec: 6.1 } },
        { url: "https://cdn.example/f2.mp4", meta: { warnings: ["ACOUSTICS_SKIPPED"], durationSec: 5.2 } },
      ],
    })
  })
  it("ready: false fails with its sentence; a clip list with a gap is never handed on", () => {
    expect(ugcFinishOutputs({ ready: false, reroll: [2], failed: [] })).toEqual({ error: UGC_NODE_MESSAGES.finishNotReady })
    expect(ugcFinishOutputs({ ready: true, clips: [{ clip: 1, url: "u1" }, { clip: 3, url: "u3" }] })).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
    expect(ugcFinishOutputs(undefined)).toEqual({ error: UGC_NODE_MESSAGES.newerApp })
  })
})
