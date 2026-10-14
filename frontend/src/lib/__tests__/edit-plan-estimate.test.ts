// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { EDIT_PLAN_LEGACY_DURATION_KEYS, resolveEditPlanEstimateDurationSec } from "../edit-plan-estimate"

const node = (id: string, data: Record<string, unknown> = {}, type?: string) => ({ id, type, data })
const edge = (source: string, targetHandle: string | null, target = "ep") => ({ source, target, targetHandle })

describe("resolveEditPlanEstimateDurationSec — master source", () => {
  it("is undefined (→ ceiling bucket) when nothing is wired", () => {
    const ep = node("ep")
    expect(resolveEditPlanEstimateDurationSec(ep, [ep], [])).toBeUndefined()
  })

  it("uses the master source's known length (audio-master metadata lane)", () => {
    const ep = node("ep")
    const audio = node("a", { metadata: { durationSeconds: 45 * 60 } })
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, audio], [edge("a", "sources")])).toBe(45 * 60)
  })

  it("honors the master-audio role over wire order", () => {
    const ep = node("ep", { sourceConfig: { cam: { role: "camera" }, mic: { role: "master-audio" } } })
    const cam = node("cam", { duration: 10 * 60 })
    const mic = node("mic", { metadata: { durationSeconds: 80 * 60 } })
    const edges = [edge("cam", "sources"), edge("mic", "sources")]
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, cam, mic], edges)).toBe(80 * 60)
  })

  it("honors sourceOrder when no role is set", () => {
    const ep = node("ep", { sourceOrder: ["b", "a"] })
    const a = node("a", { duration: 10 * 60 })
    const b = node("b", { duration: 70 * 60 })
    const edges = [edge("a", "sources"), edge("b", "sources")]
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, a, b], edges)).toBe(70 * 60)
  })

  it("ignores edges into other handles and other nodes", () => {
    const ep = node("ep")
    const a = node("a", { duration: 600 })
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, a], [edge("a", "transcript")])).toBeUndefined()
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, a], [edge("a", "sources", "other")])).toBeUndefined()
  })
})

describe("resolveEditPlanEstimateDurationSec — never under-quotes", () => {
  // The reserve falls back to THIS run's transcript; the browser only holds the
  // PREVIOUS run's. Reusing a workflow for a new, longer episode is the normal
  // case and Execute-All prechecks the balance against this estimate — so a
  // borrowed length would pass the precheck, charge Transcribe, then fail the
  // Edit Plan reserve mid-run. Unknown master ⇒ ceiling, whatever is wired.
  it("a URL master with a wired transcript still resolves to undefined", () => {
    const ep = node("ep", { transcript: { words: [{ endMs: 12 * 60_000 }] } })
    const urlMaster = node("ref", { audioUrl: "https://youtu.be/new-100-minute-episode" }, "reference-audio")
    const lastWeeks = { words: [{ text: "bye", startMs: 0, endMs: 12 * 60_000 }] }
    const tr = node("tr", { generatedJson: lastWeeks, generatedResults: [{ transcript: lastWeeks }] }, "transcribe")
    const edges = [edge("ref", "sources"), edge("tr", "transcript")]
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, urlMaster, tr], edges)).toBeUndefined()
  })
})

describe("resolveEditPlanEstimateDurationSec — teleport transparency", () => {
  it("reads a teleported master at its ORIGIN, like both run resolvers", () => {
    const ep = node("ep")
    const audio = node("a", { metadata: { durationSeconds: 50 * 60 } }, "upload-audio")
    const send = node("ts", { channel: "c" }, "teleport-send")
    const recv = node("tr", { channel: "c" }, "teleport-receive")
    const edges = [edge("a", "in", "ts"), edge("ts", null, "tr"), edge("tr", "sources")]
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, audio, send, recv], edges)).toBe(50 * 60)
  })

  it("terminates on a teleport cycle and on a dangling teleport", () => {
    const ep = node("ep")
    const t1 = node("t1", {}, "teleport-receive")
    const t2 = node("t2", {}, "teleport-send")
    const cyc = [edge("t2", null, "t1"), edge("t1", null, "t2"), edge("t1", "sources")]
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, t1, t2], cyc)).toBeUndefined()
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, t1], [edge("t1", "sources")])).toBeUndefined()
  })
})

describe("legacy design-time duration keys", () => {
  it("resolves a producer that carries its length under a legacy key", () => {
    const ep = node("ep")
    const render = node("rv", { durationSeconds: 30 }, "render-video")
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, render], [edge("rv", "sources")])).toBe(30)
  })

  it("the shared reserve-parity read still wins over a legacy key", () => {
    const ep = node("ep")
    const src = node("s", { duration: 600, durationSeconds: 5 })
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, src], [edge("s", "sources")])).toBe(600)
  })

  it("rejects non-numeric / non-positive values rather than bucketing on them", () => {
    const ep = node("ep")
    // `videoDuration` is a STRING on ReferenceAudioData — a dead default, never a length.
    const ref = node("ref", { videoDuration: "", durationSeconds: 0, sourceDurationSec: Number.NaN })
    expect(resolveEditPlanEstimateDurationSec(ep, [ep, ref], [edge("ref", "sources")])).toBeUndefined()
  })

  // A lookup key that no node writes is silently dead — the read just falls
  // through to the ceiling. Pin that each key is a real node-data field, so a
  // rename breaks a test instead of quietly tripling a quote.
  it("every legacy key EXISTS as a field on some node data type", () => {
    const nodeTypes = readFileSync(resolve(__dirname, "../../types/nodes.ts"), "utf8")
    const missing = EDIT_PLAN_LEGACY_DURATION_KEYS.filter((k) => !new RegExp(`^\\s+${k}\\??:`, "m").test(nodeTypes))
    expect(missing, `dead lookup keys — nothing declares these: ${missing.join(", ")}`).toEqual([])
  })
})
