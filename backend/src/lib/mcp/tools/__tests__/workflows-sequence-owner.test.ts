import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * `get_workflow_json` / `export_workflow` — a LINKED studio production's
 * sequence planning state never reaches a `view` reader (studio ruling T87):
 * a take's endpoint pins (`sequenceEndpoints` on the graph's result rows), the
 * director's `settings.studio.sequenceRecommendations`, and each sequence take
 * unit's `continuationAcceptance`. What the codec's reader requires to read
 * the production (a take's `policy` and `compilation`) still goes out. `edit`
 * and `own` keep all of it: that reader saves the graph back.
 *
 * Like `workflows-workspace-scope.test.ts`, this runs the WORKSPACE branch with
 * the access seam mocked: only there can a caller hold `view` on someone
 * else's workflow.
 */

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

// Real `accessAtLeast` (loadMcpWorkflow compares access ≥ min with it); only the
// seam's answer is overridable per test.
vi.mock("../../../workflow-access.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../workflow-access.js")>()
  return { ...actual, workflowAccessFromRow: vi.fn() }
})

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const access = await import("../../../workflow-access.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>
const accessFromRow = access.workflowAccessFromRow as unknown as ReturnType<typeof vi.fn>

const WS_ID = "77777777-7777-4777-8777-777777777777"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"
const NOW = "2026-09-08T12:00:00.000Z"

beforeEach(() => {
  vi.clearAllMocks()
})

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

/** A session pinned to a workspace (the dark-in-prod branch). */
function wsSession(scopes: Scope[]): McpSession {
  const s = newSession({ userId: "u1", scopes, clientName: "Claude" })
  s.workspaceId = WS_ID
  return s
}

const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }
const POLICY = { conditioning: "video-continue", clipLength: "max", boundaryPolicy: "outer-frames",
  lockedBoundaryKeyframeIds: [], provider: "wan-3", resolution: "480p", aspectRatio: "16:9", referenceAssetIds: [] }
const COMPILATION = { compilerVersion: "c1", capabilityFingerprint: "exact", renderPlanHash: "plan-1", ready: true, issues: [],
  units: [{ id: "zoom:u0", coverage: [{ shotId: "AB", fromSec: 0, toSec: 4 }], outputDurationSec: 4, generationDurationSec: 4,
    conditioning: "start-end", startKeyframeId: "A", endKeyframeId: "B", guidanceOnlyKeyframeIds: [], reused: false, prerequisites: [] }] }
const REVIEW = { resultKey: "result0", acceptedBy: "owner-actor-private", acceptedAt: NOW,
  review: { composition: true, motion: true, subjects: true, continuity: true } }
const RECOMMENDATION = { id: "rec-1", createdAt: NOW, sequenceId: "zoom", authoringHash: "h1", capabilityFingerprint: "exact",
  priorityHash: "p1", recommendation: { policy: POLICY, reasons: ["a private director reason"], assumptions: [] },
  provenance: { source: "director", jobId: "job-private", analysisRevision: "rev-1", llmModel: "model-x" } }

const take = (reviewed: boolean) => ({ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
  policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
    ...(reviewed ? { continuationAcceptance: REVIEW } : {}) }] })

/** A linked production with a take, its director recommendations and a reviewed continuation. */
const row = () => ({
  id: WORKFLOW_ID, user_id: "creator-other", workspace_id: WS_ID, visibility: "workspace", project_id: "p1",
  name: "Zoom Film", edges: [], updated_at: "t", version: 3,
  nodes: [{ id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
    generatedResults: [{ url: "https://r2/clip.mp4", sequenceEndpoints: PINS }] } }],
  settings: { studio: { version: 3, shots: [{ id: "AB" }],
    sequenceTakes: [take(true)], sequenceRecommendations: [RECOMMENDATION] } },
})

const parsed = (text: string | undefined) => JSON.parse(text ?? "{}") as {
  nodes: Array<{ data: { generatedResults?: unknown[] } }>
  settings: { studio: Record<string, unknown> }
}
const rowsOf = (text: string | undefined) => parsed(text).nodes.flatMap((node) => node.data.generatedResults ?? [])

describe("get_workflow_json / export_workflow — a linked production's sequence planning is the owner's (T87)", () => {
  it.each([
    ["get_workflow_json", {}], ["export_workflow", { with_assets: true }],
  ] as const)("%s drops it for `view`", async (tool, extra) => {
    accessFromRow.mockResolvedValue("view")
    fromMock.mockImplementation((table: string) =>
      chain({ data: table === "workflows" ? row() : [], error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, tool, { workflow_id: WORKFLOW_ID, ...extra })

    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text
    for (const secret of ["frame-private-a", "a private director reason", "job-private", "owner-actor-private"]) {
      expect(text).not.toContain(secret)
    }
    expect(rowsOf(text)).toEqual([{ url: "https://r2/clip.mp4" }])
    expect(parsed(text).settings.studio).toEqual({ version: 3, shots: [{ id: "AB" }], sequenceTakes: [take(false)] })
  })

  it.each([
    ["get_workflow_json", "edit", {}], ["get_workflow_json", "own", {}],
    ["export_workflow", "edit", { with_assets: true }], ["export_workflow", "own", { with_assets: true }],
  ] as const)("%s keeps it for `%s`", async (tool, level, extra) => {
    accessFromRow.mockResolvedValue(level)
    fromMock.mockImplementation((table: string) =>
      chain({ data: table === "workflows" ? row() : [], error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, tool, { workflow_id: WORKFLOW_ID, ...extra })

    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text
    expect(rowsOf(text)).toEqual([{ url: "https://r2/clip.mp4", sequenceEndpoints: PINS }])
    expect(parsed(text).settings.studio).toEqual(row().settings.studio)
  })
})
