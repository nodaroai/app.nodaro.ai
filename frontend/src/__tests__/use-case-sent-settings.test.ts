// @test-units-by-name runs the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-sent-settings.json
/**
 * Which of a use-case node's settings a run sends, on the canvas's engine (the
 * executor's request body, without the caller's userId) — over
 * tools/units/__fixtures__/use-case-sent-settings.json. The server's half,
 * held to the same bodies, is
 * backend/src/services/workflow-engine/__tests__/use-case-sent-settings.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({ nodes: [] as unknown[], updateNodeData: vi.fn() }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))

import { executeUseCase } from "@/components/editor/workflow-editor/use-case-executor"

interface SentSettingsCase {
  readonly name: string
  readonly type: string
  readonly data: Record<string, unknown>
  readonly body: string
}

const FIXTURE = path.resolve(__dirname, "../../../tools/units/__fixtures__/use-case-sent-settings.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: SentSettingsCase[] }).cases
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }

/** The body of the one request the run sends (the route refuses it, so the run ends there), without the caller. */
async function sentBody(c: SentSettingsCase): Promise<string> {
  const refused = { ok: false, status: 400, json: async () => ({ error: { code: "test", message: "refused by the test" } }) }
  const f = vi.fn().mockResolvedValue(refused)
  vi.stubGlobal("fetch", f)
  try {
    const node = { id: "u1", type: c.type, position: { x: 0, y: 0 }, data: { label: c.type, fieldMappings: {}, ...c.data } }
    store.nodes = [node]
    await expect(executeUseCase(node as never, REC as never, { userId: "u", isWorkflowStale: () => false } as never)).rejects.toThrow()
    const { userId: _caller, ...body } = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>
    return JSON.stringify(body)
  } finally {
    vi.unstubAllGlobals()
  }
}

describe("which settings a use-case run sends — the canvas's engine", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, async () => expect(await sentBody(c)).toBe(c.body))
  }
})
