// @test-units-by-name names no node unit's entry: it only stubs CreditsService's app-run eligibility
/**
 * Recordings as app inputs (decided 2026-11-13): a published app's, a component's or a share link's
 * one-off voice clone speaks only in the RUNNER's own two recordings, on the runner's own consent.
 * At every door (an app's runner, a component's caller, a share link's viewer):
 * - with nothing of the runner's, or the runner's recordings without the runner's own tick (or with
 *   the author's record replayed), the run is refused before anything is written or queued — and
 *   the author's recordings (an older snapshot still holding them) are never read for it;
 * - with the runner's own recordings and tick, it runs, and only the runner's recordings are read;
 * - where the deployment withholds one-off clones, refused (403) before anything is written;
 * - a dialogue's clone no line speaks with is not asked for;
 * - a clone inside a sub-workflow the run executes cannot take the runner's recordings: refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { SentinelCase } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const h = vi.hoisted(() => ({
  current: null as SentinelCase | null,
  queueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  executeAppRun: vi.fn(),
  insertJob: vi.fn(),
  readReplica: vi.fn(),
  denied: undefined as string | undefined,
  maxRuns: null as number | null,
  writes: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true, hasOrganizations: () => false }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: h.queueAdd } }))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: h.insertJob, insertJobIdempotent: vi.fn(), billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }) }))
vi.mock("@/lib/voice-replica.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice-replica.js")>()),
  readReplica: h.readReplica,
}))
vi.mock("@/lib/availability-viewer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability-viewer.js")>()),
  deniedCapabilityForUser: vi.fn(async () => h.denied),
}))

import { presentationRoutes } from "../presentation.js"
import { componentExecuteRoutes } from "../component-execute.js"
import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../ee/billing/credits.js"
import { signReplicaConsent } from "../../lib/voice-clone-consent.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const RUNNER = "00000000-0000-4000-8000-0000000000c3"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const SUB_ID = "00000000-0000-4000-8000-000000000021"
const SLUG = "clone-app"

const AUTHORS = { sourceAudioUrl: "https://media.example/author-reference.wav", consentAudioUrl: "https://media.example/author-consent.wav" }
const RUNNERS = { sourceAudioUrl: "https://media.example/runner-reference.wav", consentAudioUrl: "https://media.example/runner-consent.wav" }
const RUNNERS_TICK = signReplicaConsent(RUNNER, RUNNERS)
const AUTHORS_TICK_ON_RUNNERS = signReplicaConsent(AUTHOR, RUNNERS)

const at = { x: 0, y: 0 }
/** An older snapshot that still holds the author's recordings and tick: the run must never use them. */
const tts = { id: "tts", type: "text-to-speech", position: at, data: { label: "Narration", provider: "gemini-3-8-flash-tts", directText: "Hello there.", replica: AUTHORS, replicaConsent: signReplicaConsent(AUTHOR, AUTHORS) } }
const dialogue = {
  id: "dlg",
  type: "text-to-dialogue",
  position: at,
  data: {
    label: "Talk",
    provider: "gemini-3-8-flash-tts",
    dialogue: [{ text: "Hello.", voice: "Me" }, { text: "Hi.", voice: "Kore" }],
    // "Me" speaks a line; "Spare" is a clone no line speaks with.
    speakers: [{ voice: "Me", replica: { sourceAudioUrl: "", consentAudioUrl: "" } }, { voice: "Spare", replica: { sourceAudioUrl: "", consentAudioUrl: "" } }],
  },
}
const asCase = (name: string, nodes: unknown[], workflows: SentinelCase["workflows"] = {}): SentinelCase =>
  ({ name, graph: { nodes, edges: [] }, workflows, settings: {} }) as unknown as SentinelCase

