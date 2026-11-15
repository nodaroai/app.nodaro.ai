// @vitest-environment node
import { describe, expect, it } from "vitest"
import { costOf, doneSteps, outcomesAfterRun, outcomesAfterStop, statusOf, stepsOfEntry, withAgentEvent, withoutSteps, type StatusInput } from "../panel-model"

const SUMMARY = { fromSeconds: 26.3, toSeconds: 12.4, pausesCut: 7, fillersCut: 1, captions: 19, music: true }

describe("the cards during a run", () => {
  it("the Cutter's state is the pauses' and the filler words' alike, for the steps the plan has", () => {
    const working = withAgentEvent({}, "cutter", ["pauses", "fillers", "music"], { state: "working", key: "freecutAi.cutting", vars: { done: 2, total: 8 }, progress: 0.25 })
    expect(working.pauses).toEqual({ state: "working", key: "freecutAi.cutting", vars: { done: 2, total: 8 }, progress: 0.25 })
    expect(working.fillers).toEqual(working.pauses)
    expect(working.music).toBeUndefined()
    expect(withAgentEvent({}, "cutter", ["pauses"], { state: "working", key: "freecutAi.cutting" }).fillers).toBeUndefined()
  })

  it("the Assistant's state belongs to no card", () => {
    expect(withAgentEvent({}, "lead", ["pauses", "captions"], { state: "working", key: "freecutAi.listening" })).toEqual({})
  })

  it("a failed step keeps the provider's own words", () => {
    const next = withAgentEvent({}, "sound", ["music"], { state: "failed", key: "freecutAi.musicFailed", detail: "Suno refused the prompt" })
    expect(next.music).toEqual({ state: "failed", key: "freecutAi.musicFailed", vars: undefined, progress: undefined, detail: "Suno refused the prompt" })
  })
})

describe("the cards after a run", () => {
  it("each done step says what it did on its own", () => {
    const done = { state: "done" as const, key: "freecutAi.cutDone" as const }
    const after = outcomesAfterRun({ pauses: done, fillers: done, captions: { state: "done", key: "freecutAi.captionsDone" }, music: { state: "done", key: "freecutAi.musicDone" } }, SUMMARY, ["pauses", "fillers", "captions", "music"])
    expect(after.pauses).toEqual({ state: "done", key: "freecutAi.summaryPauses", vars: { n: 7 } })
    expect(after.fillers).toEqual({ state: "done", key: "freecutAi.summaryFillersOne" })
    expect(after.captions).toEqual({ state: "done", key: "freecutAi.summaryCaptions", vars: { n: 19 } })
    expect(after.music).toEqual({ state: "done", key: "freecutAi.musicDone" })
  })

  it("filler words asked for and none found is still done, and says so", () => {
    const after = outcomesAfterRun({ fillers: { state: "done", key: "freecutAi.cutDone" } }, { ...SUMMARY, fillersCut: 0 }, ["fillers"])
    expect(after.fillers).toEqual({ state: "done", key: "freecutAi.noFillers" })
  })

  it("a step that failed or was skipped is not done, so it can be asked for again", () => {
    const outcomes = { pauses: { state: "done" as const, key: "freecutAi.cutDone" as const }, music: { state: "failed" as const, key: "freecutAi.musicFailed" as const }, captions: { state: "skipped" as const, key: "freecutAi.noSpeech" as const } }
    expect(doneSteps(outcomesAfterRun(outcomes, SUMMARY, ["pauses", "music", "captions"]))).toEqual(["pauses"])
  })

  it("a card an earlier run finished keeps what it said", () => {
    // Run 1 added captions; run 2 adds only music, so its summary counts no captions.
    const before = { captions: { state: "done" as const, key: "freecutAi.summaryCaptions" as const, vars: { n: 19 } }, fillers: { state: "done" as const, key: "freecutAi.summaryFillersOne" as const }, music: { state: "done" as const, key: "freecutAi.musicDone" as const } }
    const after = outcomesAfterRun(before, { ...SUMMARY, captions: 0, fillersCut: 0, pausesCut: 0 }, ["music"])
    expect(after.captions).toEqual(before.captions)
    expect(after.fillers).toEqual(before.fillers)
  })

  it("an undo entry stands for the steps its run did: a cut for that run's pauses and filler words", () => {
    const labels = { pauses: "Cut the pauses", fillers: "Remove filler words", captions: "Add captions", music: "Add music" }
    expect(stepsOfEntry("Cut the pauses", labels, ["fillers", "pauses", "music"])).toEqual(["fillers", "pauses"])
    expect(stepsOfEntry("Remove filler words", labels, ["fillers"])).toEqual(["fillers"])
    expect(stepsOfEntry("Add captions", labels, ["captions"])).toEqual(["captions"])
    expect(stepsOfEntry("Add music", labels, ["music"])).toEqual(["music"])
    expect(stepsOfEntry("by hand", labels, ["music"])).toEqual([])
    expect(withoutSteps({ captions: { state: "done", key: "freecutAi.captionsDone" }, music: { state: "done", key: "freecutAi.musicDone" } }, ["captions"])).toEqual({ music: { state: "done", key: "freecutAi.musicDone" } })
  })

  it("after a stop, what was at work or waiting did not finish", () => {
    const after = outcomesAfterStop({ pauses: { state: "done", key: "freecutAi.cutDone" }, captions: { state: "working", key: "freecutAi.captioning", progress: 0.4 }, music: { state: "waiting", key: "freecutAi.waiting" } })
    expect(after.pauses?.state).toBe("done")
    expect(after.captions).toMatchObject({ state: "skipped", key: "freecutAi.notFinished", progress: undefined })
    expect(after.music).toMatchObject({ state: "skipped", key: "freecutAi.notFinished" })
  })
})

