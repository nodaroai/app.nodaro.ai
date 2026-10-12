import { UGC_CREATOR_CANDIDATES_KEY, ugcKeptOutputs } from "@nodaro/shared"
import { describe, expect, it } from "vitest"
import outputs from "../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-run-outputs.json"
import {
  UGC_PATCH_REPLACES_GENERIC,
  holdsUgcRunResult,
  ugcCreatorShowsRun,
  ugcEndedRunMayLand,
  ugcJobMayLand,
  ugcJobResultPatch,
  ugcJobRunOutput,
  ugcRunIsNewer,
  ugcRunPatch,
  ugcStopPatch,
} from "../ugc-run-patch"

const O = outputs as Record<string, Record<string, unknown>>
const outs = (k: string) => O[k]!.ugcOutputs as Record<string, string>

describe("what a finished UGC node writes, on every lane", () => {
  it("options waiting: the options; the creator wire and the older image cleared (written as undefined, so the merge clears them)", () => {
    const p = ugcRunPatch("ugc-creator", O["ugc-creator:pair"]!)!
    expect(p).toEqual({ [UGC_CREATOR_CANDIDATES_KEY]: O["ugc-creator:pair"]!.ugcCandidates })
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["ugcOutputs", "generatedImageUrl"]))
  })
  it("a creator handed on: its outputs, its record as result, its image from the creator wire, no options", () => {
    const p = ugcRunPatch("ugc-creator", O["ugc-creator:one"]!)!
    expect(p).toMatchObject({ ugcOutputs: outs("ugc-creator:one"), result: JSON.parse(outs("ugc-creator:one").creator!), generatedImageUrl: outs("ugc-creator:one").image })
    expect(p[UGC_CREATOR_CANDIDATES_KEY]).toBeUndefined()
    expect(ugcRunPatch("ugc-creator", O["ugc-creator:one-noted"]!)!.optionFailed).toBe(true)
  })
  it("a kept creator and a kept script write what they hold, never clear the kept result", () => {
    expect(ugcRunPatch("ugc-script", O["ugc-script:kept"]!)).toEqual({ ugcOutputs: outs("ugc-script:kept") })
    expect(ugcRunPatch("ugc-creator", O["ugc-creator:kept"]!)!.ugcOutputs).toEqual(outs("ugc-creator:kept"))
  })
  it("a script: its outputs and its result (warnings, notes, rounds)", () => {
    expect(ugcRunPatch("ugc-script", O["ugc-script"]!)).toEqual({ ugcOutputs: outs("ugc-script"), result: O["ugc-script"]!.ugcResult })
  })
  it("the clips: the outputs and this run's tickets; no quote (a server run prices nothing)", () => {
    expect(ugcRunPatch("ugc-clips", O["ugc-clips"]!)).toEqual({ ugcOutputs: outs("ugc-clips"), __listResults: O["ugc-clips"]!.listResults, quote: undefined })
  })
  it("a clip: its outputs, warnings and length; a fan-out adds each row's notes", () => {
    expect(ugcRunPatch("ugc-clip", O["ugc-clip"]!)).toMatchObject({ ugcOutputs: outs("ugc-clip"), __listResultMeta: undefined })
    expect(ugcRunPatch("ugc-clip", O["ugc-clip:fan-out"]!)!.__listResultMeta).toEqual(O["ugc-clip:fan-out"]!.listResultMeta)
  })
  it("the cards: the outputs, the result and the Notes text", () => {
    const o = outs("ugc-cards")
    expect(ugcRunPatch("ugc-cards", O["ugc-cards"]!)).toEqual({ ugcOutputs: o, result: { layerPlan: o.layerPlan, captionPlan: o.captionPlan, report: o.report }, generatedText: o.report })
  })
  it("a credits stop keeps its options and clears the wire; with none kept it leaves the node alone", () => {
    const stopped = O["ugc-creator:stopped"]!.output as Record<string, unknown>
    expect(ugcStopPatch(stopped)).toEqual({ [UGC_CREATOR_CANDIDATES_KEY]: stopped.ugcCandidates })
    expect(Object.keys(ugcStopPatch(stopped))).toEqual(expect.arrayContaining(["ugcOutputs", "generatedImageUrl"]))
    expect(ugcStopPatch({ ugcShortfall: { required: 18, balance: 5 } })).toEqual({})
  })
  it("a node holding a result of its own, or options, is left by a reopen", () => {
    expect(holdsUgcRunResult({ ugcOutputs: { plan: "{}" } })).toBe(true)
    expect(holdsUgcRunResult({ candidates: [{}] })).toBe(true)
    expect(holdsUgcRunResult({ generatedImageUrl: "https://cdn.example/old.png" })).toBe(false)
  })
  it("the creator's patch and the kept branch agree: a picked creator hands on what the pick wrote", () => {
    const record = JSON.parse(outs("ugc-creator:one").creator!)
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true, result: record })).toEqual(outs("ugc-creator:one"))
  })
  it("the four non-video types replace the generic writes; UGC Clip rides after them", () => {
    expect([...UGC_PATCH_REPLACES_GENERIC].sort()).toEqual(["ugc-cards", "ugc-clips", "ugc-creator", "ugc-script"])
  })
})