/** The case published (an app's or a component's snapshot) and shared (a share link), the author's other workflows by id. */
function serve(): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = h.current!
    let id: unknown
    const appRow = {
      id: "app-1", workflow_id: WORKFLOW_ID, creator_id: AUTHOR, name: "Clone", version: 1, max_runs_per_user_per_day: h.maxRuns,
      snapshot_nodes: c.graph.nodes, snapshot_edges: c.graph.edges, snapshot_settings: c.settings, publish_type: "app",
      component_metadata: { inputs: [], outputs: [], exposedSettings: [] }, estimated_credits: 0,
    }
    const one = () => {
      if (table === "published_apps") return appRow
      if (table === "workflows") {
        if (typeof id === "string" && Object.hasOwn(c.workflows, id)) return c.workflows[id]
        if (typeof id === "string" && id !== WORKFLOW_ID) return null
        return { id: WORKFLOW_ID, name: "Shared", user_id: AUTHOR, workspace_id: null, settings: c.settings, nodes: c.graph.nodes, edges: c.graph.edges, is_presentation_enabled: true }
      }
      if (table === "workflow_executions" || table === "app_runs") return { id: "row-1", status: "failed", node_states: {} }
      return null
    }
    const many = () => (table === "published_apps" ? [appRow] : [])
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: many(), error: null, count: 0 })
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: one(), error: null })
        if (prop === "insert" || prop === "update" || prop === "upsert") {
          return () => {
            h.writes.push(table)
            return new Proxy({}, handler)
          }
        }
        if (prop === "eq") {
          return (column: string, value: unknown) => {
            if (column === "id") id = value
            return new Proxy({}, handler)
          }
        }
        return () => new Proxy({}, handler)
      },
    }
    return new Proxy({}, handler) as never
  }) as never)
}