describe("the status line", () => {
  const base: StatusInput = { phase: { kind: "idle" }, view: "edited", listening: false, planSteps: [], outcomes: {}, working: "", elapsed: "" }

  it("says it is ready, then reading, listening, and how far the work is", () => {
    expect(statusOf(base)).toMatchObject({ kind: "ready", title: "freecutAi.status.ready" })
    const running = { ...base, phase: { kind: "running" as const, startedAt: 0 } }
    expect(statusOf(running)).toMatchObject({ kind: "busy", title: "freecutAi.status.reading" })
    expect(statusOf({ ...running, planSteps: ["pauses", "captions"], listening: true })).toMatchObject({ kind: "busy", title: "freecutAi.status.listening" })
    const midway = statusOf({
      ...running,
      planSteps: ["pauses", "captions"],
      outcomes: { pauses: { state: "done", key: "freecutAi.cutDone" }, captions: { state: "working", key: "freecutAi.captioning", progress: 0.5 } },
      working: "Captions",
      elapsed: "0:12",
    })
    expect(midway).toMatchObject({ title: "freecutAi.status.working", titleVars: { done: 1, total: 2 }, sub: "freecutAi.status.workingSub", subVars: { who: "Captions", time: "0:12" } })
    expect(midway.bar).toBeCloseTo(0.75)
  })

  it("says when it is done, stopped, undone, asked to choose, or when nothing ran", () => {
    expect(statusOf({ ...base, phase: { kind: "done", summary: SUMMARY } })).toMatchObject({ kind: "ok", title: "freecutAi.status.done" })
    expect(statusOf({ ...base, phase: { kind: "stopped" } })).toMatchObject({ kind: "warn", title: "freecutAi.status.stopped" })
    expect(statusOf({ ...base, phase: { kind: "undone" } })).toMatchObject({ title: "freecutAi.status.undone" })
    const leftOut = { steps: ["pauses" as const], musicStyle: null, reply: null, cannot: ["make the shirt blue"] }
    expect(statusOf({ ...base, phase: { kind: "confirming", plan: leftOut, extra: { listen: false, music: false } } })).toMatchObject({ kind: "warn", title: "freecutAi.confirmTitle" })
    expect(statusOf({ ...base, phase: { kind: "confirming", plan: { ...leftOut, cannot: [] }, extra: { listen: true, music: true } } })).toMatchObject({ kind: "warn", title: "freecutAi.confirmCostTitle" })
    const plan = { steps: [], musicStyle: null, reply: null, cannot: ["make the shirt blue"] }
    expect(statusOf({ ...base, phase: { kind: "declined", plan, reason: "cannot" } })).toMatchObject({ title: "freecutAi.declinedTitle", sub: "freecutAi.nothingEdited" })
    expect(statusOf({ ...base, phase: { kind: "declined", plan, reason: "nothing" } })).toMatchObject({ title: "freecutAi.declinedNothing" })
    expect(statusOf({ ...base, phase: { kind: "declined", plan, reason: "done" } })).toMatchObject({ kind: "ready", title: "freecutAi.status.alreadyDone" })
  })

  it("says the original is showing, whatever else is going on", () => {
    expect(statusOf({ ...base, view: "original", phase: { kind: "done", summary: SUMMARY } })).toMatchObject({ kind: "original", title: "freecutAi.status.original" })
  })
})

describe("what a request is charged", () => {
  const prices = { read: 1, listen: 22, music: 33 }

  it("reading always, listening once per video for a step that reads the words, and the music", () => {
    expect(costOf(["pauses", "captions"], { heard: false, prices })).toEqual({ total: 23, parts: [{ key: "freecutAi.cost.read", credits: 1 }, { key: "freecutAi.cost.listen", credits: 22 }] })
    expect(costOf(["pauses", "captions"], { heard: true, prices }).total).toBe(1)
    expect(costOf(["music"], { heard: false, prices }).total).toBe(34)
    expect(costOf(["fillers", "music"], { heard: false, prices }).total).toBe(56)
    expect(costOf([], { heard: false, prices }).total).toBe(1)
  })

  it("has no figure while a price it needs is unknown", () => {
    expect(costOf(["music"], { heard: false, prices: { read: 1, listen: 22 } }).total).toBeUndefined()
    expect(costOf(["pauses"], { heard: true, prices: { read: 1 } }).total).toBe(1)
  })
})
