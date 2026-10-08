/**
 * Speaker View's quick strip (U3, SV10): the strip REMOVES a layout the aspect
 * or the speaker count rules out, GREYS a switch it rules out (decided
 * 2026-10-08), reads the edit wired
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
const JUMP_ONE_CAM = { version: 1, clock: "master", sources: [src("w")], segments: [seg("s0", 0, "w", "H"), seg("s1", 8, "w", "G")] }
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

  describe("Pan (decided 2026-10-08, round 2)", () => {
    const PAN_REASON = tx("speakerView.reason.noSameCamera", { changes: 2 })

    it("is greyed, with its reason, where no speaker change stays on one camera, not removed", () => {
      const opts = optionsOf(switchControl, {}, ctxWith(THREE))
      expect(values(opts).slice(0, 3)).toEqual(["cut", "pan", "zoom"])
      expect(opts.find((o) => o.value === "pan")).toMatchObject({ disabled: true, reason: PAN_REASON })
      expect(PAN_REASON.endsWith(".")).toBe(true)
    })

    it("is available where a speaker change stays on one camera", () => {
      const pan = optionsOf(switchControl, {}, ctxWith(ONE_CAM)).find((o) => o.value === "pan")
      expect(pan?.disabled).toBeFalsy()
      expect(pan?.reason).toBeUndefined()
    })

    it("keeps a stored Pan resolvable (greyed), so the strip never rewrites it", () => {
      const opts = optionsOf(switchControl, { switchType: "pan" }, ctxWith(THREE))
      expect(opts.find((o) => o.value === "pan")).toMatchObject({ disabled: true })
    })

    it("a fixed multi-slot layout greys Pan and Zoom with the slots-fixed reason", () => {
      const opts = optionsOf(switchControl, { layout: "grid" }, ctxWith(ONE_CAM))
      for (const id of ["pan", "zoom"]) expect(opts.find((o) => o.value === id)).toMatchObject({ disabled: true, reason: tx("speakerView.reason.slotsFixed", { layout: tx("speakerView.layout.grid") }) })
      expect(opts.find((o) => o.value === "cut")?.disabled).toBeFalsy()
    })

    it("Cut is never greyed", () => {
      expect(optionsOf(switchControl, { layout: "grid" }, ctxWith(THREE)).find((o) => o.value === "cut")?.disabled).toBeFalsy()
    })
  })

  it("offers the crossfades after the basics, labelled by the transition, where a speaker change crosses a clock jump", () => {
    const opts = optionsOf(switchControl, {}, ctxWith(JUMP_ONE_CAM))
    const fade = opts.find((o) => o.value === "xfade:fade")
    expect(fade).toMatchObject({ label: "Fade", description: tx("speakerView.switch.crossfade") })
    expect(fade?.disabled).toBeFalsy()
    expect(opts.every((o) => ["cut", "pan", "zoom"].includes(o.value) || o.value.startsWith("xfade:"))).toBe(true)
    expect(opts.filter((o) => o.disabled)).toEqual([])
  })

  it("offers the crossfades with no edit wired (nothing known yet)", () => {
    const opts = optionsOf(switchControl, {})
    expect(opts.some((o) => o.value === "xfade:fade" && !o.disabled)).toBe(true)
  })

  describe("when no speaker change crosses a clock jump (decided 2026-10-08)", () => {
    const REASON = tx("speakerView.reason.noClockJump", { changes: 1 })

    it("greys the crossfade, with its reason, as ONE row rather than a wall of them", () => {
      const opts = optionsOf(switchControl, {}, ctxWith(ONE_CAM))
      const grey = opts.filter((o) => o.disabled)
      expect(grey).toHaveLength(1)
      expect(grey[0]).toMatchObject({ label: tx("speakerView.switch.crossfade"), reason: REASON, disabled: true })
      expect(opts.filter((o) => o.value.startsWith("xfade:") && !o.disabled)).toEqual([])
    })

    it("keeps a stored crossfade resolvable (greyed), so the strip never rewrites the value", () => {
      const opts = optionsOf(switchControl, { switchType: "xfade:wipe-left" }, ctxWith(ONE_CAM))
      const stored = opts.find((o) => o.value === "xfade:wipe-left")
      expect(stored).toMatchObject({ label: "Wipe Left", disabled: true, reason: REASON })
      expect(opts.filter((o) => o.disabled)).toHaveLength(1)
    })

    it("a disabled row carries a value no setting can hold, so it can never be written", () => {
      const grey = optionsOf(switchControl, {}, ctxWith(ONE_CAM)).find((o) => o.disabled)!
      expect(grey.value.startsWith("xfade:")).toBe(false)
    })
  })

  it("snaps a stale layout to the normalizer's answer, not to the first option", () => {
    const snap = layoutControl.snap!
    expect(snap("side-by-side", { layout: "side-by-side", targetAspect: "9:16" })).toBe("stacked")
    expect(snap("stacked", { layout: "stacked", targetAspect: "16:9" })).toBe("side-by-side")
    expect(snap("side-by-side", { layout: "side-by-side" }, ctxWith(THREE))).toBe("grid")
  })
})
