/**
 * Speaker View's quick strip (U3, SV10): the strip REMOVES a choice the aspect
 * or the speaker count rules out (the panel greys it), reads the edit wired
 * into the node through the options' graph context, and snaps a stale stored
 * layout the way the normalizer does — not to "the first option".
 */
import { describe, it, expect } from "vitest"
import { getQuickConfigs, type QuickConfigContext, type QuickConfigControl } from "../node-quick-configs"
import { tx } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string) => ({ id: `${source}-${target}`, source, target, targetHandle }) as unknown as WorkflowEdge
const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const THREE = { version: 1, clock: "master", sources: [src("a"), src("b"), src("c")], segments: [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")] }
const ONE_CAM = { version: 1, clock: "master", sources: [src("w")], segments: [seg("s0", 0, "w", "H"), seg("s1", 5, "w", "G")] }

const controls = getQuickConfigs("speaker-view")
const layoutControl = controls.find((c) => c.field === "layout")!
const switchControl = controls.find((c) => c.field === "switchType")!
const optionsOf = (control: QuickConfigControl, data: Record<string, unknown>, ctx?: QuickConfigContext) =>
  typeof control.options === "function" ? control.options(data, ctx) : control.options

const ctxWith = (edl: unknown, extra: Record<string, unknown> = {}): QuickConfigContext => ({
  nodeId: "sv",
  nodes: [node("plan", "edit-plan", { generatedJson: edl }), node("sv", "speaker-view", extra)],
  edges: [edge("plan", "sv", "edl")],
})
const values = (opts: ReadonlyArray<{ value: string }>) => opts.map((o) => o.value)

describe("the speaker-view quick strip", () => {
  it("has a layout and a switch control, both reading the graph", () => {
    expect(controls.map((c) => c.field)).toEqual(["layout", "switchType"])
    expect(controls.every((c) => c.needsGraph)).toBe(true)
  })

  it("lists only the layouts the aspect allows when no edit is wired", () => {
    expect(values(optionsOf(layoutControl, { targetAspect: "9:16" }))).toEqual(["auto", "single", "stacked", "grid", "pip"])
    expect(values(optionsOf(layoutControl, { targetAspect: "16:9" }))).toEqual(["auto", "single", "side-by-side", "grid", "pip"])
  })

  it("removes what the wired edit's speaker count rules out (a 3-speaker edit has no side by side or pip)", () => {
    const opts = values(optionsOf(layoutControl, { targetAspect: "16:9" }, ctxWith(THREE)))
    expect(opts).toEqual(["auto", "single", "grid"])
  })

  it("labels the layouts in the interface language", () => {
    expect(optionsOf(layoutControl, {}).map((o) => o.label)).toContain(tx("speakerView.layout.single"))
  })

  it("offers Pan only where a speaker change stays on one camera", () => {
    expect(values(optionsOf(switchControl, {}, ctxWith(THREE))).slice(0, 2)).toEqual(["cut", "zoom"])
    expect(values(optionsOf(switchControl, {}, ctxWith(ONE_CAM))).slice(0, 3)).toEqual(["cut", "pan", "zoom"])
  })

  it("always offers the crossfades after the basics, labelled by the transition", () => {
    const opts = optionsOf(switchControl, {}, ctxWith(ONE_CAM))
    const fade = opts.find((o) => o.value === "xfade:fade")
    expect(fade).toMatchObject({ label: "Fade", description: tx("speakerView.switch.crossfade") })
    expect(opts.every((o) => ["cut", "pan", "zoom"].includes(o.value) || o.value.startsWith("xfade:"))).toBe(true)
  })

  it("snaps a stale layout to the normalizer's answer, not to the first option", () => {
    const snap = layoutControl.snap!
    expect(snap("side-by-side", { layout: "side-by-side", targetAspect: "9:16" })).toBe("stacked")
    expect(snap("stacked", { layout: "stacked", targetAspect: "16:9" })).toBe("side-by-side")
    expect(snap("side-by-side", { layout: "side-by-side" }, ctxWith(THREE))).toBe("grid")
  })
})
