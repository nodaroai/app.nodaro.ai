// @test-units-by-name freezes the run body of the four use-case types its backend twin names, before multicam
// @test-watches backend/src/lib/__tests__/fixtures/use-case-single-recording-identity.json frontend/src/__tests__/fixtures/use-case-single-recording-body.json
/**
 * The body the canvas's own run of a use-case node sends its route, from ONE
 * recording, frozen before the multicam work: node data → executor → API
 * client → fetch, key order included. The rows' inputs (the node's data, its
 * recordings, music and intro card) are the backend twin's
 * (`backend/src/lib/__tests__/use-case-single-recording-identity.test.ts`, its
 * `bodies`), which pins the engine's body for the same rows — so both engines
 * are held to one set of inputs. This fixture keeps only the editor's body for
 * each of those rows, by name.
 *
 * The harness stands in only for what the executor reads today (the store's
 * nodes and node writes, a refused fetch). If the executor comes to read more,
 * extend the harness; a harness change never re-records a body.
 *
 * The fixture is written once (`RECORD_SINGLE_RECORDING_IDENTITY=1`) and a
 * write is refused when it already exists. Never re-record it: a re-recording
 * takes whatever the code then builds as the truth.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"

const store = vi.hoisted(() => ({ nodes: [] as unknown[], updateNodeData: vi.fn() }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))

import { executeUseCase } from "@/components/editor/workflow-editor/use-case-executor"

const SHARED = join(__dirname, "../../../backend/src/lib/__tests__/fixtures/use-case-single-recording-identity.json")
const FIXTURE = join(__dirname, "fixtures", "use-case-single-recording-body.json")
const USER = "00000000-0000-4000-8000-000000000001"

interface SharedBodyRow {
  readonly name: string
  readonly type: UseCaseNodeType
  readonly data: Record<string, unknown>
  readonly inputs: Record<string, unknown>
}
interface EditorBodyRow {
  readonly name: string
  readonly editor: string
}

/**
 * The body of the one request a run sends. The route refuses it, so the run
 * ends there whatever its type lands its result by (nothing is polled).
 */
async function editorBody(r: SharedBodyRow): Promise<string> {
  const refused = { ok: false, status: 400, json: async () => ({ error: { code: "frozen_body", message: "refused by the test" } }) }
  const f = vi.fn().mockResolvedValue(refused)
  vi.stubGlobal("fetch", f)
  try {
    const node = { id: "u1", type: r.type, position: { x: 0, y: 0 }, data: { label: usecaseDescriptor(r.type).label, fieldMappings: {}, ...r.data } }
    store.nodes = [node]
    await expect(executeUseCase(node as never, r.inputs as never, { userId: USER, isWorkflowStale: () => false } as never)).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
    // Posted to the type's own run route (never its estimate, never another type's).
    const url = new URL(String(f.mock.calls[0]![0]), "http://localhost")
    expect(url.pathname.endsWith(usecaseDescriptor(r.type).route), url.href).toBe(true)
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe("POST")
    return (f.mock.calls[0]![1] as RequestInit).body as string
  } finally {
    vi.unstubAllGlobals()
  }
}

const shared = (JSON.parse(readFileSync(SHARED, "utf8")) as { bodies: SharedBodyRow[] }).bodies

describe("the use-case types' editor run bodies from one recording", () => {
  if (process.env.RECORD_SINGLE_RECORDING_IDENTITY === "1") {
    it("records the fixture", async () => {
      if (existsSync(FIXTURE)) throw new Error(`${FIXTURE} already exists: it is recorded once, before the multicam work, and never re-recorded`)
      const rows: EditorBodyRow[] = []
      for (const r of shared) rows.push({ name: r.name, editor: await editorBody(r) })
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, JSON.stringify({ bodies: rows }, null, 2) + "\n")
      expect(existsSync(FIXTURE)).toBe(true)
    })
    return
  }
  const recorded = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { bodies: EditorBodyRow[] }).bodies

  it("holds one editor body for each of the backend twin's rows, in its order", () => {
    expect(recorded.map((r) => r.name)).toEqual(shared.map((r) => r.name))
  })
  for (const [i, r] of shared.entries()) {
    it(`body (${r.name}): the editor sends the same bytes`, async () => {
      expect(await editorBody(r)).toBe(recorded[i]!.editor)
    })
  }
})
