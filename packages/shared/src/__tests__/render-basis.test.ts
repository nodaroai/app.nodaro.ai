import { describe, it, expect } from "vitest"
// Through the package index: both engines stamp a render with these, and the
// review inspector compares a take's stamps with them.
import {
  editPlanBasis,
  renderClipKey,
  renderPlanBasis,
  renderPlanValue,
  renderReadBasis,
  renderResultStamp,
  renderSettingsBasis,
} from "../index.js"

const HEX = /^[0-9a-f]{16}$/

const clip = (inMs: number, outMs: number, meta?: Record<string, unknown>) => ({
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
  segments: [{ id: `s${inMs}`, inMs, outMs, video: "A" }],
  ...(meta ? { meta } : {}),
})

describe("renderResultStamp — the two bases a render carries", () => {
  it("keeps a plan basis and a render basis of 16 lowercase hex digits", () => {
    expect(renderResultStamp({ quality: "final", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210" })).toEqual({
      quality: "final",
      planBasis: "0123456789abcdef",
      renderBasis: "fedcba9876543210",
    })
  })

  it("drops a basis that is not 16 lowercase hex digits", () => {
    for (const bad of ["", "0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "g123456789abcdef", 12, null]) {
      expect(renderResultStamp({ planBasis: bad, renderBasis: bad })).toEqual({})
    }
  })
})

describe("renderReadBasis — the plan value a render read, without its meta (R2 a)", () => {
  it("is the plan basis of the value with its top-level meta removed", () => {
    const value = clip(0, 1000, { title: "Why remote teams fail", hook: "Nobody tells you" })
    const { meta: _meta, ...rest } = value
    expect(renderReadBasis(value)).toBe(editPlanBasis(rest))
    expect(renderReadBasis(value)).toMatch(HEX)
  })

  it("ignores an edited hook, and nothing else", () => {
    expect(renderReadBasis(clip(0, 1000, { hook: "a" }))).toBe(renderReadBasis(clip(0, 1000, { hook: "b" })))
    expect(renderReadBasis(clip(0, 1000, { hook: "a" }))).toBe(renderReadBasis(clip(0, 1000)))
    expect(renderReadBasis(clip(0, 1000))).not.toBe(renderReadBasis(clip(0, 1001)))
  })

  it("reads a clip given as JSON text exactly as the object, whatever its key order", () => {
    const value = clip(2000, 3000, { hook: "x" })
    expect(renderReadBasis(JSON.stringify(value))).toBe(renderReadBasis(value))
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(value).reverse())))
    expect(renderReadBasis(reordered)).toBe(renderReadBasis(value))
  })

  it("names nothing for a value that is not one plan object", () => {
    expect(renderReadBasis(undefined)).toBeUndefined()
    expect(renderReadBasis("")).toBeUndefined()
    expect(renderReadBasis("not json")).toBeUndefined()
    expect(renderReadBasis([clip(0, 1000)])).toBeUndefined()
    expect(renderReadBasis(42)).toBeUndefined()
  })

  // Stored takes carry this value: the algorithm must never move under them.
  it("is pinned", () => {
    expect(renderReadBasis(clip(0, 1000, { hook: "pinned" }))).toBe("4d88472ee5ee3526")
  })
})

describe("renderSettingsBasis — the render's own settings (R19 a)", () => {
  const sources = ["https://media.test/a.mp4"]

  it("changes with the crossfade, the output and the effective sources", () => {
    const base = renderSettingsBasis({ output: "video", crossfadeMs: 0 }, sources)
    expect(base).toMatch(HEX)
    expect(renderSettingsBasis({ output: "video", crossfadeMs: 120 }, sources)).not.toBe(base)
    expect(renderSettingsBasis({ output: "audio", crossfadeMs: 0 }, sources)).not.toBe(base)
    expect(renderSettingsBasis({ output: "video", crossfadeMs: 0 }, ["https://media.test/b.mp4"])).not.toBe(base)
  })

  it("reads the settings as the render does: any output but audio is video, a missing crossfade is a hard cut, ms are whole", () => {
    const base = renderSettingsBasis({ output: "video", crossfadeMs: 0 }, sources)
    expect(renderSettingsBasis({}, sources)).toBe(base)
    expect(renderSettingsBasis({ output: "gif", crossfadeMs: undefined }, sources)).toBe(base)
    expect(renderSettingsBasis({ output: "video", crossfadeMs: -5 }, sources)).toBe(base)
    expect(renderSettingsBasis({ output: "video", crossfadeMs: 120.4 }, sources)).toBe(
      renderSettingsBasis({ output: "video", crossfadeMs: 120 }, sources),
    )
  })

  it("is pinned", () => {
    expect(renderSettingsBasis({ output: "audio", crossfadeMs: 250 }, sources)).toBe("36f72984453dd8df")
  })
})

