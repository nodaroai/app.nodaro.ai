// @test-watches tools/units/__fixtures__/unit-json-outputs.json tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * A worker unit's JSON (look) outputs on the editor's lanes (decided
 * 2026-10-18), over tools/units/__fixtures__/unit-json-outputs.json: the
 * canvas run (runJsonNode, over the job row) and every server-run lane (over
 * the job row, or over the server's node output) write the same patch. The
 * server's half (backend/src/services/workflow-engine/__tests__/output-extractor-units.test.ts)
 * pins `nodeOutput`. The unit is the fixture's JSON-only worker, added through
 * the editor's one door to the unit definitions.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { readFileSync: read } = await import("node:fs")
  const { resolve } = await import("node:path")
  const { unitInputHandleIn } = await import("@nodaro/render-rules")
  const { definition } = await import("../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  const json = JSON.parse(read(resolve(__dirname, "../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")).unit
  const map = { ...definition, type: json.type, label: json.label, picker: null, outputs: json.outputs.map((o: { id: string }) => o.id), handles: { inputs: [], outputs: json.outputs } }
  const units = [...real.UNIT_NODE_DEFINITIONS, map as unknown as (typeof real.UNIT_NODE_DEFINITIONS)[number]]
  const unitDefinitionOf = (t: string | undefined) => units.find((u) => u.type === t)
  return {
    ...real,
    UNIT_NODE_DEFINITIONS: units,
    unitDefinitionOf,
    unitInputHandleOf: (t: string | undefined, h: string | null | undefined) => unitInputHandleIn(unitDefinitionOf(t), h),
  }
})

import { holdsJsonRunResult, isJsonRunResultType, jobRunOutput, jsonRunResultPatch } from "../json-run-result"
import { getCompatibleNodes } from "../node-compatibility"
import { createUnitExecKit } from "@/components/editor/workflow-editor/unit-exec-kit"

interface Case {
  readonly name: string
  readonly outputData: Record<string, unknown>
  readonly nodeOutput: Record<string, unknown>
  readonly landing: Record<string, unknown> | null
  readonly cleared: readonly string[]
  readonly result: string
}
const FIXTURE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../tools/units/__fixtures__/unit-json-outputs.json"), "utf8")) as {
  readonly unit: { readonly type: string; readonly outputs: ReadonlyArray<{ readonly id: string; readonly from: string }> }
  readonly cases: ReadonlyArray<Case>
}
const TYPE = FIXTURE.unit.type

/** The patch is the case's landing, and each `cleared` field is written as undefined (emptied on the node). */
function expectLanding(patch: Record<string, unknown> | undefined, c: Case) {
  if (c.landing === null) return expect(patch).toBeUndefined()
  expect(patch).toEqual(c.landing)
  for (const k of c.cleared) expect(patch !== undefined && Object.hasOwn(patch, k) && patch[k] === undefined, `${k} cleared`).toBe(true)
}

describe("a worker unit's JSON outputs — the editor's lanes", () => {
  it("a JSON worker unit takes the shared JSON mapping; a use-case unit and a media worker do not", () => {
    expect(isJsonRunResultType(TYPE)).toBe(true)
    expect(isJsonRunResultType("tighten-episode")).toBe(false)
    expect(isJsonRunResultType("remove-audio")).toBe(false)
  })

  for (const c of FIXTURE.cases) {
    it(`${c.name}: a server run's node output`, () => {
      expectLanding(jsonRunResultPatch(TYPE, c.nodeOutput), c)
    })
    it(`${c.name}: a job row (a restored poll, a reconciled job)`, () => {
      expectLanding(jsonRunResultPatch(TYPE, jobRunOutput(TYPE, c.outputData)), c)
    })
    it(`${c.name}: the canvas run (runJsonNode)`, async () => {
      const pollJson = vi.fn(async () => "")
      const node = { id: "m1", type: TYPE, position: { x: 0, y: 0 }, data: { label: "Map" } } as never
      const ctx = { userId: "u1" } as never
      const kit = createUnitExecKit({
        node, ctx, inputs: {} as never, overrideMediaUrl: undefined,
        poll: vi.fn(), pollJson, setUserPromptTemplate: vi.fn(), getNodeData: () => undefined, updateNodeData: vi.fn(),
      })
      const start = async () => ({ jobId: "j1" })
      await kit.runJsonNode(start, "Fixture Map")
      expect(pollJson).toHaveBeenCalledWith("m1", start, expect.anything(), "Fixture Map", ctx)
      const landing = (pollJson.mock.calls[0] as unknown as [string, unknown, { fields: string[]; land: (od: Record<string, unknown>) => { patch: Record<string, unknown>; result: string } | undefined }])[2]
      expect(landing.fields).toEqual(FIXTURE.unit.outputs.map((o) => o.from))
      const landed = landing.land(c.outputData)
      expectLanding(landed?.patch, c)
      if (landed) expect(landed.result).toBe(c.result)
    })
  }

  it("runJsonNode refuses up front a unit whose outputs are not JSON (no job is polled)", async () => {
    const pollJson = vi.fn(async () => "")
    const node = { id: "r1", type: "remove-audio", position: { x: 0, y: 0 }, data: { label: "Remove Audio" } } as never
    const kit = createUnitExecKit({
      node, ctx: { userId: "u1" } as never, inputs: {} as never, overrideMediaUrl: undefined,
      poll: vi.fn(), pollJson, setUserPromptTemplate: vi.fn(), getNodeData: () => undefined, updateNodeData: vi.fn(),
    })
    const start = vi.fn(async () => ({ jobId: "j1" }))
    await expect(kit.runJsonNode(start, "Remove Audio")).rejects.toThrow("remove-audio: runJsonNode needs a node unit whose outputs are JSON")
    expect(pollJson).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("holds a result when any JSON output's field is set", () => {
    expect(holdsJsonRunResult(TYPE, {})).toBe(false)
    expect(holdsJsonRunResult(TYPE, { generatedEdl: { version: 1 } })).toBe(true)
    expect(holdsJsonRunResult(TYPE, { generatedJson: { version: 1 } })).toBe(true)
  })

  it("its JSON pips offer the typed JSON consumers in the add-node popup (TARGET_HANDLE_ACCEPTS), never the media fallback", () => {
    const options = [{ type: "extract-field" }, { type: "merge-video-audio" }, { type: "generate-image" }] as never
    const offered = getCompatibleNodes("edl", "source", options, TYPE)
    expect(offered.compatible).toEqual([])
    expect(offered.direct.map((o) => o.type)).toEqual(["extract-field"])
  })
})
