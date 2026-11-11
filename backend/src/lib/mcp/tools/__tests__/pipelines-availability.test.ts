/**
 * The MCP doors of the film pipeline (`film-pipeline`) and the Video Director
 * (`video-director`), gateable features (lib/availability-override.ts):
 *
 *  - the tools that start or continue a pipeline's work (`start_pipeline`,
 *    `branch_pipeline`, `chat_pipeline_stage`, `apply_chat_proposal`) and the
 *    Video Director's (`create_explainer`, `create_launch_video`) are not
 *    listed where the deployment withholds the feature; the pipeline read
 *    tools stay. The pipeline tools call the services directly, past every
 *    route door, so a call that still arrives is refused there too, with the
 *    routes' `node_not_available`, before any service runs.
 *  - `start_pipeline` / `branch_pipeline` stamp the payer the REST lane
 *    stamps: a deployment payer when one is configured (it pays, and the
 *    user's allowance counts the run); nothing at all for a personal account
 *    on an install with no billing service, exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../admin-check.js", () => ({ checkIsAdmin: async () => false }))
// The real resolver, watched: a personal account's call must never reach it.
const resolver = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock("../../../billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../billing-context.js")>()
  return {
    ...actual,
    resolveBillingContext: (input: Parameters<typeof actual.resolveBillingContext>[0], opts?: Parameters<typeof actual.resolveBillingContext>[1]) => {
      resolver.calls.push(input)
      return actual.resolveBillingContext(input, opts)
    },
  }
})

const services = vi.hoisted(() => ({
  createPipeline: vi.fn(),
  branchPipeline: vi.fn(),
}))
vi.mock("../../../../ee/pipelines/create-pipeline.js", () => ({
  createPipeline: (...args: unknown[]) => services.createPipeline(...args),
}))
vi.mock("../../../../ee/pipelines/branch-pipeline.js", () => ({
  branchPipeline: (...args: unknown[]) => services.branchPipeline(...args),
  BranchPipelineError: class BranchPipelineError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
    }
  },
}))

const { registerPipelineTools } = await import("../pipelines.js")
const { registerVideoDirectorTools } = await import("../video-director-tools.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../surface-profile.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled } = await import(
  "../../../availability-override.js"
)
const { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } = await import("../../../deployment-payer.js")

const PIPELINE_TOOLS_THAT_WORK = ["start_pipeline", "branch_pipeline", "chat_pipeline_stage", "apply_chat_proposal"]
const PIPELINE_READ_TOOLS = ["get_pipeline_stage_chat", "get_pipeline_status", "pipeline_pending_approvals"]
const DIRECTOR_TOOLS = ["create_explainer", "create_launch_video"]
const ALL_SCOPES = ["pipelines:execute", "pipelines:approve", "pipelines:read", "workflows:execute"] as Scope[]

const PIPELINE_ID = "aaaaaaaa-0000-4000-8000-000000000001"

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function session(extra: { workspaceId?: string } = {}) {
  return newSession({ userId: "u1", scopes: ALL_SCOPES, clientName: "Claude", ...extra })
}

async function listed(): Promise<string[]> {
  const server = buildServer()
  const s = session()
  registerPipelineTools({ server, session: s })
  registerVideoDirectorTools({ server, session: s, fastify: Fastify() } as Parameters<typeof registerVideoDirectorTools>[0])
  return (await listTools(server)).map((t) => t.name)
}

beforeEach(async () => {
  await __availabilityUniverseReadyForTests()
  services.createPipeline.mockReset().mockResolvedValue({ ok: true, pipelineId: "p-new" })
  services.branchPipeline.mockReset().mockResolvedValue({ newPipelineId: "p-branch", clonedStages: ["script"], clonedEntities: 0 })
})
afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetDeploymentPayerForTests()
})

describe("the tool list follows the features", () => {
  it("lists every tool on a deployment with no node lists and no override (nothing changes)", async () => {
    const names = await listed()
    for (const t of [...PIPELINE_TOOLS_THAT_WORK, ...PIPELINE_READ_TOOLS, ...DIRECTOR_TOOLS]) expect(names, t).toContain(t)
  })

  it("under nodes.allow without the ids: no tool that starts work, the pipeline reads stay", async () => {
    setProfile({ nodes: { allow: ["generate-image", "generative-pipeline"] } })
    const names = await listed()
    for (const t of [...PIPELINE_TOOLS_THAT_WORK, ...DIRECTOR_TOOLS]) expect(names, t).not.toContain(t)
    for (const t of PIPELINE_READ_TOOLS) expect(names, t).toContain(t)
  })

  it("each feature lists its own tools only", async () => {
    setProfile({ nodes: { allow: ["generate-image", "film-pipeline"] } })
    let names = await listed()
    for (const t of PIPELINE_TOOLS_THAT_WORK) expect(names, t).toContain(t)
    for (const t of DIRECTOR_TOOLS) expect(names, t).not.toContain(t)
    setProfile({ nodes: { allow: ["generate-image", "video-director"] } })
    names = await listed()
    for (const t of PIPELINE_TOOLS_THAT_WORK) expect(names, t).not.toContain(t)
    for (const t of DIRECTOR_TOOLS) expect(names, t).toContain(t)
  })

  it("lists them under an override stored before they were gateable", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image", "cast-swap"], 1)) })
    const names = await listed()
    for (const t of [...PIPELINE_TOOLS_THAT_WORK, ...DIRECTOR_TOOLS]) expect(names, t).toContain(t)
  })

  it("lists none under an override saved by this code with them off (discovery shows the users' view)", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    const names = await listed()
    for (const t of [...PIPELINE_TOOLS_THAT_WORK, ...DIRECTOR_TOOLS]) expect(names, t).not.toContain(t)
  })
})

describe("a pipeline tool called where the feature is withheld is refused before any service runs", () => {
  it("start_pipeline and branch_pipeline answer node_not_available", async () => {
    // Listed under no lists, then the deployment's answer changes before the call.
    const server = buildServer()
    registerPipelineTools({ server, session: session() })
    setProfile({ nodes: { allow: ["generate-image"] } })
    for (const [name, args] of [
      ["start_pipeline", { story_prompt: "A lighthouse keeper's last night." }],
      ["branch_pipeline", { pipeline_id: PIPELINE_ID, from_stage: "script" }],
      ["chat_pipeline_stage", { pipeline_id: PIPELINE_ID, stage: "script", message: "Shorter." }],
      ["apply_chat_proposal", { pipeline_id: PIPELINE_ID, stage: "script", turn_id: PIPELINE_ID }],
    ] as const) {
      const res = await callTool(server, name, args)
      expect(res.isError, name).toBe(true)
      const text = res.content[0]?.type === "text" ? res.content[0].text : ""
      expect(text, name).toContain("node_not_available")
      expect(text, name).toContain("film-pipeline")
    }
    expect(services.createPipeline).not.toHaveBeenCalled()
    expect(services.branchPipeline).not.toHaveBeenCalled()
  })
})

describe("the payer a pipeline an MCP tool starts is stamped with — the REST lane's", () => {
  it("a deployment payer pays (start_pipeline and branch_pipeline)", async () => {
    __setDeploymentPayerForTests("payer-1")
    const server = buildServer()
    registerPipelineTools({ server, session: session() })

    await callTool(server, "start_pipeline", { story_prompt: "A lighthouse keeper's last night." })
    expect(services.createPipeline).toHaveBeenCalledTimes(1)
    expect(services.createPipeline.mock.calls[0]![0]).toMatchObject({
      userId: "u1",
      billingContext: { payer: "deployment", userId: "u1", payerId: "payer-1" },
    })

    await callTool(server, "branch_pipeline", { pipeline_id: PIPELINE_ID, from_stage: "script" })
    expect(services.branchPipeline).toHaveBeenCalledTimes(1)
    expect(services.branchPipeline.mock.calls[0]![0]).toMatchObject({
      userId: "u1",
      billingContext: { payer: "deployment", userId: "u1", payerId: "payer-1" },
    })
  })

  it("a personal account: no payer stamp and no resolve at all, exactly as before (whatever billing service is installed)", async () => {
    resolver.calls.length = 0
    const server = buildServer()
    registerPipelineTools({ server, session: session() })
    await callTool(server, "start_pipeline", { story_prompt: "A lighthouse keeper's last night." })
    await callTool(server, "branch_pipeline", { pipeline_id: PIPELINE_ID, from_stage: "script" })
    expect(services.createPipeline.mock.calls[0]![0]).toMatchObject({ userId: "u1" })
    expect(services.createPipeline.mock.calls[0]![0].billingContext).toBeUndefined()
    expect(services.branchPipeline.mock.calls[0]![0].billingContext).toBeUndefined()
    expect(resolver.calls).toEqual([])
  })

  it("a session bound to a workspace still resolves that workspace (rung 2), as before", async () => {
    resolver.calls.length = 0
    const server = buildServer()
    registerPipelineTools({ server, session: session({ workspaceId: "ws-1" }) })
    await callTool(server, "start_pipeline", { story_prompt: "A lighthouse keeper's last night." })
    expect(resolver.calls).toEqual([{ userId: "u1", explicitWorkspaceId: "ws-1" }])
  })
})
