// @vitest-environment node
import { describe, expect, it } from "vitest"
import { PAID_STEPS, costOf, doneSteps, lockedSteps, outcomesAfterStop, statusOf, withoutSteps, type StatusInput } from "../panel-model"
import { DEFAULT_PARAMS } from "../request-reading"
import { EMPTY_SUMMARY } from "../run/types"

const SUMMARY = { ...EMPTY_SUMMARY, fromSeconds: 182, toSeconds: 151, pausesCut: 23, captions: 148, music: true, bpm: 112 }
const plan = (steps: Parameters<typeof costOf>[0], cannot: string[] = []) => ({ steps, params: DEFAULT_PARAMS, reply: null, cannot })

describe("the cards", () => {
  it("after a stop, what was at work or waiting did not finish and can be asked for again", () => {
    const after = outcomesAfterStop({ pauses: { state: "done", key: "freecutAi.cutDone" }, captions: { state: "working", key: "freecutAi.captioning", progress: 0.4 }, music: { state: "waiting", key: "freecutAi.waiting" } })
    expect(after.pauses?.state).toBe("done")
    expect(after.captions).toMatchObject({ state: "skipped", key: "freecutAi.notFinished", progress: undefined })
    expect(after.music).toMatchObject({ state: "skipped", key: "freecutAi.notFinished" })
    expect(doneSteps(after)).toEqual(["pauses"])
  })

  it("an undone step is forgotten, so its card can be asked for again", () => {
    expect(withoutSteps({ captions: { state: "done", key: "freecutAi.captionsDone" }, music: { state: "done", key: "freecutAi.musicDone" } }, ["captions"])).toEqual({ music: { state: "done", key: "freecutAi.musicDone" } })
  })

  it("a done step with no 'again' is locked; one that is redone or made again is not", () => {
    const done = { state: "done" as const, key: "freecutAi.cutDone" as const }
    const outcomes = { pauses: done, phone: done, captions: done, clips: done, chapters: done, music: { state: "failed" as const, key: "freecutAi.musicFailed" as const } }
    expect(lockedSteps(outcomes).sort()).toEqual(["pauses", "phone"])
    expect(doneSteps(outcomes)).not.toContain("music")
  })
})

describe("the status line", () => {
  const base: StatusInput = { phase: { kind: "idle" }, stage: "reading", waiting: false, view: "edited", planSteps: [], outcomes: {}, working: "", elapsed: "" }
  const running = { ...base, phase: { kind: "running" as const, startedAt: 0 } }

  it("says it is ready, then reading, listening, and how far the work is", () => {
    expect(statusOf(base)).toMatchObject({ kind: "ready", title: "freecutAi.status.ready" })
    expect(statusOf(running)).toMatchObject({ kind: "busy", title: "freecutAi.status.reading" })
    expect(statusOf({ ...running, stage: "listening", planSteps: ["pauses", "captions"] })).toMatchObject({ kind: "busy", title: "freecutAi.status.listening" })
    const midway = statusOf({
      ...running,
      stage: "working",
      planSteps: ["pauses", "captions"],
      outcomes: { pauses: { state: "done", key: "freecutAi.cutDone" }, captions: { state: "working", key: "freecutAi.captioning", progress: 0.5 } },
      working: "Captions",
      elapsed: "0:12",
    })
    expect(midway).toMatchObject({ title: "freecutAi.status.working", titleVars: { done: 1, total: 2 }, sub: "freecutAi.status.workingSub", subVars: { who: "Captions", time: "0:12" } })
    expect(midway.bar).toBeCloseTo(0.75)
  })

  it("says when the run waits for a free slot on the account", () => {
    expect(statusOf({ ...running, stage: "working", planSteps: ["music"], waiting: true })).toMatchObject({ title: "freecutAi.status.waitingSlot" })
  })

  it("says when it is done, stopped, undone, asked to choose, or when nothing ran", () => {
    expect(statusOf({ ...base, phase: { kind: "done", summary: SUMMARY } })).toMatchObject({ kind: "ok", title: "freecutAi.status.done" })
    expect(statusOf({ ...base, phase: { kind: "stopped" } })).toMatchObject({ kind: "warn", title: "freecutAi.status.stopped" })
    expect(statusOf({ ...base, phase: { kind: "undone" } })).toMatchObject({ title: "freecutAi.status.undone" })
    expect(statusOf({ ...base, phase: { kind: "confirming", plan: plan(["pauses"], ["make the shirt blue"]), extra: { listen: false, steps: [] } } })).toMatchObject({ kind: "warn", title: "freecutAi.confirmTitle" })
    expect(statusOf({ ...base, phase: { kind: "confirming", plan: plan(["music"]), extra: { listen: true, steps: ["music"] } } })).toMatchObject({ kind: "warn", title: "freecutAi.confirmCostTitle" })
    expect(statusOf({ ...base, phase: { kind: "declined", plan: plan([], ["fly"]), reason: "cannot" } })).toMatchObject({ title: "freecutAi.declinedTitle", sub: "freecutAi.nothingEdited" })
    expect(statusOf({ ...base, phase: { kind: "declined", plan: plan([]), reason: "nothing" } })).toMatchObject({ title: "freecutAi.declinedNothing" })
    expect(statusOf({ ...base, phase: { kind: "declined", plan: plan([]), reason: "done" } })).toMatchObject({ kind: "ready", title: "freecutAi.status.alreadyDone" })
  })

  it("says the original is showing, whatever else is going on", () => {
    expect(statusOf({ ...base, view: "original", phase: { kind: "done", summary: SUMMARY } })).toMatchObject({ kind: "original", title: "freecutAi.status.original" })
  })
})

