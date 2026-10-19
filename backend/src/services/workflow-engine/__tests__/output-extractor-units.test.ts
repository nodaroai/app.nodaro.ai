// @test-watches tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * A worker unit's JSON (look) outputs on the server's engine (decided
 * 2026-10-18), over tools/units/__fixtures__/unit-json-outputs.json: a
 * finished job's output_data becomes the node output (the per-pip carrier
 * `unitOutputs` and the primary's `json`), each pip hands on its own JSON
 * string, and a node holding the editor's landing seeds the same carrier. The
 * editor's half (frontend/src/lib/__tests__/json-run-result-units.test.ts)
 * lands the same cases. The unit is the fixture's JSON-only worker, added
 * through the server's one door to the unit descriptors.
 */
vi.mock("../../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/unit-descriptors.js")>()
  const { readFileSync: read } = await import("node:fs")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const unit = JSON.parse(read(new URL("../../../../../tools/units/__fixtures__/unit-json-outputs.json", import.meta.url), "utf8")).unit
  const map = { ...descriptor, type: unit.type, label: unit.label, outputType: unit.outputType, outputs: unit.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: unit.outputs } }
  const units = [...real.UNIT_NODE_DESCRIPTORS, map as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  const unitDescriptorOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DESCRIPTORS: units,
    unitDescriptorOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDescriptorOf(t), h),
  }
})

const { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } = await import("../output-extractor.js")

interface Case {
  readonly name: string
  readonly outputData: Record<string, unknown>
  readonly nodeOutput: { readonly unitOutputs?: Record<string, string>; readonly json?: unknown }
  readonly landing: Record<string, unknown> | null
}
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")) as {
  readonly unit: { readonly type: string; readonly outputs: ReadonlyArray<{ readonly id: string }> }
  readonly cases: ReadonlyArray<Case>
}
const TYPE = FIXTURE.unit.type

describe("a worker unit's JSON outputs — the server's engine", () => {
  for (const c of FIXTURE.cases) {
    it(`${c.name}: the job's node output`, () => {
      expect(buildNodeOutputFromJobData(c.outputData, TYPE)).toEqual(c.nodeOutput)
    })
    it(`${c.name}: each pip hands on its own JSON string`, () => {
      const output = buildNodeOutputFromJobData(c.outputData, TYPE)
      for (const { id } of FIXTURE.unit.outputs) expect(getPrimaryOutput(output, TYPE, id), id).toBe(c.nodeOutput.unitOutputs?.[id])
      // An edge naming no pip reads the first output.
      expect(getPrimaryOutput(output, TYPE, null)).toBe(c.nodeOutput.unitOutputs?.[FIXTURE.unit.outputs[0]!.id])
    })
    it(`${c.name}: a node holding the editor's landing seeds the same output`, () => {
      const saved = extractSavedNodeOutput({ id: "m", type: TYPE, data: { label: "Map", ...(c.landing ?? {}) } })
      expect(saved).toEqual(Object.keys(c.nodeOutput).length ? c.nodeOutput : undefined)
    })
  }

  it("a media worker unit's job is read exactly as before (no unitOutputs)", () => {
    const out = buildNodeOutputFromJobData({ videoUrl: "https://r2/v.mp4", json: { a: 1 } }, "remove-audio")
    expect(out.unitOutputs).toBeUndefined()
    expect(out.videoUrl).toBe("https://r2/v.mp4")
  })
})
