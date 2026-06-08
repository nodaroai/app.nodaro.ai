import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { planSheetGeneration, resolveSheetSections } from "@nodaro/shared"
import type { OrchestratorContext, SimpleNode } from "../types.js"

// --- Module mocks -----------------------------------------------------------
// Reassigned per test so the supabase mock can return different entity rows.
let entityRow: Record<string, unknown> = {}
let jobStatus = "completed"

vi.mock("@/lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) } }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        single: () => Promise.resolve({ data: table === "jobs" ? { status: jobStatus } : entityRow }),
      }
      return chain
    },
  },
}))

import { ensureWorkflowSheetPanels } from "../reference-sheet-stage-a.js"

const ctx = { userId: "u1" } as unknown as OrchestratorContext

const sheetNode: SimpleNode = {
  id: "n2",
  type: "reference-sheet",
  data: {
    type: "turnaround",
    skin: "studio",
    flavour: { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" },
  },
}

/** Graph: a character node n1 → the reference-sheet node n2. */
function graph(charData: Record<string, unknown> = { characterDbId: "char-1" }) {
  return {
    nodes: [
      { id: "n1", type: "character", data: charData } as SimpleNode,
      sheetNode,
    ],
    edges: [{ id: "e1", source: "n1", target: "n2" }],
    nodeStates: {},
  }
}

const flavour = sheetNode.data.flavour as Parameters<typeof planSheetGeneration>[2]
/** The planned turnaround panels (head-turnaround board → `angles` column). */
const plannedVariants = planSheetGeneration(
  "character",
  resolveSheetSections("character", "turnaround"),
  flavour,
  {},
  "Hero",
).missing.map((m) => m.variant)

const baseRow = () => ({
  id: "char-1",
  name: "Hero",
  source_image_url: "https://img/hero.png",
  angles: [] as Array<{ name: string; url: string }>,
  body_angles: [], expressions: [], poses: [], lighting_variations: [], detail_closeups: [], outfit_variations: [],
})

const fetchMock = vi.fn()

describe("ensureWorkflowSheetPanels (workflow-run Stage A)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobStatus = "completed"
    entityRow = baseRow()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ jobId: "panel-job" }), text: async () => "" })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("generates each missing panel via the generate-character-asset route", async () => {
    vi.useFakeTimers()
    const p = ensureWorkflowSheetPanels(sheetNode, ctx, graph())
    await vi.runAllTimersAsync()
    await p
    expect(fetchMock).toHaveBeenCalledTimes(plannedVariants.length)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/v1/generate-character-asset")
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toMatchObject({ userId: "u1", attachToCharacterId: "char-1", attachToColumn: "angles", sourceImageUrl: "https://img/hero.png" })
    expect(body.attachToColumn).toBe("angles")
  })

  it("no-ops (no generation) when the entity already has every planned panel", async () => {
    entityRow = { ...baseRow(), angles: plannedVariants.map((v) => ({ name: v, url: `u/${v}` })) }
    await ensureWorkflowSheetPanels(sheetNode, ctx, graph())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws main_image_required when panels are missing but there's no establishing image", async () => {
    entityRow = { ...baseRow(), source_image_url: null }
    await expect(ensureWorkflowSheetPanels(sheetNode, ctx, graph())).rejects.toThrow(/main_image_required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no-ops when no entity is wired (compose job's entity_not_ready guard handles it)", async () => {
    await ensureWorkflowSheetPanels(sheetNode, ctx, { nodes: [sheetNode], edges: [], nodeStates: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("tolerates a panel route rejection (compose proceeds; no throw)", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}), text: async () => "insufficient" })
    const p = ensureWorkflowSheetPanels(sheetNode, ctx, graph())
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(plannedVariants.length)
  })
})
