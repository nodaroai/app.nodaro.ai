import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A LINKED (keyframe / sequence) studio production's owner state never reaches
 * a reader who is not its owner (studio ruling T87), on the by-id doors (the
 * response to a move included, in either form: `POST /v1/workflows/:id/move`
 * and `PATCH /v1/workflows/:id { projectId }`) and on the public share read:
 *
 * - a take's endpoint pins (`sequenceEndpoints` on the clip node's
 *   `data.generatedResults` rows);
 * - a unit result's frozen request (`requestManifest` on the unit video node's
 *   `data.sequenceUnitResults` rows);
 * - a keyframe's runs in flight (`keyframePendingImages` on its image node);
 * - the director's `settings.studio.sequenceRecommendations`;
 * - the owner's current preferences: `settings.studio.sequenceGenerationPolicies`
 *   goes out EMPTY;
 * - each sequence take unit's `continuationAcceptance`;
 * - each keyframe entry's `rejections`, and the owner's reason for waiving its
 *   requirements (`waivedReason` in its `acceptance`).
 *
 * The rest of a take or a frame still goes out: these strips drop keys, never
 * rows. Part of it the studio codec's reader cannot read a production with
 * takes without — the preferences record itself (empty is fine), a take's
 * `policy` and `compilation`, the unit results its takes select, a frame
 * plan's `id` / `label` / `revision` / `frame` / `requirements` and the result
 * its preview names. The rest (a unit's other results, a frame's other history
 * rows, the rest of its acceptance record, the waived check included) the
 * reader can do without, and it stays too. `edit` and `own` keep all of it: an
 * editor saves the whole graph back (T21 / T77).
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/workflow-delete.js", () => ({
  deleteWorkflowWithPrivateMedia: vi.fn(),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))

vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn().mockReturnValue({
    sendEvent: vi.fn(), sendComment: vi.fn(), close: vi.fn(), isClosed: false,
  }),
}))

vi.mock("@/lib/execution-events.js", () => ({
  executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: vi.fn() },
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

vi.mock("@/lib/storage.js", () => ({
  copyToTemplatePreview: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: vi.fn() }))

// ---------------------------------------------------------------------------

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

const CREATOR = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"
/** The workspace a move files the production under. */
const TARGET_WS = "00000000-0000-4000-8000-000000000031"
const NOW = "2026-09-08T12:00:00.000Z"

const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }
const POLICY = { conditioning: "video-continue", clipLength: "max", boundaryPolicy: "outer-frames",
  lockedBoundaryKeyframeIds: [], provider: "wan-3", resolution: "480p", aspectRatio: "16:9", referenceAssetIds: [] }
/** The owner's CURRENT preference for the sequence, set after the take was made with {@link POLICY}. */
const PREFERENCE = { ...POLICY, provider: "preference-private" }
const COMPILATION = { compilerVersion: "c1", capabilityFingerprint: "exact", renderPlanHash: "plan-1", ready: true, issues: [],
  units: [{ id: "zoom:u0", coverage: [{ shotId: "AB", fromSec: 0, toSec: 4 }], outputDurationSec: 4, generationDurationSec: 4,
    conditioning: "start-end", startKeyframeId: "A", endKeyframeId: "B", guidanceOnlyKeyframeIds: [], reused: false, prerequisites: [] }] }
const REVIEW = { resultKey: "result0", acceptedBy: "owner-actor-private", acceptedAt: NOW,
  review: { composition: true, motion: true, subjects: true, continuity: true } }
const RECOMMENDATION = { id: "rec-1", createdAt: NOW, sequenceId: "zoom", authoringHash: "h1", capabilityFingerprint: "exact",
  priorityHash: "p1", recommendation: { policy: POLICY, reasons: ["a private director reason"], assumptions: [] },
  provenance: { source: "director", jobId: "job-private", analysisRevision: "rev-1", llmModel: "model-x" } }
/** A unit result's frozen request, as the host writes it when the result lands. */
const MANIFEST = { version: 1, coverage: [{ shotId: "AB", prompt: "a private compiled prompt" }],
  media: ["https://r2/reference-private.png"], sourceSnapshots: [{ id: "AB", clipSlots: [{ prompt: "a private unsent slot" }] }] }
const PROVENANCE = { planRevision: 1, attemptId: "attempt-1", resolvedRequestHash: "b".repeat(64), referencePins: [], descriptionPins: [] }
/** An image run in flight on keyframe A. */
const FRAME_RUN = { jobId: "frame-run-private", startedAt: 5, frame: { prompt: "a private pending frame" }, provenance: PROVENANCE }
/** The owner sent one of A's results back for revision. */
const REJECTION = { result: PIN("A", "kf-a-2"), rejectedBy: "rejector-private", rejectedAt: NOW, reason: "a private rejection reason" }
/** The owner waived keyframe A's one requirement when accepting it, and said why. */
const WAIVER = "a private waiver reason"
/** A's acceptance: the waived check stays, the owner's reason for it does not. */
const acceptance = (reasoned: boolean) => ({ result: PIN("A", "kf-a-1"), acceptedBy: "acceptor", acceptedAt: NOW,
  requirementChecks: [{ requirementId: "req-1", outcome: "waived" }], ...(reasoned ? { waivedReason: WAIVER } : {}) })
const PRIVATE = ["frame-private-a", "a private director reason", "job-private", "owner-actor-private", "preference-private",
  "a private compiled prompt", "reference-private", "a private unsent slot", "frame-run-private", "a private pending frame",
  "rejector-private", "a private rejection reason", WAIVER]
/** The keys that carry the owner's state; a `view` reader receives none of them. */
const OWNER_KEYS = ["sequenceEndpoints", "requestManifest", "keyframePendingImages", "sequenceRecommendations",
  "continuationAcceptance", "rejections", "waivedReason"]

/** A linked scene's clip; its take carries the pins. */
const clipNode = (pinned: boolean) => ({ id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
  generatedResults: [{ url: "https://r2/clip.mp4", jobId: "clip-1", ...(pinned ? { sequenceEndpoints: PINS } : {}) }] } })