describe("renderPlanValue — the plan value a render iteration read", () => {
  const PLAN = [clip(0, 1000), clip(2000, 3000), clip(4000, 5000)].map((c) => JSON.stringify(c))
  const each = (data: Record<string, unknown> = {}) => ({
    edge: { source: "plan", target: "render", targetHandle: "edl", data: { outputMode: "each", ...data } },
    each: true,
    source: "edit-plan",
  })

  it("is the clip the row reads, picked by the wire's selector — the clip renderClipKey names", () => {
    const hops = [each({ selectorMode: "list", listExpression: "2,3" })]
    expect(renderPlanValue(PLAN, 0, hops)).toBe(PLAN[1])
    expect(renderPlanValue(PLAN, 1, hops)).toBe(PLAN[2])
    expect(renderClipKey(PLAN, 1, hops)).toBe("4000-5000")
  })

  it("is a Tighten plan itself, the one EDL every wire hands on", () => {
    const tighten = clip(0, 9000)
    expect(renderPlanValue(tighten, undefined, [each()])).toBe(tighten)
    expect(renderClipKey(tighten, undefined, [each()])).toBeUndefined()
  })

  it("names nothing for a dropped clip's empty row", () => {
    expect(renderPlanValue(["", PLAN[1]], 0, [each()])).toBeUndefined()
  })
})

describe("renderPlanBasis — stamped only when every pass-through hop ran with the render (R1 a)", () => {
  const nodes = [
    { id: "plan", type: "edit-plan" },
    { id: "tp-send", type: "teleport-send" },
    { id: "tp-recv", type: "teleport-receive" },
    { id: "switch", type: "camera-switch" },
    { id: "render", type: "apply-edl" },
  ]
  const tighten = clip(0, 9000, { title: "Episode 12" })
  const PLAN = [clip(0, 1000), clip(2000, 3000)].map((c) => JSON.stringify(c))
  const direct = [{ source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }]
  const viaSwitch = [
    { source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl" },
    { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
  ]
  const viaTeleportAndSwitch = [
    { source: "plan", sourceHandle: "edl", target: "tp-send", targetHandle: "in" },
    { source: "tp-send", target: "tp-recv" },
    { source: "tp-recv", target: "switch", targetHandle: "edl" },
    { source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
  ]
  const none = new Set<string>()

  it("a render wired straight to the plan is always stamped, with the value it read", () => {
    expect(renderPlanBasis("render", nodes, direct, () => tighten, undefined, none)).toBe(renderReadBasis(tighten))
    expect(renderPlanBasis("render", nodes, direct, () => PLAN, 1, none)).toBe(renderReadBasis(PLAN[1]))
  })

  it("behind Camera Switch, only when the switch ran in the render's run", () => {
    expect(renderPlanBasis("render", nodes, viaSwitch, () => tighten, undefined, none)).toBeUndefined()
    expect(renderPlanBasis("render", nodes, viaSwitch, () => tighten, undefined, new Set(["render"]))).toBeUndefined()
    expect(renderPlanBasis("render", nodes, viaSwitch, () => tighten, undefined, new Set(["switch", "render"]))).toBe(
      renderReadBasis(tighten),
    )
    expect(renderPlanBasis("render", nodes, viaSwitch, () => PLAN, 0, new Set(["switch"]))).toBe(renderReadBasis(PLAN[0]))
  })

  it("a teleport is not a hop that runs: the switch behind it decides", () => {
    expect(renderPlanBasis("render", nodes, viaTeleportAndSwitch, () => tighten, undefined, new Set(["switch"]))).toBe(
      renderReadBasis(tighten),
    )
    expect(renderPlanBasis("render", nodes, viaTeleportAndSwitch, () => tighten, undefined, none)).toBeUndefined()
  })

  it("names nothing with no plan behind the render, or no value the iteration read", () => {
    expect(renderPlanBasis("render", nodes, [], () => tighten, undefined, none)).toBeUndefined()
    expect(renderPlanBasis("render", nodes, direct, () => undefined, undefined, none)).toBeUndefined()
    expect(renderPlanBasis("render", nodes, direct, () => ["", PLAN[1]], 0, none)).toBeUndefined()
  })
})
