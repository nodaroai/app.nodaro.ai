// @test-units-by-name runs the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-media-order.json
/**
 * Which recording a use-case node's run sends, from its `mediaOrder`, on the
 * canvas's engine (the executor's request body), and that the estimate builds
 * on the same one (`expandUseCaseNodes`) — over
 * tools/units/__fixtures__/use-case-media-order.json. The server's half, held
 * to the same values, is
 * backend/src/services/workflow-engine/__tests__/use-case-media-order.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { expandUseCaseNodes } from "@nodaro/render-rules"

const store = vi.hoisted(() => ({ nodes: [] as unknown[], updateNodeData: vi.fn() }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))

import { executeUseCase } from "@/components/editor/workflow-editor/use-case-executor"

interface MediaOrderCase {
  readonly name: string
  readonly type: string
  readonly wired: readonly string[]
  readonly mediaOrder?: unknown
  readonly sent: readonly string[]
}

const FIXTURE = path.resolve(__dirname, "../../../tools/units/__fixtures__/use-case-media-order.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: MediaOrderCase[] }).cases
const urlOf = (id: string) => `https://r2/${id}.mp4`

const nodeOf = (c: MediaOrderCase) => ({
  id: "u1",
  type: c.type,
  position: { x: 0, y: 0 },
  data: { label: c.type, fieldMappings: {}, ...("mediaOrder" in c ? { mediaOrder: c.mediaOrder } : {}) },
})

/** The body of the one request the run sends (the route refuses it, so the run ends there). */
async function sentBody(c: MediaOrderCase): Promise<Record<string, unknown>> {
  const refused = { ok: false, status: 400, json: async () => ({ error: { code: "test", message: "refused by the test" } }) }
  const f = vi.fn().mockResolvedValue(refused)
  vi.stubGlobal("fetch", f)
  try {
    const node = nodeOf(c)
    store.nodes = [node]
    const inputs = { useCaseMedia: c.wired.map((id) => ({ nodeId: id, url: urlOf(id) })) }
    await expect(executeUseCase(node as never, inputs as never, { userId: "u", isWorkflowStale: () => false } as never)).rejects.toThrow()
    return JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>
  } finally {
    vi.unstubAllGlobals()
  }
}

/** The upstream nodes the estimate builds on: the wired sources its inner wires start from. */
function estimatedSources(c: MediaOrderCase): string[] {
  const sources = c.wired.map((id) => ({ id, type: "upload-video", data: { url: urlOf(id) } }))
  const edges = c.wired.map((id) => ({ source: id, target: "u1", sourceHandle: "video", targetHandle: "media" }))
  const x = expandUseCaseNodes([...sources, nodeOf(c)], edges)
  return [...new Set(x.edges.map((e) => e.source).filter((s): s is string => !!s && c.wired.includes(s)))]
}

describe("which recording a use-case run sends — the canvas's engine and the estimate", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, async () => {
      expect((await sentBody(c)).mediaUrls).toEqual(c.sent.map(urlOf))
      expect(estimatedSources(c)).toEqual([c.sent[0]])
    })
  }
})
