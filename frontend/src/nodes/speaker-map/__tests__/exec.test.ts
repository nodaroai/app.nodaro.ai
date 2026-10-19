// @test-watches tools/units/__fixtures__/speaker-map-run-rules.json
/**
 * Speaker Map's canvas run: the body payload.test.ts pins for a server run
 * (the cameras in `sourceOrder`, a master / wide no longer wired dropped, the
 * lead clamped), posted through api.ts and polled as a JSON node — and every
 * refusal before any request, in the server's own words (both engines call
 * speakerMapRunInputs / speakerMapRunProblemText, @nodaro/render-rules). The
 * editor half of the run-rules parity reads the fixture the route's half
 * (backend/src/nodes/speaker-map/__tests__/run-rules-parity.test.ts) reads.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), speakerMapApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ speakerMapApi: m.speakerMapApi }))

import { speakerMapRunInputs, speakerMapRunProblemText } from "@nodaro/render-rules"
import { executor } from "../exec"

type Row = { id: string; url: string; kind: "video" | "audio" }
const row = (id: string, kind: Row["kind"] = "video"): Row => ({ id, url: `https://media.test/${id}.${kind === "video" ? "mp4" : "m4a"}`, kind })
const TRANSCRIPT = { text: "hi there", words: [{ text: "hi", startMs: 0, endMs: 500, speaker: "A" }, { text: "there", startMs: 1000, endMs: 1500, speaker: "B" }] }
const OFFSETS = { version: 1, reference: "cam1", offsets: [{ sourceId: "cam1", offsetMs: 0, confidence: 1 }, { sourceId: "cam2", offsetMs: 120, confidence: 0.9 }], notes: [] }
const wired = (over: Record<string, unknown> = {}) => ({ sources: [row("cam1"), row("cam2")], offsets: JSON.stringify(OFFSETS), transcript: JSON.stringify(TRANSCRIPT), ...over })

const nodeOf = (data: Record<string, unknown> = {}) =>
  ({ id: "map", type: "speaker-map", position: { x: 0, y: 0 }, data: { label: "Speaker Map", fieldMappings: {}, ...data } }) as unknown as WorkflowNode

function kit(unitInputs: Record<string, unknown> | undefined): UnitExecKit {
  return {
    inputs: unitInputs ? { unitInputs } : {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(),
    runJsonNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "{\"version\":1}" }),
    nodeRunError: vi.fn((key: string) => key),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
  } as unknown as UnitExecKit
}

beforeEach(() => {
  m.toastError.mockReset()
  m.speakerMapApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("speaker-map executor", () => {
  it("posts the wired recordings, offsets and transcript at the default 3 dB lead, and polls the job as a JSON node", async () => {
    const k = kit(wired())
    await expect(executor.execute(nodeOf(), k)).resolves.toBe("{\"version\":1}")
    expect(m.speakerMapApi).toHaveBeenCalledWith({ sources: [row("cam1"), row("cam2")], transcript: TRANSCRIPT, offsets: OFFSETS, marginDb: 3 }, "user-1")
    expect(k.runJsonNode).toHaveBeenCalledWith(expect.any(Function), "Speaker Map")
    expect(k.setUserPromptTemplate).toHaveBeenCalledWith(undefined)
  })

  it("the same body a server run sends: sourceOrder first, master and wide when wired, the lead as set", async () => {
    const k = kit(wired({ sources: [row("cam1"), row("cam2"), row("mic", "audio")] }))
    await executor.execute(nodeOf({ sourceOrder: ["mic", 7, "cam2"], masterSourceId: "mic", wideSourceId: "cam1", marginDb: 6 }), k)
    const sent = m.speakerMapApi.mock.calls[0]![0] as Record<string, unknown>
    expect((sent.sources as Row[]).map((s) => s.id)).toEqual(["mic", "cam2", "cam1"])
    expect(sent).toMatchObject({ masterSourceId: "mic", wideSourceId: "cam1", marginDb: 6 })
  })

  it("a master or wide no longer wired is dropped; offsets not wired are left out; a lead past the route's range is clamped, as a server run does", async () => {
    const { offsets: _o, ...noOffsets } = wired()
    for (const [given, clamped] of [[99, 30], [-2, 0], [Number.NaN, 3], ["6", 3]] as const) {
      m.speakerMapApi.mockClear()
      await executor.execute(nodeOf({ masterSourceId: "gone", wideSourceId: "also-gone", marginDb: given }), kit(noOffsets))
      const sent = m.speakerMapApi.mock.calls[0]![0] as Record<string, unknown>
      expect(sent.marginDb, String(given)).toBe(clamped)
      expect(Object.keys(sent).sort()).toEqual(["marginDb", "sources", "transcript"])
    }
  })

  it("never mutates the node's data or its inputs", async () => {
    const inputs = wired()
    const data = { sourceOrder: ["cam2"] }
    const before = JSON.stringify([inputs, data])
    await executor.execute(nodeOf(data), kit(inputs))
    expect(JSON.stringify([inputs, data])).toBe(before)
  })

  describe("refused before any request, in the server's words", () => {
    const refuses = async (unitInputs: Record<string, unknown> | undefined, message: string, data: Record<string, unknown> = {}) => {
      const k = kit(unitInputs)
      await expect(executor.execute(nodeOf(data), k)).rejects.toThrow(message)
      expect(m.toastError).toHaveBeenCalledWith(expect.stringContaining(message))
      expect(m.speakerMapApi).not.toHaveBeenCalled()
      expect(k.runJsonNode).not.toHaveBeenCalled()
      m.toastError.mockReset()
    }

    it("fewer than two recordings: one wired, none wired, or nothing wired at all", async () => {
      const msg = 'speaker-map: node "Speaker Map" needs at least 2 recordings — connect them to the Cameras input'
      await refuses(wired({ sources: [row("cam1")] }), msg)
      await refuses(wired({ sources: [] }), msg)
      await refuses(undefined, msg)
    })

    it("more than six recordings, or a List wired whole", async () => {
      await refuses(wired({ sources: ["a", "b", "c", "d", "e", "f", "g"].map((id) => row(id)) }), "takes at most 6 recordings — 7 are connected")
      await refuses(wired({ sources: [{ id: "list", url: "https://media.test/a.mp4, https://media.test/b.mp4", kind: "video" }] }), 'received several recordings joined into one from "list"')
    })

    it("the transcript: not wired, wired but empty, or without speaker labels", async () => {
      const { transcript: _t, ...noTranscript } = wired()
      await refuses(noTranscript, 'speaker-map: node "Speaker Map" needs a transcript')
      await refuses(wired({ transcript: "" }), 'speaker-map: node "Speaker Map" got nothing on its Transcript input — run the node wired to it first')
      await refuses(wired({ transcript: JSON.stringify({ text: "hi", words: [{ text: "hi", startMs: 0, endMs: 1000 }] }) }), "speaker-map: the transcript has no speaker labels")
    })

    it("the offsets: wired but empty, or not an Audio Sync result", async () => {
      await refuses(wired({ offsets: "" }), "got nothing on its Offsets input")
      await refuses(wired({ offsets: JSON.stringify({ text: "a transcript" }) }), "not an Audio Sync result on its Offsets input")
    })
  })
})

// The shared verdicts: the route answers 400 exactly where the run rules name a problem.
const F = JSON.parse(readFileSync(join(__dirname, "../../../../../tools/units/__fixtures__/speaker-map-run-rules.json"), "utf8")) as {
  transcript: unknown
  cases: Array<{ name: string; sources: Row[]; masterSourceId?: string; wideSourceId?: string; offsets?: unknown; problem: string | null }>
}

describe("the editor's run gives the route's verdict on every shared case (speaker-map-run-rules.json)", () => {
  it.each(F.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const unitInputs = { sources: c.sources, transcript: JSON.stringify(F.transcript), ...(c.offsets !== undefined ? { offsets: JSON.stringify(c.offsets) } : {}) }
    const data = { ...(c.masterSourceId ? { masterSourceId: c.masterSourceId } : {}), ...(c.wideSourceId ? { wideSourceId: c.wideSourceId } : {}) }
    const run = executor.execute(nodeOf(data), kit(unitInputs))
    if (c.problem === null) {
      await expect(run).resolves.toBeTypeOf("string")
      expect(m.speakerMapApi).toHaveBeenCalledWith(expect.objectContaining({ sources: c.sources, ...data }), "user-1")
    } else {
      const verdict = speakerMapRunInputs(unitInputs, data)
      expect("problem" in verdict && verdict.problem.code).toBe(c.problem)
      if (!("problem" in verdict)) return
      await expect(run).rejects.toThrow(speakerMapRunProblemText(verdict.problem, { type: "speaker-map", label: "Speaker Map" }))
      expect(m.speakerMapApi).not.toHaveBeenCalled()
    }
  })
})