/** Keyframe A's image node: its results stay, its run in flight does not. */
const frameNode = (running: boolean) => ({ id: "frame-A", type: "generate-image", position: { x: -340, y: 0 }, data: {
  label: "A", keyframeId: "A", generatedResults: [
    { url: "https://r2/a1.png", jobId: "kf-a-1", pin: PIN("A", "kf-a-1"), provenance: PROVENANCE },
    { url: "https://r2/a2.png", jobId: "kf-a-2", pin: PIN("A", "kf-a-2"), provenance: PROVENANCE }],
  ...(running ? { keyframePendingImages: [FRAME_RUN] } : {}) } })
/** The take's unit result: the row stays, its frozen request does not. */
const unitResult = (frozen: boolean) => ({ url: "https://r2/unit0.mp4", requestHash: "request-0",
  pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 },
  ...(frozen ? { requestManifest: MANIFEST } : {}) })
const unitNode = (frozen: boolean) => ({ id: "owner0", type: "generate-video", position: { x: 680, y: 0 }, data: { sequenceUnitId: "zoom:u0",
  sequenceUnitResults: [unitResult(frozen)],
  generatedVideoUrl: "https://r2/unit0.mp4", generatedResults: [{ videoUrl: "https://r2/unit0.mp4", jobId: "result0" }] } })

/** A linked scene's clip, keyframe A's image node and one unit video node of a take. */
const linkedNodes = () => [clipNode(true), frameNode(true), unitNode(true)]

/** Keyframe A's entry: its plan and acceptance stay, its review record and the acceptance's waiver reason do not. */
const frameEntry = (reviewed: boolean) => ({ imageNodeId: "frame-A",
  plan: { id: "A", label: "A", revision: 1, frame: { prompt: "A" },
    requirements: [{ id: "req-1", text: "Same window light", severity: "required" }] },
  acceptance: acceptance(reviewed),
  ...(reviewed ? { rejections: [REJECTION] } : {}) })

/** The take as the codec writes it — and, without `continuationAcceptance`, as a reader gets it. */
const take = (reviewed: boolean) => ({ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
  policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
    ...(reviewed ? { continuationAcceptance: REVIEW } : {}) }] })

