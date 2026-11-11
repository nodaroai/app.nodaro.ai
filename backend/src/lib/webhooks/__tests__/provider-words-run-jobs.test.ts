/**
 * A RUN'S JOB in what a webhook carries (lib/provider-words.ts, decided
 * 2026-11-11). A `job.failed` event goes to the job's owner — whoever started
 * the run — so a job that belongs to a run of someone else's shared workflow
 * carries `error_detail` null: fresh, when a retry sends a kept body again, and
 * in the endpoint's delivery log. The workflow's creator (and a workspace
 * member it is shared with) gets the words; a job with no run is its owner's,
 * byte for byte as before. The run is looked up only for a body that carries
 * words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockWorkflowAccess, db } = vi.hoisted(() => ({
  mockWorkflowAccess: vi.fn(),
  db: { jobs: [] as Array<Record<string, unknown>>, runs: [] as Array<Record<string, unknown>>, reads: {} as Record<string, number> },
}))

vi.mock("../../supabase.js", () => {
  function table(name: string) {
    db.reads[name] = (db.reads[name] ?? 0) + 1
    const rows = name === "jobs" ? db.jobs : name === "workflow_executions" ? db.runs : []
    let select = ""
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const matched = () =>
      rows
        .filter((row) => filters.every((f) => f(row)))
        .map((row) => Object.fromEntries(select.split(",").map((c) => c.trim()).filter((c) => c in row).map((c) => [c, row[c]])))
    const chain: Record<string, unknown> = {
      select: (s: string) => { select = s; return chain },
      eq: (col: string, v: unknown) => { filters.push((row) => !(col in row) || row[col] === v); return chain },
      in: (col: string, vs: unknown[]) => { filters.push((row) => vs.includes(row[col])); return chain },
      is: (col: string, v: unknown) => { filters.push((row) => (row[col] ?? null) === v); return chain },
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: matched(), error: null }),
    }
    return chain
  }
  return { supabase: { from: (name: string) => table(name) } }
})
vi.mock("../../workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../workflow-access.js")>()),
  workflowAccess: mockWorkflowAccess,
}))

import { eventBodyFor, type ClaimedDelivery } from "../event.js"
import { toDeliveryResponse, type DeliveryRow } from "../endpoints.js"
import { webhookJobsWithheld } from "../../provider-words-readers.js"
import { config } from "../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { setTitleColumnPresentForTests } from "../../jobs-title-column.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000b1"
const OWN_WF = "00000000-0000-4000-8000-000000000020"
const SHARED_WF = "00000000-0000-4000-8000-000000000021"
const TEAM_WF = "00000000-0000-4000-8000-000000000022"
const RUN_OWN = "00000000-0000-4000-8000-000000000030"
const RUN_SHARED = "00000000-0000-4000-8000-000000000031"
const RUN_TEAM = "00000000-0000-4000-8000-000000000032"
const ACCESS: Record<string, string> = { [OWN_WF]: "own", [TEAM_WF]: "view", [SHARED_WF]: "none" }
const WORDS = "task failed: [400] the prompt 'a red fox at dawn, in the creator's style' was flagged"

function failedJob(run: string | null, words: string | null = WORDS): Record<string, unknown> {
  return {
    id: JOB,
    status: "failed",
    progress: 0,
    input_data: { type: "generate-image", prompt: "a lighthouse" },
    output_data: null,
    error_message: "The image model declined the prompt. Try different wording.",
    error_hint: null,
    error_detail: words,
    created_at: "2026-11-01T09:59:00+00:00",
    started_at: "2026-11-01T09:59:01+00:00",
    completed_at: "2026-11-01T10:00:00+00:00",
    user_id: OWNER,
    credits: 40,
    job_type: "generate-image",
    source: "sdk",
    source_detail: "sdk/2.27.0",
    session_id: null,
    title: null,
    reconcile_attempts: 0,
    usage_log_id: null,
    workflow_execution_id: run,
  }
}

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    deliveryId: "00000000-0000-4000-8000-0000000000d1",
    webhookId: "00000000-0000-4000-8000-0000000000e1",
    userId: OWNER,
    jobId: JOB,
    event: "job.failed",
    payload: null,
    attempts: 1,
    createdAt: "2026-11-01T10:00:00.123456+00:00",
    url: "https://hooks.example.com/in",
    secretCiphertext: "sealed",
    previousSecretCiphertext: null,
    runtimeEnv: "production",
    ...overrides,
  }
}

function deliveryRow(payload: unknown, jobId: string | null = JOB): DeliveryRow {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: "00000000-0000-4000-8000-0000000000e1",
    user_id: OWNER,
    job_id: jobId,
    event: "job.failed",
    status: "failed",
    attempts: 3,
    response_status: 500,
    response_body: "upstream unavailable",
    duration_ms: 120,
    last_error: "HTTP 500",
    payload,
    created_at: "2026-11-01T10:00:00+00:00",
    last_attempt_at: "2026-11-01T10:05:00+00:00",
    next_retry_at: null,
    delivered_at: null,
  }
}

/** The jobs table holds `job`; the reads made so far are forgotten. */
function holds(job: Record<string, unknown>): void {
  db.jobs = [job]
  db.reads = {}
  mockWorkflowAccess.mockClear()
}

async function freshBody(job: Record<string, unknown>): Promise<string> {
  holds(job)
  const built = await eventBodyFor(delivery())
  if (built.kind !== "body" || !built.fresh) throw new Error("expected a fresh body")
  return built.body
}

