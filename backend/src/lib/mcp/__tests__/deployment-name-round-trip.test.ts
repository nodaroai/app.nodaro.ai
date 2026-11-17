/**
 * What the user stored is never rewritten, and the platform's own words a run
 * saved are (decided 2026-11-16,
 * `lib/mcp/deployment-name.ts`): on a deployment with its own name, a workflow
 * whose nodes name the platform is read by `get_workflow_json` exactly as it
 * reads with the platform's name, and written back by `update_workflow_json`
 * exactly as it was read — a successful reply relays the user's content as it
 * is, which is why the funnel is applied where the lane writes its own words
 * and not to a successful reply as it leaves.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import Fastify from "fastify"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "ORGS_ENABLED", "NODARO_PRICE_ANNOTATIONS"]) process.env[key] = ""
})

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** Every `update` payload a table was written with. */
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

vi.mock("../../supabase.js", () => {
  const from = (table: string) => {
    // An `eq` on a column the row has keeps the rows that match it; every other filter keeps all.
    const eqs: Array<[string, unknown]> = []
    const rows = () => (h.tables[table] ?? []).filter((r) => eqs.every(([col, v]) => !(col in (r as object)) || (r as Record<string, unknown>)[col] === v))
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "neq", "is", "in", "not", "or", "order", "limit", "lt", "lte", "gt", "gte", "filter", "range", "contains", "match", "insert", "upsert", "delete"]) {
      chain[m] = () => chain
    }
    chain.eq = (col: string, v: unknown) => {
      eqs.push([col, v])
      return chain
    }
    chain.update = (payload: Record<string, unknown>) => {
      h.updates.push({ table, payload })
      return chain
    }
    chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    chain.single = async () => ({ data: rows()[0] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
    return chain
  }
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } }
})
// Media the graph names is not fetched here: every link is kept as it is.
vi.mock("../../media-portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../media-portability.js")>()
  return {
    ...actual,
    rehostForeignMedia: async (nodes: readonly unknown[], userId: string, opts: { assets?: unknown; settings?: Record<string, unknown> } = {}) => {
      const { report } = await actual.rehostForeignMedia([], userId)
      return { nodes: [...nodes], ...(opts.assets ? { assets: opts.assets } : {}), ...(opts.settings ? { settings: opts.settings } : {}), report }
    },
  }
})
vi.mock("../../../ee/lib/free-video-limits-for.js", () => ({ freeVideoLimitsFor: async () => null }))

const { buildMcpServer } = await import("../server.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
import { ALL_SCOPES } from "../../scopes.js"

const USER_ID = "c0000000-0000-4000-8000-00000000000c"
const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

/** A graph the user wrote, naming the platform in every way the funnel's rules read. */
const NODES = [
  {
    id: "t1",
    type: "text",
    position: { x: 0, y: 0 },
    data: { label: "Nodaro intro", text: "Made with Nodaro — a Nodaro job id, Video Remake, NODARO, on Nodaro Cloud, at studio.nodaro.ai: https://nodaro.ai/docs" },
  },
  { id: "g1", type: "generate-image", position: { x: 300, y: 0 }, data: { prompt: "a Nodaro logo on a shirt", provider: "gpt-image-2" } },
]
const EDGES = [{ id: "e1", source: "t1", target: "g1", sourceHandle: "text", targetHandle: "prompt" }]

function setProfile(profile: unknown) {
  process.env.NODARO_SURFACE_PROFILE = profile === undefined ? "" : JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}
afterEach(() => setProfile(undefined))

/** The graph read with get_workflow_json, then written back as read: the reply and the write. */
async function readAndWriteBack(): Promise<{ read: string; written: Record<string, unknown> }> {
  h.updates = []
  h.tables = {
    projects: [{ id: PROJECT_ID }],
    workflows: [{ id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: USER_ID, name: "Nodaro demo", nodes: NODES, edges: EDGES, settings: {}, updated_at: "2026-11-16T00:00:00Z", version: 3 }],
  }
  const server = await buildMcpServer({ userId: USER_ID, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify(), conversation: { client: "claude", key: null } })
  const got = await callTool(server, "get_workflow_json", { workflow_id: WORKFLOW_ID })
  expect(got.isError, got.content[0]?.text).toBeUndefined()
  const read = got.content[0]!.text!
  const doc = JSON.parse(read) as { nodes: unknown[]; edges: unknown[]; version: number }
  const put = await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: doc.nodes, edges: doc.edges, expected_version: doc.version })
  expect(put.isError, put.content[0]?.text).toBeUndefined()
  const write = h.updates.find((u) => u.table === "workflows" && Array.isArray(u.payload.nodes))
  expect(write, "update_workflow_json wrote the graph").toBeDefined()
  return { read, written: write!.payload }
}