/** A shared, linked production with a take, its director recommendations, a reviewed continuation and a reviewed frame. */
const PRODUCTION = {
  id: WF, project_id: "00000000-0000-4000-8000-000000000010", user_id: CREATOR, workspace_id: WS,
  visibility: "workspace", folder_id: null, name: "Zoom film", description: null, is_template: false,
  version: 1, thumbnail_url: null, source_prompt: null, parent_workflow_id: null, app_slug: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  nodes: linkedNodes(),
  edges: [],
  settings: { studio: {
    version: 3, shared: true,
    shots: [{ id: "AB", sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" } }],
    requiredCapabilities: ["studio-dependent-frames-v1", "studio-sequence-takes-v1"],
    keyframes: [frameEntry(true)],
    sequences: [{ id: "zoom", name: "Zoom", revision: 1, construction: "nested-zoom", shotIds: ["AB"] }],
    sequenceGenerationPolicies: { zoom: PREFERENCE },
    sequenceTakes: [take(true)],
    sequenceUnitVideos: [{ videoNodeId: "owner0", unitId: "zoom:u0" }],
    selectedSequenceTakeIds: { zoom: "take1" },
    sequenceRecommendations: [RECOMMENDATION],
  } },
}

/**
 * Install an orgs plugin that answers `access` for every workflow; given
 * `before`, it answers `before` for the production where it starts and
 * `access` once a move has filed it under {@link TARGET_WS}.
 */
function plugin(access: string, before = access) {
  // The seam engages only when the plugin answers every access question.
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue(access),
    workflowAccessFromRow: vi.fn(async (_user: string, row: { workspace_id: string | null }) =>
      (row.workspace_id === TARGET_WS ? access : before)),
    canDeleteWorkflow: vi.fn().mockResolvedValue(false),
    canRunWorkflow: vi.fn().mockResolvedValue(false),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
    canShareWorkflow: vi.fn().mockResolvedValue(false),
    // The plugin's move rule: a workspace admin of both sides may move a
    // member's work whatever `admin_access` gives them on it.
    canMoveWorkflow: vi.fn().mockResolvedValue({ allowed: true }),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
}

/** Mocks the workflows table's by-id read — select → eq → `row` (by-id doors: `maybeSingle`, the share read: `single`); any other table → no rows. */
function tables(row: unknown = PRODUCTION) {
  const read = vi.fn().mockResolvedValue({ data: structuredClone(row), error: null })
  const workflows = { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: read, single: read })) })) }
  const entities: Record<string, unknown> = {
    select: vi.fn(() => entities), in: vi.fn(() => entities), eq: vi.fn(() => entities),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "workflows" ? workflows : entities)) as never)
}

/** Where a move takes the production: a project of another workspace, {@link TARGET_WS}. */
const TARGET_PROJECT = "00000000-0000-4000-8000-000000000011"
/** Someone a grant shared the production with; a move into another workspace drops it. */
const GRANTEE = "00000000-0000-4000-8000-0000000000aa"
/** How a move reports the grants it dropped. */
const dropped = (granted: ReadonlyArray<string>) => granted.map((userId) => ({ userId, name: "Sam" }))

/**
 * Mocks a move into {@link TARGET_WS}. The workflows table answers the reads
 * of the stored row (select → eq → `maybeSingle`: PATCH's own load, then the
 * move's facts: the row's owner, home and assignment) and the update (update →
 * eq → select → `single` for the move endpoint, `maybeSingle` for PATCH: the
 * moved row, which the database files under its new project's workspace). The
 * projects table answers the target project, the grants table the grants the
 * move drops (`granted`) and the profiles table their names. Any other table
 * (PATCH's trigger sync) reads no rows.
 */
function moveTables(granted: ReadonlyArray<string>) {
  const stored = { ...structuredClone(PRODUCTION), assignment_id: null }
  const moved = { ...structuredClone(PRODUCTION), project_id: TARGET_PROJECT, workspace_id: TARGET_WS }
  const update = vi.fn().mockResolvedValue({ data: moved, error: null })
  const workflows = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: stored, error: null }) })) })),
    update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: update, maybeSingle: update })) })) })),
  }
  const projects = { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({
    data: { id: TARGET_PROJECT, user_id: CREATOR, workspace_id: TARGET_WS }, error: null }) })) })) }
  const grants = { delete: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn().mockResolvedValue({
    data: granted.map((user_id) => ({ user_id })), error: null }) })) })) }
  const profiles = { select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({
    data: granted.map((id) => ({ id, full_name: "Sam" })), error: null }) })) }
  const empty: Record<string, unknown> = {
    select: vi.fn(() => empty), in: vi.fn(() => empty), eq: vi.fn(() => empty),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  }
  const byTable: Record<string, unknown> = { workflows, projects, workflow_collaborators: grants, profiles }
  vi.mocked(supabase.from).mockImplementation(((table: string) => byTable[table] ?? empty) as never)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getPluginServices).mockReturnValue({} as never)
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => ({ organizations: [], workspaces: [] })
  })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => { await workflowRoutes(i) })
  await app.ready()
})

