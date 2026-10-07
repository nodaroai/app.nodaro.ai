/**
 * Edit Plan per started minute (decided 2026-10-07) — WHO knows whether the
 * loaded plugin charges per started minute. The API process and the video
 * worker load the plugin and read its `supports().editPlanPerMinute`; the
 * standalone orchestrator never loads it, so it asks this container's API
 * (`GET /v1/edit-plan/capabilities`), caches the answer and FAILS CLOSED to the
 * steps when it cannot. No credits (self-host) → steps: nothing is charged here.
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  editPlanPerMinuteActive,
  setEditPlanPerMinuteSource,
  _resetEditPlanPerMinuteForTests,
  EDIT_PLAN_PER_MINUTE_TTL_MS,
  EDIT_PLAN_PER_MINUTE_FAILURE_TTL_MS,
  type EditPlanPerMinuteDeps,
} from "../edit-plan-per-minute.js"

function deps(over: Partial<EditPlanPerMinuteDeps> = {}): EditPlanPerMinuteDeps {
  return {
    hasCredits: () => true,
    supportsLoaded: () => true,
    getPluginSupports: () => ({ editPlanPerMinute: true }),
    now: () => 0,
    ...over,
  }
}

beforeEach(() => _resetEditPlanPerMinuteForTests())

describe("a process that loaded the plugin", () => {
  it("reads the declaration", async () => {
    expect(await editPlanPerMinuteActive(deps())).toBe(true)
    expect(await editPlanPerMinuteActive(deps({ getPluginSupports: () => ({}) }))).toBe(false)
    expect(await editPlanPerMinuteActive(deps({ getPluginSupports: () => ({ editPlanModes: ["trailer"] }) }))).toBe(false)
  })

  it("no credits: steps, whatever the plugin declares", async () => {
    expect(await editPlanPerMinuteActive(deps({ hasCredits: () => false }))).toBe(false)
  })
})

describe("the orchestrator (no plugin loaded)", () => {
  it("with no source registered: steps", async () => {
    expect(await editPlanPerMinuteActive(deps({ supportsLoaded: () => false }))).toBe(false)
  })

  it("asks the registered source and reuses its answer", async () => {
    let asked = 0
    let t = 0
    setEditPlanPerMinuteSource(async () => {
      asked++
      return true
    })
    const d = deps({ supportsLoaded: () => false, now: () => t })
    expect(await editPlanPerMinuteActive(d)).toBe(true)
    t = EDIT_PLAN_PER_MINUTE_TTL_MS - 1
    expect(await editPlanPerMinuteActive(d)).toBe(true)
    expect(asked).toBe(1)
    t = EDIT_PLAN_PER_MINUTE_TTL_MS
    await editPlanPerMinuteActive(d)
    expect(asked).toBe(2)
  })

  it("fails closed to steps when the source throws, and asks again soon", async () => {
    let t = 0
    let fail = true
    setEditPlanPerMinuteSource(async () => {
      if (fail) throw new Error("ECONNREFUSED")
      return true
    })
    const d = deps({ supportsLoaded: () => false, now: () => t })
    expect(await editPlanPerMinuteActive(d)).toBe(false)
    fail = false
    t = EDIT_PLAN_PER_MINUTE_FAILURE_TTL_MS
    expect(await editPlanPerMinuteActive(d)).toBe(true)
  })
})