describe("a workflow that names the platform, on a deployment with its own name", () => {
  it("reads and writes back exactly as it does with the platform's name", async () => {
    const platform = await readAndWriteBack()
    setProfile({ brand: { productName: "Acme Studio" } })
    const own = await readAndWriteBack()
    expect(own.read).toBe(platform.read)
    expect(own.read).toContain("a Nodaro logo on a shirt")
    expect(own.read).toContain("https://nodaro.ai/docs")
    expect(own.written.nodes).toEqual(platform.written.nodes)
    expect(own.written.edges).toEqual(platform.written.edges)
    // And what was written is what the user wrote.
    const text = (own.written.nodes as typeof NODES).find((n) => n.id === "t1")!.data
    expect(text).toMatchObject(NODES[0]!.data)
    expect((own.written.nodes as typeof NODES).find((n) => n.id === "g1")!.data).toMatchObject({ prompt: "a Nodaro logo on a shirt" })
  })
})

const JOB_ID = "a2000000-0000-4000-8000-0000000000a2"
const EXECUTION_ID = "e2000000-0000-4000-8000-0000000000e2"
/** Failure words the platform saved with a run, naming it as its routes and engine write them. */
const SAVED_JOB_ERROR = "This clip is 90 seconds long. Nodaro Video Upscale takes clips of up to 60 seconds. Choose Topaz to upscale it."
const SAVED_NODE_ERROR = "This workflow uses a node that runs on Nodaro Cloud only: remove it, or run the workflow on Nodaro Cloud."
const SAVED_RUN_ERROR = "Generative Pipeline runs on Nodaro Cloud only — this workflow can't execute it on a self-hosted install."
/** What the user wrote into the job: never rewritten. */
const USER_PROMPT = "a Nodaro sign over the door"

function failedRun() {
  h.updates = []
  h.tables = {
    projects: [{ id: PROJECT_ID }],
    workflows: [{ id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: USER_ID, name: "Flow", nodes: NODES, edges: EDGES, settings: {}, updated_at: "2026-11-16T00:00:00Z", version: 3 }],
    jobs: [
      {
        id: JOB_ID, user_id: USER_ID, status: "failed", progress: 0, job_type: "video-upscale",
        input_data: { type: "video-upscale", prompt: USER_PROMPT }, output_data: null,
        error_message: SAVED_JOB_ERROR, error_detail: null, error_hint: null,
        created_at: "2026-11-16T00:00:00Z", started_at: "2026-11-16T00:00:01Z", completed_at: "2026-11-16T00:00:02Z", credits: 0,
        workflow_execution_id: null,
      },
    ],
    workflow_executions: [
      {
        id: EXECUTION_ID, user_id: USER_ID, workflow_id: WORKFLOW_ID, status: "failed", trigger_type: "manual", trigger_data: null,
        node_states: { g1: { status: "failed", error: SAVED_NODE_ERROR, jobId: JOB_ID } },
        error_message: SAVED_RUN_ERROR, total_credits_used: 0,
        created_at: "2026-11-16T00:00:00Z", started_at: "2026-11-16T00:00:01Z", completed_at: "2026-11-16T00:00:02Z",
      },
    ],
  }
}

/** Every read of the failed run a client can make, serialized as it receives them. */
async function readFailedRun(): Promise<Record<string, string>> {
  failedRun()
  const server = await buildMcpServer({ userId: USER_ID, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify(), conversation: { client: "claude", key: null } })
  const out: Record<string, string> = {}
  for (const [tool, args] of [
    ["get_job", { job_id: JOB_ID }],
    ["wait_for_job", { job_id: JOB_ID }],
    ["list_jobs", { status: "failed", types: ["video-upscale"] }],
    ["get_asset", { job_id: JOB_ID }],
    ["get_app_run", { execution_id: EXECUTION_ID }],
    ["diagnose_run", { id: EXECUTION_ID }],
    ["diagnose_run", { id: JOB_ID }],
  ] as const) {
    out[`${tool} ${JSON.stringify(args)}`] = JSON.stringify(await callTool(server, tool, args))
  }
  return out
}

describe("the platform's words a run saved, on a deployment with its own name", () => {
  it("every read of a failed job and run says the deployment's name; what the user wrote is kept", async () => {
    const platform = await readFailedRun()
    // With the platform's name the words are as saved.
    expect(Object.values(platform).join("\n")).toContain("Nodaro Video Upscale takes clips")
    setProfile({ brand: { productName: "Acme Studio" } })
    const own = await readFailedRun()
    for (const [read, reply] of Object.entries(own)) {
      const words = reply.split(USER_PROMPT).join("")
      expect(words, read).not.toMatch(/\bNodaro\b/)
    }
    const all = Object.values(own).join("\n")
    expect(all).toContain("Acme Studio Video Upscale takes clips of up to 60 seconds")
    expect(all).toContain("runs on the Cloud edition only")
    // The prompt the user wrote is in the job's input as they wrote it, wherever a read shows it.
    for (const [read, reply] of Object.entries(platform)) {
      if (reply.includes(USER_PROMPT)) expect(own[read], read).toContain(USER_PROMPT)
    }
  })
})