type Graph = { nodes: Array<{ id: string; data?: Record<string, unknown> }>; settings: { studio: Record<string, unknown> } }
const DOORS = [
  ["GET /v1/workflows/:id", `/v1/workflows/${WF}`, (body: any): Graph => body.data],
  ["GET /v1/workflows/:id/export?assets=true", `/v1/workflows/${WF}/export?assets=true`, (body: any): Graph => body],
] as const

const dataOf = (graph: Graph, id: string) => graph.nodes.find((node) => node.id === id)!.data!

describe.each(DOORS)("%s — a linked production's owner state is the owner's (T87)", (_door, url, graphOf) => {
  it("a `view` reader gets the production without the owner's state, and with everything the codec's reader requires", async () => {
    plugin("view")
    tables()
    const res = await app.inject({ method: "GET", url, headers: { "x-user-id": OTHER } })
    expect(res.statusCode).toBe(200)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    for (const key of OWNER_KEYS) expect(res.body).not.toContain(key)
    const graph = graphOf(res.json())
    expect(graph.nodes).toEqual([clipNode(false), frameNode(false), unitNode(false)])
    expect(graph.settings.studio.sequenceRecommendations).toBeUndefined()
    // What the codec's reader needs to read the production still goes out —
    // the preferences record EMPTY, and the take with the policy it was made with.
    expect(graph.settings.studio.sequenceGenerationPolicies).toEqual({})
    expect(graph.settings.studio.sequenceTakes).toEqual([take(false)])
    expect(graph.settings.studio.keyframes).toEqual([frameEntry(false)])
    // The frame keeps its acceptance and the check it waived; only the owner's reason goes.
    expect((graph.settings.studio.keyframes as Array<{ acceptance: unknown }>)[0]!.acceptance).toEqual(acceptance(false))
  })

  it.each(["edit", "own"])("`%s` keeps all of it — that reader saves the graph back", async (access) => {
    plugin(access)
    tables()
    const res = await app.inject({ method: "GET", url,
      headers: { "x-user-id": access === "own" ? CREATOR : OTHER } })
    expect(res.statusCode).toBe(200)
    const graph = graphOf(res.json())
    expect(graph.nodes).toEqual(PRODUCTION.nodes)
    expect(graph.settings.studio).toEqual(PRODUCTION.settings.studio)
  })
})

describe("GET /v1/workflows/:id/export (template) — the result rows are gone already; the rest of the owner's state is not", () => {
  it.each([["view", "drops"], ["edit", "keeps"], ["own", "keeps"]] as const)(
    "`%s` %s it", async (access, verb) => {
      const kept = verb === "keeps"
      plugin(access)
      tables()
      const res = await app.inject({ method: "GET", url: `/v1/workflows/${WF}/export`,
        headers: { "x-user-id": access === "own" ? CREATOR : OTHER } })
      expect(res.statusCode).toBe(200)
      const graph = res.json() as Graph
      const studio = graph.settings.studio
      expect(studio.sequenceRecommendations).toEqual(kept ? [RECOMMENDATION] : undefined)
      expect(studio.sequenceGenerationPolicies).toEqual(kept ? { zoom: PREFERENCE } : {})
      expect(studio.sequenceTakes).toEqual([take(kept)])
      expect(studio.keyframes).toEqual([frameEntry(kept)])
      expect(dataOf(graph, "owner0").sequenceUnitResults).toEqual([unitResult(kept)])
      expect(dataOf(graph, "frame-A").keyframePendingImages).toEqual(kept ? [FRAME_RUN] : undefined)
    },
  )
})

/** The two ways a move can be asked for; both answer it the same way. */
const MOVES = [
  ["POST /v1/workflows/:id/move", (user: string) => app.inject({ method: "POST", url: `/v1/workflows/${WF}/move`,
    headers: { "x-user-id": user }, payload: { projectId: TARGET_PROJECT } })],
  ["PATCH /v1/workflows/:id { projectId }", (user: string) => app.inject({ method: "PATCH", url: `/v1/workflows/${WF}`,
    headers: { "x-user-id": user }, payload: { projectId: TARGET_PROJECT } })],
] as const