async function keptBody(payload: string, job: Record<string, unknown>): Promise<string> {
  holds(job)
  const built = await eventBodyFor(delivery({ payload, attempts: 3 }))
  if (built.kind !== "body" || built.fresh) throw new Error("expected the kept body")
  return built.body
}

/** A body recorded while every job's words were sent (before the run rule). */
function recordedWithWords(): string {
  return JSON.stringify({ id: "d1", type: "job.failed", createdAt: "2026-11-01T10:00:00.123Z", data: { job: { id: JOB, status: "failed", error_message: "declined", error_detail: WORDS } } })
}

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(() => {
  db.runs = [
    { id: RUN_OWN, user_id: OWNER, workflow_id: OWN_WF },
    { id: RUN_SHARED, user_id: OWNER, workflow_id: SHARED_WF },
    { id: RUN_TEAM, user_id: OWNER, workflow_id: TEAM_WF },
  ]
  mockWorkflowAccess.mockImplementation(async (_user: string, workflowId: string) => ACCESS[workflowId] ?? "none")
  setTitleColumnPresentForTests(true)
  config.EDITION = "business"
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

afterEach(() => {
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

describe("a job.failed event built fresh", () => {
  it("the workflow's creator gets the words on a run's job, byte for byte the body of a job with no run", async () => {
    const own = await freshBody(failedJob(RUN_OWN))
    expect(JSON.parse(own).data.job.error_detail).toBe(WORDS)
    expect(db.reads.workflow_executions).toBe(1)
    expect(own).not.toContain("workflow_execution_id")
    expect(own).toBe(await freshBody(failedJob(null)))
    expect(db.reads.workflow_executions).toBeUndefined()
  })

  it("a person who ran someone else's shared workflow gets error_detail null: the body of a failure with no words", async () => {
    const withheld = await freshBody(failedJob(RUN_SHARED))
    expect(JSON.parse(withheld).data.job).toHaveProperty("error_detail", null)
    expect(withheld).not.toContain("red fox")
    expect(withheld).toBe(await freshBody(failedJob(null, null)))
  })

  it("a workspace member the workflow is shared with gets the words", async () => {
    expect(JSON.parse(await freshBody(failedJob(RUN_TEAM))).data.job.error_detail).toBe(WORDS)
  })
})

describe("a kept body sent again by a retry", () => {
  it("of a run's job its owner cannot open: only its job's error_detail nulled", async () => {
    const first = recordedWithWords()
    const sent = await keptBody(first, failedJob(RUN_SHARED))
    expect(sent).toBe(first.replace(JSON.stringify(WORDS), "null"))
  })

  it("of their own workflow's run, or of a job with no run: the same text; the run id rides the child read", async () => {
    const first = recordedWithWords()
    expect(await keptBody(first, failedJob(RUN_OWN))).toBe(first)
    expect(db.reads.jobs).toBe(1)
    expect(await keptBody(first, failedJob(null))).toBe(first)
    expect(db.reads.workflow_executions).toBeUndefined()
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("of a run a workspace member can open: the same text", async () => {
    const first = recordedWithWords()
    expect(await keptBody(first, failedJob(RUN_TEAM))).toBe(first)
    expect(mockWorkflowAccess).toHaveBeenCalledWith(OWNER, TEAM_WF)
  })

  it("a body with no words looks no run up", async () => {
    const noWords = recordedWithWords().replace(JSON.stringify(WORDS), "null")
    expect(await keptBody(noWords, failedJob(RUN_SHARED))).toBe(noWords)
    expect(db.reads.workflow_executions).toBeUndefined()
  })
})

describe("the endpoint's delivery log", () => {
  it("withholds the words of a run's job its owner cannot open, and only those", async () => {
    const first = recordedWithWords()
    db.jobs = [
      { id: "j-shared", user_id: OWNER, workflow_execution_id: RUN_SHARED },
      { id: "j-own", user_id: OWNER, workflow_execution_id: RUN_OWN },
      { id: "j-single", user_id: OWNER, workflow_execution_id: null },
      { id: "j-team", user_id: OWNER, workflow_execution_id: RUN_TEAM },
    ]
    db.reads = {}
    const rows = [deliveryRow(first, "j-shared"), deliveryRow(first, "j-own"), deliveryRow(first, "j-single"), deliveryRow(first, null), deliveryRow(first, "j-team")]
    const withheld = await webhookJobsWithheld(OWNER, rows)
    expect([...withheld]).toEqual(["j-shared"])
    // One read of the jobs, one of their runs.
    expect(db.reads).toEqual({ jobs: 1, workflow_executions: 1 })
    const shown = rows.map((r) => toDeliveryResponse(r, false, r.job_id === null || !withheld.has(r.job_id)).requestBody)
    expect(shown).toEqual([first.replace(JSON.stringify(WORDS), "null"), first, first, first, first])
  })

  it("reads nothing when no kept body carries words, or the deployment keeps them for its admins", async () => {
    db.reads = {}
    const noWords = recordedWithWords().replace(JSON.stringify(WORDS), "null")
    expect(await webhookJobsWithheld(OWNER, [deliveryRow(noWords), deliveryRow(null)])).toEqual(new Set())
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
    __resetSurfaceProfileCacheForTests()
    expect(await webhookJobsWithheld(OWNER, [deliveryRow(recordedWithWords())])).toEqual(new Set())
    expect(db.reads).toEqual({})
  })
})
