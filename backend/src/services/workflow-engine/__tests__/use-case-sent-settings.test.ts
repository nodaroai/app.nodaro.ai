// @test-units-by-name runs the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-sent-settings.json
/**
 * Which of a use-case node's settings a run sends, on the server's engine
 * (`freshRunInputs`) — over tools/units/__fixtures__/use-case-sent-settings.json.
 * The editor's half, held to the same bodies, is
 * frontend/src/__tests__/use-case-sent-settings.test.ts.
 */
import { USE_CASE_RUN_VIEWER_AS_BEFORE } from "@nodaro/render-rules"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { freshRunInputs } from "../use-case-request.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"

interface SentSettingsCase {
  readonly name: string
  readonly type: string
  readonly data: Record<string, unknown>
  readonly body: string
}

const FIXTURE = path.resolve(__dirname, "../../../../../tools/units/__fixtures__/use-case-sent-settings.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: SentSettingsCase[] }).cases
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as ResolvedInputs

describe("which settings a use-case run sends — the server's engine", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, () => {
      const node = { id: "u1", type: c.type, data: { label: c.type, fieldMappings: {}, ...c.data } } as unknown as SimpleNode
      expect(JSON.stringify(freshRunInputs(node, REC, USE_CASE_RUN_VIEWER_AS_BEFORE))).toBe(c.body)
    })
  }
})