describe.each(MOVES)("%s — the moved row goes back to the mover on GET's terms (T87)", (_form, move) => {
  // A move that drops a grant and one that drops none: PATCH answers each from
  // its own return, and names the dropped grants only when there are some; the
  // move endpoint always names them.
  it.each([
    ["view", "no grant", []], ["view", "a grant", [GRANTEE]],
    ["none", "no grant", []], ["none", "a grant", [GRANTEE]],
  ] as const)("a `%s` mover gets it without the owner's state (the move drops %s)", async (access, _drops, granted) => {
    // `view` is a team workspace's admin by default. The plugin answers a
    // mover `none` only when it fails closed (workspace facts it cannot load)
    // or a standing changes between the move and the check; stripped too.
    // Each mover may edit the production where it starts, the bar PATCH asks
    // before it moves anything, so the moved row's answer is what decides.
    plugin(access, "edit")
    moveTables(granted)
    const res = await move(OTHER)
    expect(res.statusCode).toBe(200)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    for (const key of OWNER_KEYS) expect(res.body).not.toContain(key)
    expect(res.json().data).toMatchObject({ projectId: TARGET_PROJECT, workspaceId: TARGET_WS })
    const graph = res.json().data as Graph
    expect(graph.nodes).toEqual([clipNode(false), frameNode(false), unitNode(false)])
    expect(graph.settings.studio.sequenceRecommendations).toBeUndefined()
    expect(graph.settings.studio.sequenceGenerationPolicies).toEqual({})
    expect(graph.settings.studio.sequenceTakes).toEqual([take(false)])
    expect(graph.settings.studio.keyframes).toEqual([frameEntry(false)])
    // The frame keeps its acceptance and the check it waived; only the owner's reason goes.
    expect((graph.settings.studio.keyframes as Array<{ acceptance: unknown }>)[0]!.acceptance).toEqual(acceptance(false))
    expect(res.json().droppedCollaborators ?? []).toEqual(dropped(granted))
  })

  it.each([
    ["edit", "no grant", []], ["edit", "a grant", [GRANTEE]],
    ["own", "no grant", []], ["own", "a grant", [GRANTEE]],
  ] as const)("`%s` gets the moved row raw (the move drops %s)", async (access, _drops, granted) => {
    plugin(access)
    moveTables(granted)
    const res = await move(access === "own" ? CREATOR : OTHER)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ projectId: TARGET_PROJECT, workspaceId: TARGET_WS })
    const graph = res.json().data as Graph
    expect(graph.nodes).toEqual(PRODUCTION.nodes)
    expect(graph.settings.studio).toEqual(PRODUCTION.settings.studio)
    expect(res.json().droppedCollaborators ?? []).toEqual(dropped(granted))
  })
})

describe("GET /v1/public/workflows/:id — the share read never carries a production's owner state (T87)", () => {
  it("an ordinary production's stray owner state comes off its nodes and its settings", async () => {
    // Nothing on it reads as a linked production (no keyframes, sequences,
    // keyframe node or declared capability), so the share read projects it
    // here, not through the codec. Stray state from an older or foreign
    // writer still stays home.
    const still = (running: boolean) => ({ id: "still-1", type: "generate-image", position: { x: 0, y: 460 },
      data: { prompt: "Still", ...(running ? { keyframePendingImages: [FRAME_RUN] } : {}) } })
    const stray = { ...PRODUCTION, nodes: [clipNode(true), unitNode(true), still(true)],
      settings: { studio: { version: 3, shared: true, shots: [{ id: "AB" }], sequenceGenerationPolicies: { zoom: PREFERENCE },
        sequenceTakes: [take(true)], sequenceRecommendations: [RECOMMENDATION] } } }
    tables(stray)
    const res = await app.inject({ method: "GET", url: `/v1/public/workflows/${WF}` })
    expect(res.statusCode).toBe(200)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    const graph = res.json().data as Graph
    expect(graph.nodes).toEqual([clipNode(false), unitNode(false), still(false)])
    expect(graph.settings.studio).toEqual({ version: 3, shared: true, shots: [{ id: "AB" }],
      sequenceGenerationPolicies: {}, sequenceTakes: [take(false)] })
  })

  it("a linked production goes out only through the codec's public projection — never raw", async () => {
    tables()
    const res = await app.inject({ method: "GET", url: `/v1/public/workflows/${WF}` })
    expect(res.statusCode).toBe(404)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
  })
})
