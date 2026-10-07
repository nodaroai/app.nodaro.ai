/**
 * The edit-plan mode gate (Track D1). An older cloud plugin's `edit-plan`
 * handler coerces a mode it does not know to `tighten`, while the workflow run
 * already reserved that mode's price. The video worker therefore refuses a job
 * in a mode the loaded plugin has not declared — before the plugin's handler
 * runs, as a deterministic failure the worker refunds.
 */
import { describe, it, expect, vi } from "vitest"
import type { Job } from "bullmq"
import type { HandlerFn } from "../../../workers/shared.js"
import { isDeterministicJobError } from "../../deterministic-job-error.js"
import type { PluginSupports } from "../types.js"
import {
  editPlanModeRefusal,
  editPlanModeRefusalMessage,
  editPlanModesOf,
  editPlanModeVerdict,
  NODARO_UNREACHABLE_MESSAGE,
  withEditPlanModeGate,
  type EditPlanModesAnswer,
} from "../edit-plan-mode-gate.js"

/** The gate asks a resolver per job (round 6): one answering what `supports` declares. */
const declared = (supports: PluginSupports) => async (): Promise<EditPlanModesAnswer> => ({
  modes: editPlanModesOf(supports),
  source: "server",
})
/** Round 7: a connected self-host whose nodaro.ai could not be asked. */
const unreachable = async (): Promise<EditPlanModesAnswer> => ({
  modes: editPlanModesOf({}),
  source: "nodaro.ai-unreachable",
})
const jobIn = (mode: unknown) => ({ name: "edit-plan", data: { mode } }) as unknown as Job
const ctx = {} as never

describe("editPlanModesOf", () => {
  it("an older plugin that declares nothing supports the three Phase-1 modes", () => {
    expect([...editPlanModesOf({})]).toEqual(["tighten", "clips", "chapters"])
  })

  it("a declaration adds to the Phase-1 modes", () => {
    expect([...editPlanModesOf({ editPlanModes: ["tighten", "clips", "chapters", "trailer"] })]).toEqual([
      "tighten", "clips", "chapters", "trailer",
    ])
  })

  it("ignores a declared mode this app does not know (decided 2026-10-06: unknown is refused everywhere)", () => {
    expect([...editPlanModesOf({ editPlanModes: ["trailer", "montage", 7 as unknown as string] })]).toEqual([
      "tighten", "clips", "chapters", "trailer",
    ])
  })

  it("a declaration naming only the new mode never refuses the Phase-1 ones", () => {
    expect([...editPlanModesOf({ editPlanModes: ["trailer"] })]).toEqual(["tighten", "clips", "chapters", "trailer"])
  })
})

// Round 3 (decided 2026-10-06): the MCP plan_edit tool refuses an undeclared
// mode with the SAME words the worker fails the job with — one message, two lanes.
describe("editPlanModeRefusalMessage", () => {
  it("names the mode by its display name and says nothing was charged", () => {
    expect(editPlanModeRefusalMessage("trailer")).toBe(
      "Trailer mode is not available on this server yet. Choose another mode, or try again after the next update. You were not charged.",
    )
  })

  it("falls back to the raw mode for a mode with no display name", () => {
    expect(editPlanModeRefusalMessage("montage")).toMatch(/^montage mode is not available on this server yet\./)
  })

  it("is the message the worker gate fails the job with", async () => {
    const gated = withEditPlanModeGate({ "edit-plan": vi.fn(async () => undefined) as HandlerFn }, declared({}))
    const err = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("trailer"))
  })
})