describe("the remaining rules", () => {
  it("another type has no patch", () => {
    expect(ugcRunPatch("generate-image", { imageUrl: "https://cdn.example/a.png" })).toBeUndefined()
    expect(ugcRunPatch(undefined, {})).toBeUndefined()
    expect(ugcJobRunOutput("generate-image", {})).toBeUndefined()
  })
  it("a stop with no output, or an empty list, leaves the node alone", () => {
    expect(ugcStopPatch(undefined)).toEqual({})
    expect(ugcStopPatch({ ugcCandidates: [] })).toEqual({})
  })
  it("a job row reads as the run output a server run hands the editor", () => {
    const script = O["ugc-script"]!
    const result = script.ugcResult as Record<string, unknown>
    const row = { plan: script.json, productCategory: result.productCategory, warnings: result.warnings, notes: result.notes, rounds: result.rounds }
    expect(ugcJobRunOutput("ugc-script", row)).toEqual({ ugcOutputs: script.ugcOutputs, ugcResult: script.ugcResult })
    const clip = O["ugc-clip"]!
    expect(ugcJobRunOutput("ugc-clip", { videoUrl: clip.videoUrl, durationSec: clip.durationSec, clipWarnings: clip.clipWarnings, frameCheck: { passed: true } }))
      .toEqual({ videoUrl: clip.videoUrl, durationSec: clip.durationSec, clipWarnings: clip.clipWarnings, ugcOutputs: clip.ugcOutputs })
  })
  it("a clip row without its length leaves the length out; a script row without a plan hands nothing on", () => {
    expect(ugcJobRunOutput("ugc-clip", { videoUrl: "https://cdn.example/c.mp4" })).toEqual({ videoUrl: "https://cdn.example/c.mp4", clipWarnings: [], ugcOutputs: { "video-out": "https://cdn.example/c.mp4" } })
    expect(ugcJobRunOutput("ugc-script", { productCategory: "saas" })).toEqual({ ugcOutputs: { category: "saas" } })
  })
  it("the stamp: a node shows a run only by that run's id", () => {
    expect(ugcCreatorShowsRun({ resultsRunId: "exec-1" }, "exec-1")).toBe(true)
    expect(ugcCreatorShowsRun({ resultsRunId: "exec-0" }, "exec-1")).toBe(false)
    expect(ugcCreatorShowsRun({}, "exec-1")).toBe(false)
    expect(ugcCreatorShowsRun({ resultsRunId: "exec-1" }, undefined)).toBe(false)
    expect(ugcCreatorShowsRun({ resultsRunId: "" }, "")).toBe(false)
  })
  it("a newer run: none shown, or an end after the one shown; the same run, an older one or an unreadable time is not", () => {
    const run = { id: "exec-1", completedAt: "2026-10-05T10:00:30.000Z" }
    expect(ugcRunIsNewer({}, run)).toBe(true)
    expect(ugcRunIsNewer({ resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-05T09:00:00.000Z" }, run)).toBe(false)
    expect(ugcRunIsNewer({ resultsRunId: "exec-0", resultsRunEndedAt: "2026-10-05T09:00:00.000Z" }, run)).toBe(true)
    expect(ugcRunIsNewer({ resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T11:00:00.000Z" }, run)).toBe(false)
    expect(ugcRunIsNewer({ resultsRunId: "exec-0" }, run)).toBe(false)
    expect(ugcRunIsNewer({ resultsRunId: "exec-0", resultsRunEndedAt: "2026-10-05T09:00:00.000Z" }, { id: "exec-1", completedAt: null })).toBe(false)
  })
})

describe("a UGC Clip's Re-render marks", () => {
  it("go when the node's clips land, on every lane: the run rendered them", () => {
    const p = ugcRunPatch("ugc-clip", O["ugc-clip"]!)!
    expect("rerenderPending" in p && p.rerenderPending === undefined).toBe(true)
    const job = ugcJobResultPatch("ugc-clip", { videoUrl: "https://cdn.example/c.mp4" }, { id: "job-1", endedAt: "2026-10-05T10:00:00.000Z" })!
    expect("rerenderPending" in job && job.rerenderPending === undefined).toBe(true)
  })
  it("stay when one row of a fanned-out batch lands: the batch's marks are the run's", () => {
    const row = ugcJobResultPatch("ugc-clip", { videoUrl: "https://cdn.example/c.mp4" }, { id: "job-1", endedAt: "2026-10-05T10:00:00.000Z" }, { batchRow: true })!
    expect("rerenderPending" in row).toBe(false)
  })
})

describe("a stamped result outranks one no lane stamped", () => {
  const run = { id: "exec-2", completedAt: "2026-10-05T10:00:30.000Z" }
  it("an ended run lands over an unstamped result, never over a stamped one whose end cannot be read", () => {
    expect(ugcEndedRunMayLand({ ugcOutputs: { plan: "{}" } }, run)).toBe(true)
    expect(ugcEndedRunMayLand({ ugcOutputs: { plan: "{}" }, resultsRunId: "exec-1" }, run)).toBe(false)
    expect(ugcEndedRunMayLand({ ugcOutputs: { plan: "{}" }, resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-05T09:00:00.000Z" }, run)).toBe(true)
    expect(ugcEndedRunMayLand({ ugcOutputs: { plan: "{}" }, resultsRunId: "exec-2", resultsRunEndedAt: run.completedAt }, run)).toBe(false)
  })
  it("a finished job lands over an unstamped result, never over a stamped one whose end cannot be read (but in flight)", () => {
    const job = { id: "job-1", endedAt: "2026-10-05T10:00:00.000Z" }
    expect(ugcJobMayLand({ ugcOutputs: { plan: "{}" } }, job)).toBe(true)
    expect(ugcJobMayLand({ generatedVideoUrl: "https://cdn.example/old.mp4" }, job)).toBe(true)
    expect(ugcJobMayLand({ ugcOutputs: { plan: "{}" }, resultsRunId: "exec-1" }, job)).toBe(false)
    expect(ugcJobMayLand({ ugcOutputs: { plan: "{}" }, resultsRunId: "exec-1" }, job, { inFlight: true })).toBe(true)
  })
})