let app: FastifyInstance
let eligibility: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  h.writes.length = 0
  h.denied = undefined
  h.maxRuns = null
  invalidateAppCache(SLUG)
  h.executeAppRun.mockResolvedValue({ executionId: "exec-1", appRunId: "run-1", deduped: false })
  h.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  h.readReplica.mockResolvedValue({})
  eligibility = vi.spyOn(CreditsService, "checkAppRunEligibility").mockResolvedValue({ allowed: true } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = RUNNER
    req.authKind = "jwt"
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
    await appRunnerRoutes(instance)
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

afterEach(async () => {
  await settle()
  eligibility.mockRestore()
  await app.close()
})

const ROUTES = [
  { route: "a share link's viewer", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: "/v1/present/share-token-abc/run", payload: { inputOverrides } }) },
  { route: "an app's runner", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/run`, payload: { inputOverrides } }) },
  { route: "a component's caller", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: "/v1/component/execute", payload: { appSlug: SLUG, inputOverrides } }) },
] as const

/** Nothing was written, queued or started. */
function nothingStarted(): void {
  expect(h.writes, "nothing written before the refusal").toEqual([])
  expect(h.queueAdd).not.toHaveBeenCalled()
  expect(h.executeAppRun).not.toHaveBeenCalled()
  expect(h.insertJob).not.toHaveBeenCalled()
}

/** Every recording any check read: never the author's. */
function readLinks(): string[] {
  return h.readReplica.mock.calls.flatMap(([r]) => [(r as typeof RUNNERS).sourceAudioUrl, (r as typeof RUNNERS).consentAudioUrl])
}

describe.each(ROUTES.map((r) => [r.route, r] as const))("%s", (_route, r) => {
  it("Text to Speech: refused with nothing, without the runner's tick, or with the author's tick; runs with the runner's own", async () => {
    h.current = asCase("tts", [tts])
    serve()
    const nothing = await r.run({})
    expect(nothing.statusCode, nothing.body).toBe(400)
    expect(nothing.json().error.code).toBe("clone_recordings_required")
    for (const replicaConsent of [undefined, true, AUTHORS_TICK_ON_RUNNERS]) {
      invalidateAppCache(SLUG)
      const refused = await r.run({ tts: { replica: RUNNERS, ...(replicaConsent !== undefined ? { replicaConsent } : {}) } })
      expect(refused.statusCode, refused.body).toBe(400)
      expect(refused.json().error.code).toBe("clone_consent_required")
    }
    nothingStarted()
    expect(h.readReplica).not.toHaveBeenCalled()
    invalidateAppCache(SLUG)
    const runs = await r.run({ tts: { replica: RUNNERS, replicaConsent: RUNNERS_TICK } })
    expect(runs.statusCode, runs.body).toBe(202)
    expect(readLinks()).toEqual([RUNNERS.sourceAudioUrl, RUNNERS.consentAudioUrl])
  })

  it("a recording the check refuses (not a WAV, too long): refused before anything starts", async () => {
    h.current = asCase("tts", [tts])
    serve()
    const { ReplicaRecordingError } = await import("../../lib/voice-replica.js")
    h.readReplica.mockRejectedValueOnce(new ReplicaRecordingError("replica_not_wav", "source", "The reference recording must be a WAV file."))
    const refused = await r.run({ tts: { replica: RUNNERS, replicaConsent: RUNNERS_TICK } })
    expect(refused.statusCode, refused.body).toBe(400)
    expect(refused.json().error.code).toBe("replica_not_wav")
    nothingStarted()
  })

  it("withheld from the runner (voice-clone-one-off): 403 before anything starts", async () => {
    h.current = asCase("tts", [tts])
    serve()
    h.denied = "a one-off voice clone"
    const refused = await r.run({ tts: { replica: RUNNERS, replicaConsent: RUNNERS_TICK } })
    expect(refused.statusCode, refused.body).toBe(403)
    expect(refused.json().error.code).toBe("node_not_available")
    nothingStarted()
  })

  it("Text to Dialogue: the speaker a line uses needs the runner's own; the unused clone is not asked for", async () => {
    h.current = asCase("dialogue", [dialogue])
    serve()
    const refused = await r.run({})
    expect(refused.statusCode, refused.body).toBe(400)
    expect(refused.json().error.code).toBe("clone_recordings_required")
    nothingStarted()
    invalidateAppCache(SLUG)
    const speakers = [{ voice: "Me", replica: RUNNERS, replicaConsent: RUNNERS_TICK }, dialogue.data.speakers[1]]
    const runs = await r.run({ dlg: { speakers } })
    expect(runs.statusCode, runs.body).toBe(202)
    expect(readLinks()).toEqual([RUNNERS.sourceAudioUrl, RUNNERS.consentAudioUrl])
  })
})

describe("the recordings are read only after the run's cheaper checks", () => {
  it("an app run over its daily limit is refused without downloading the runner's recordings", async () => {
    h.current = asCase("tts", [tts])
    h.maxRuns = 0
    serve()
    const run = ROUTES.find((x) => x.route === "an app's runner")!.run
    const refused = await run({ tts: { replica: RUNNERS, replicaConsent: RUNNERS_TICK } })
    expect(refused.statusCode, refused.body).toBe(429)
    expect(h.readReplica).not.toHaveBeenCalled()
    nothingStarted()
  })
})

describe("a clone the runner's recordings cannot reach", () => {
  it("inside a sub-workflow the app runs: refused before anything starts", async () => {
    h.current = asCase(
      "nested",
      [{ id: "sub", type: "sub-workflow", position: at, data: { label: "Voice part", workflowId: SUB_ID } }],
      { [SUB_ID]: { id: SUB_ID, user_id: AUTHOR, nodes: [tts], edges: [] } } as unknown as SentinelCase["workflows"],
    )
    serve()
    const run = ROUTES.find((x) => x.route === "an app's runner")!.run
    const refused = await run({})
    expect(refused.statusCode, refused.body).toBe(400)
    expect(refused.json().error.code).toBe("clone_not_fillable")
    nothingStarted()
  })
})