// Round 4 (decided 2026-10-06): an UNKNOWN mode is refused like an undeclared
// one, with the same words, everywhere the app dispatches a plan — never
// planned (and charged) as tighten.
describe("editPlanModeRefusal", () => {
  const phase1 = editPlanModesOf({})
  const withTrailer = editPlanModesOf({ editPlanModes: ["trailer"] })

  it("passes an absent mode (the planner's default applies) and every declared known mode", () => {
    expect(editPlanModeRefusal(undefined, phase1)).toBeNull()
    for (const m of ["tighten", "clips", "chapters"]) expect(editPlanModeRefusal(m, phase1), m).toBeNull()
    expect(editPlanModeRefusal("trailer", withTrailer)).toBeNull()
  })

  it("refuses a known mode the server has not declared", () => {
    expect(editPlanModeRefusal("trailer", phase1)).toBe(editPlanModeRefusalMessage("trailer"))
  })

  it("refuses an unknown mode, even one a plugin declares", () => {
    expect(editPlanModeRefusal("montage", phase1)).toBe(editPlanModeRefusalMessage("montage"))
    expect(editPlanModeRefusal("montage", editPlanModesOf({ editPlanModes: ["montage"] }))).toBe(
      editPlanModeRefusalMessage("montage"),
    )
    expect(editPlanModeRefusal("Tighten", phase1)).toBe(editPlanModeRefusalMessage("Tighten"))
  })

  it("refuses a mode that is not a string, naming the value it got", () => {
    expect(editPlanModeRefusal(42, phase1)).toBe(editPlanModeRefusalMessage("42"))
    expect(editPlanModeRefusal(null, phase1)).toBe(editPlanModeRefusalMessage("null"))
    expect(editPlanModeRefusal(["clips"], phase1)).toBe(editPlanModeRefusalMessage('["clips"]'))
  })

  // An empty Text node feeding the field, or `"mode": ""` in workflow JSON:
  // the message must still read as a sentence, not " mode is not available…".
  it("names an empty or blank mode instead of quoting nothing", () => {
    for (const blank of ["", " ", "\t\n"]) {
      expect(editPlanModeRefusal(blank, phase1), JSON.stringify(blank)).toBe(
        "An empty mode is not available on this server yet. Choose another mode, or try again after the next update. You were not charged.",
      )
    }
  })

  it("quotes at most 64 characters of the value", () => {
    const msg = editPlanModeRefusal("x".repeat(500), phase1)!
    expect(msg).toBe(editPlanModeRefusalMessage(`${"x".repeat(64)}…`))
  })
})