describe("what a request is charged", () => {
  const prices = { read: 1, listen: 22, choose: 2, pack: 88, steps: { music: 33, broll: 30, mistakes: 6, phone: 12, layout: 12, clips: 40, picture: 120, cameras: 18 } }

  it("editing on the timeline is free: cutting pauses and laying captions pay only the listening", () => {
    expect(costOf(["pauses", "captions"], { heard: false, read: false, prices })).toEqual({ total: 22, parts: [{ key: "freecutAi.cost.listen", credits: 22 }] })
    expect(costOf(["pauses", "captions", "color"], { heard: true, read: false, prices }).total).toBe(0)
  })

  it("reading is paid only for a request in the person's own words", () => {
    expect(costOf(["color"], { heard: false, read: true, prices }).total).toBe(1)
    expect(costOf(["color"], { heard: false, read: false, prices }).total).toBe(0)
  })

  it("listens once per video, only for a step that reads the words", () => {
    expect(costOf(["music"], { heard: false, read: false, prices }).total).toBe(33)
    expect(costOf(["fillers", "music"], { heard: false, read: false, prices }).total).toBe(55)
    expect(costOf(["fillers", "music"], { heard: true, read: false, prices }).total).toBe(33)
  })

  it("the creative pass is paid once for b-roll and zoom together", () => {
    const cost = costOf(["broll", "zoom"], { heard: true, read: false, prices })
    expect(cost.parts.map((p) => p.key)).toEqual(["freecutAi.cost.choose", "freecutAi.cost.broll"])
    expect(cost.total).toBe(32)
  })

  it("every paid step has its own line", () => {
    const cost = costOf([...PAID_STEPS], { heard: true, read: false, prices })
    expect(cost.parts.map((p) => p.key)).toEqual(["freecutAi.cost.choose", "freecutAi.cost.pack", ...PAID_STEPS.map((s) => `freecutAi.cost.${s}`)])
    expect(cost.total).toBe(2 + 88 + 33 + 30 + 6 + 12 + 12 + 40 + 120 + 18)
  })

  it("the podcast pack is paid once for clips, a trailer and chapters together", () => {
    const cost = costOf(["clips", "trailer", "chapters"], { heard: true, read: false, prices })
    expect(cost.parts.map((p) => p.key)).toEqual(["freecutAi.cost.pack", "freecutAi.cost.clips"])
    expect(cost.total).toBe(88 + 40)
    expect(costOf(["chapters"], { heard: true, read: false, prices }).total).toBe(88)
  })

  it("has no figure while a price it needs is unknown", () => {
    expect(costOf(["music"], { heard: false, read: false, prices: { read: 1, listen: 22, steps: {} } }).total).toBeUndefined()
    expect(costOf(["pauses"], { heard: true, read: true, prices: { read: 1, steps: {} } }).total).toBe(1)
  })
})
