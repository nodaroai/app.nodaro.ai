import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * `get_workflow_json` / `export_workflow` — a LINKED studio production's
 * owner state never reaches a `view` reader (studio ruling T87): a take's
 * endpoint pins (`sequenceEndpoints` on the graph's result rows), a unit
 * result's frozen request (`requestManifest`), a keyframe's runs in flight
 * (`keyframePendingImages`), the director's
 * `settings.studio.sequenceRecommendations`, the entries of the owner's
 * current `sequenceGenerationPolicies` (the record goes out empty), each
 * sequence take unit's `continuationAcceptance`, each keyframe's `rejections`
 * and its acceptance's `waivedReason`. The rest still goes out, including what
 * the codec's reader requires to read the production (a take's `policy` and
 * `compilation`, the unit results its takes select) and the rest of a frame's
 * acceptance. `edit` and `own` keep all of it: that reader saves the graph
 * back.
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
/** The owner's CURRENT preference for the sequence, set after the take was made with {@link POLICY}. */
const PREFERENCE = { ...POLICY, provider: "preference-private" }
/** A unit result's frozen request, as the host writes it when the result lands. */
const MANIFEST = { version: 1, coverage: [{ shotId: "AB", prompt: "a private compiled prompt" }],
  media: ["https://r2/reference-private.png"], sourceSnapshots: [{ id: "AB", clipSlots: [{ prompt: "a private unsent slot" }] }] }
const PROVENANCE = { planRevision: 1, attemptId: "attempt-1", resolvedRequestHash: "b".repeat(64), referencePins: [], descriptionPins: [] }
/** An image run in flight on keyframe A. */
const FRAME_RUN = { jobId: "frame-run-private", startedAt: 5, frame: { prompt: "a private pending frame" }, provenance: PROVENANCE }
/** The owner sent one of A's results back for revision. */
const REJECTION = { result: PIN("A", "kf-a-1"), rejectedBy: "rejector-private", rejectedAt: NOW, reason: "a private rejection reason" }
/** The owner waived keyframe A's one requirement when accepting its other result, and said why. */
const WAIVER = "a private waiver reason"
/** A's acceptance: the waived check stays, the owner's reason for it does not. */
const acceptance = (reasoned: boolean) => ({ result: PIN("A", "kf-a-2"), acceptedBy: "acceptor", acceptedAt: NOW,
  requirementChecks: [{ requirementId: "req-1", outcome: "waived" }], ...(reasoned ? { waivedReason: WAIVER } : {}) })
const PRIVATE = ["frame-private-a", "a private director reason", "job-private", "owner-actor-private", "preference-private",
  "a private compiled prompt", "reference-private", "a private unsent slot", "frame-run-private", "a private pending frame",
  "rejector-private", "a private rejection reason", WAIVER]

const take = (reviewed: boolean) => ({ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
  policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
    ...(reviewed ? { continuationAcceptance: REVIEW } : {}) }] })
/** A linked clip, keyframe A's image node and the take's unit video node — the owner's state on each, or not. */
const nodes = (owner: boolean) => [
  { id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
    generatedResults: [{ url: "https://r2/clip.mp4", ...(owner ? { sequenceEndpoints: PINS } : {}) }] } },
  { id: "frame-A", type: "generate-image", position: { x: -340, y: 0 }, data: { keyframeId: "A",
    generatedResults: [{ url: "https://r2/a1.png", jobId: "kf-a-1", pin: PIN("A", "kf-a-1"), provenance: PROVENANCE },
      { url: "https://r2/a2.png", jobId: "kf-a-2", pin: PIN("A", "kf-a-2"), provenance: PROVENANCE }],
    ...(owner ? { keyframePendingImages: [FRAME_RUN] } : {}) } },
  { id: "owner0", type: "generate-video", position: { x: 680, y: 0 }, data: { sequenceUnitId: "zoom:u0",
    sequenceUnitResults: [{ url: "https://r2/unit0.mp4", requestHash: "request-0",
      pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 },
      ...(owner ? { requestManifest: MANIFEST } : {}) }] } },
]
/** Keyframe A's entry, with the owner's review of it and the reason for its waiver or without. */
const frameEntry = (reviewed: boolean) => ({ imageNodeId: "frame-A",
  plan: { id: "A", label: "A", revision: 1, frame: { prompt: "A" },
    requirements: [{ id: "req-1", text: "Same window light", severity: "required" }] },
  acceptance: acceptance(reviewed),
  ...(reviewed ? { rejections: [REJECTION] } : {}) })

/** A linked production with a take, its director recommendations, a reviewed continuation and a reviewed frame. */
const row = () => ({
  id: WORKFLOW_ID, user_id: "creator-other", workspace_id: WS_ID, visibility: "workspace", project_id: "p1",
  name: "Zoom Film", edges: [], updated_at: "t", version: 3,
  nodes: nodes(true),
  settings: { studio: { version: 3, shots: [{ id: "AB" }], keyframes: [frameEntry(true)],
    sequenceGenerationPolicies: { zoom: PREFERENCE }, sequenceTakes: [take(true)], sequenceRecommendations: [RECOMMENDATION] } },
})

const parsed = (text: string | undefined) => JSON.parse(text ?? "{}") as {
  nodes: unknown[]
  settings: { studio: Record<string, unknown> }
}

describe("get_workflow_json / export_workflow — a linked production's owner state is the owner's (T87)", () => {
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
    for (const secret of PRIVATE) expect(text).not.toContain(secret)
    expect(parsed(text).nodes).toEqual(nodes(false))
    expect(parsed(text).settings.studio).toEqual({ version: 3, shots: [{ id: "AB" }], keyframes: [frameEntry(false)],
      sequenceGenerationPolicies: {}, sequenceTakes: [take(false)] })
    // The frame keeps its acceptance and the check it waived; only the owner's reason goes.
    expect((parsed(text).settings.studio.keyframes as Array<{ acceptance: unknown }>)[0]!.acceptance).toEqual(acceptance(false))
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
    expect(parsed(text).nodes).toEqual(nodes(true))
    expect(parsed(text).settings.studio).toEqual(row().settings.studio)
  })
})