describe("withEditPlanModeGate", () => {
  it("refuses a trailer job when the plugin does not declare trailer, without running the plugin", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, declared({}))
    const err = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/trailer/i)
    expect(inner).not.toHaveBeenCalled()
  })

  it("refuses an unknown or non-string mode without running the plugin", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, declared({ editPlanModes: ["montage"] }))
    for (const mode of ["montage", 7, null]) {
      const err = await gated["edit-plan"]!(jobIn(mode), ctx).then(() => null, (e: unknown) => e)
      expect(isDeterministicJobError(err), String(mode)).toBe(true)
      expect((err as Error).message).toBe(editPlanModeRefusal(mode, editPlanModesOf({})))
    }
    expect(inner).not.toHaveBeenCalled()
  })

  it("runs a trailer job when the plugin declares trailer", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate(
      { "edit-plan": inner as HandlerFn },
      declared({ editPlanModes: ["tighten", "clips", "chapters", "trailer"] }),
    )
    await gated["edit-plan"]!(jobIn("trailer"), ctx)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("runs every Phase-1 mode on an older plugin", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, declared({}))
    for (const mode of ["tighten", "clips", "chapters"]) await gated["edit-plan"]!(jobIn(mode), ctx)
    expect(inner).toHaveBeenCalledTimes(3)
  })

  it("keeps the handler's own liveness budget and leaves other job types alone", () => {
    const budget = () => 123
    const inner = Object.assign(vi.fn(async () => undefined), { livenessBudgetMs: budget }) as HandlerFn
    const other = vi.fn(async () => undefined) as HandlerFn
    const gated = withEditPlanModeGate({ "edit-plan": inner, "apply-edl": other }, declared({}))
    expect(gated["edit-plan"]!.livenessBudgetMs).toBe(budget)
    expect(gated["apply-edl"]).toBe(other)
  })

  it("adds nothing when no plugin handles edit-plan (community: the relay serves it)", () => {
    const relay = vi.fn(async () => undefined) as HandlerFn
    expect(withEditPlanModeGate({}, declared({}))).toEqual({})
    expect(withEditPlanModeGate({ "video-analysis": relay }, declared({}))).toEqual({ "video-analysis": relay })
  })

  // Round 6 (decided 2026-10-06): a connected self-host plans what nodaro.ai
  // plans, and nodaro.ai's answer can change while the worker runs — so the
  // gate asks per job, never once when the map is built.
  it("asks which modes are plannable on every job, not when the map is built", async () => {
    const inner = vi.fn(async () => undefined)
    let modes = editPlanModesOf({})
    const resolve = vi.fn(async (): Promise<EditPlanModesAnswer> => ({ modes, source: "nodaro.ai" }))
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, resolve)
    expect(resolve).not.toHaveBeenCalled()
    const refused = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(refused)).toBe(true)
    modes = editPlanModesOf({ editPlanModes: ["trailer"] })
    await gated["edit-plan"]!(jobIn("trailer"), ctx)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it("fails closed to the original modes when the resolver throws", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, async () => {
      throw new Error("boom")
    })
    const err = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("trailer"))
    await gated["edit-plan"]!(jobIn("clips"), ctx)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  // Round 7 (decided 2026-10-06): a connected self-host that can't reach
  // nodaro.ai to learn its modes has met a TEMPORARY error. The job takes the
  // retryable path (a plain error the queue retries under its own policy),
  // never DeterministicJobError: refusing an unsupported mode stays with
  // nodaro.ai's own answer.
  it("fails a trailer job RETRYABLY with \"could not reach nodaro.ai\" when nodaro.ai can't be reached", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, unreachable)
    const err = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe("could not reach nodaro.ai")
    expect(NODARO_UNREACHABLE_MESSAGE).toBe("could not reach nodaro.ai")
    expect(isDeterministicJobError(err)).toBe(false)
    expect(inner).not.toHaveBeenCalled()
  })

  it("still runs the original three modes, and still refuses an unknown mode permanently, during an outage", async () => {
    const inner = vi.fn(async () => undefined)
    const gated = withEditPlanModeGate({ "edit-plan": inner as HandlerFn }, unreachable)
    for (const mode of ["tighten", "clips", "chapters"]) await gated["edit-plan"]!(jobIn(mode), ctx)
    expect(inner).toHaveBeenCalledTimes(3)
    const err = await gated["edit-plan"]!(jobIn("montage"), ctx).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("montage"))
  })

  it("refuses trailer PERMANENTLY when nodaro.ai answered and does not plan it", async () => {
    const gated = withEditPlanModeGate({ "edit-plan": vi.fn(async () => undefined) as HandlerFn }, async () => ({
      modes: editPlanModesOf({}),
      source: "nodaro.ai" as const,
    }))
    const err = await gated["edit-plan"]!(jobIn("trailer"), ctx).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(editPlanModeRefusalMessage("trailer"))
  })
})

describe("editPlanModeVerdict", () => {
  const phase1 = editPlanModesOf({})
  it("plans a plannable mode, whoever answered", () => {
    expect(editPlanModeVerdict("clips", { modes: phase1, source: "nodaro.ai-unreachable" })).toEqual({ kind: "plan" })
    expect(editPlanModeVerdict(undefined, { modes: phase1, source: "server" })).toEqual({ kind: "plan" })
  })

  it("names an outage only for a KNOWN mode nodaro.ai could not be asked about", () => {
    expect(editPlanModeVerdict("trailer", { modes: phase1, source: "nodaro.ai-unreachable" })).toEqual({
      kind: "nodaro-unreachable",
    })
    expect(editPlanModeVerdict("montage", { modes: phase1, source: "nodaro.ai-unreachable" })).toEqual({
      kind: "refuse",
      message: editPlanModeRefusalMessage("montage"),
    })
  })

  it("refuses when the server or nodaro.ai answered without the mode", () => {
    for (const source of ["server", "nodaro.ai"] as const) {
      expect(editPlanModeVerdict("trailer", { modes: phase1, source })).toEqual({
        kind: "refuse",
        message: editPlanModeRefusalMessage("trailer"),
      })
    }
  })
})
