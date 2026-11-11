/**
 * A failed job's provider words (`jobs.error_detail`) on the MCP job reads,
 * under the deployment's `jobs.errorDetail` setting (lib/provider-words.ts).
 *
 * Off (no surface profile, today's behaviour): the owner reads the words.
 * "admin": an MCP session is never an admin reader, so every job read answers
 * exactly as it does for a failure the provider said nothing about — the same
 * keys, `error_detail` / `errorDetail` null.
 *
 * Each "admin" case runs the same failed job twice — once carrying words, once
 * without — and requires the two answers to be identical. diagnose_run has its
 * own file (provider-words-diagnose.test.ts): its supabase mock is per table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, type ToolCallResult } from "./_helpers.js"
import { config } from "../../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))
// The public scope loads the gallery's moderation; these tests list the caller's own jobs.
vi.mock("../../../gallery-moderation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gallery-moderation.js")>()
  return { ...actual, loadGalleryModeration: async () => actual.OWNER_VIEW_MODERATION }
})
// The owner's favorite/rating reads have their own tests (jobs-favorites-ratings).
vi.mock("../../../job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))
// A run's steps (child jobs): none.
vi.mock("../../../job-run-steps.js", () => ({ runStepsOf: async () => ({ steps: new Map(), incomplete: new Set<string>() }) }))
// A job waiting for a slot: no queue known.
vi.mock("../../../concurrency-lanes/queue-info.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../concurrency-lanes/queue-info.js")>()),
  queueInfoFor: async () => new Map(),
}))

const { registerJobs } = await import("../jobs.js")
const { registerGallery } = await import("../gallery.js")
const { jobView } = await import("../_job-view.js")
const { supabase } = await import("../../../supabase.js")

const JOB = "11111111-1111-4111-8111-111111111111"
const WORDS = "task failed: [400] Request blocked: The uploaded image may contain protected or restricted IP content."
const SENTENCE = "The video model declined one of your pictures as possibly copyrighted. Try a different picture."

/** A failed job of the caller's, with the provider's words or without any. */
function failedJob(words: string | null, over: Record<string, unknown> = {}): Record<string, unknown> & { id: string } {
  return {
    id: JOB,
    user_id: "u1",
    status: "failed",
    progress: 0,
    job_type: "generate-image",
    input_data: { provider: "nano-banana", prompt: "a cat" },
    output_data: null,
    error_message: SENTENCE,
    error_detail: words,
    error_hint: null,
    created_at: "2026-11-11T10:00:00Z",
    started_at: "2026-11-11T10:00:01Z",
    completed_at: "2026-11-11T10:00:20Z",
    credits: 12,
    ...over,
  }
}

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

/** The deployment keeps the provider's words for its admins. */
function wordsForAdminsOnly(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
  // The same edition in both modes: only the profile differs between them.
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

const session = () => newSession({ userId: "u1", scopes: ["jobs:read", "assets:read"] as Scope[], clientName: "Claude" })

function serverWithJobTools() {
  const server = buildServer()
  registerJobs({ server, session: session(), fastify: Fastify() })
  registerGallery({ server, session: session(), fastify: Fastify() })
  return server
}

const fromMock = () => supabase.from as unknown as ReturnType<typeof vi.fn>

/** get_job's read: `.select().eq().eq().is().is().maybeSingle()`. */
function mockGetJob(row: unknown): void {
  const is = vi.fn()
  is.mockReturnValue({ is, maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })
  fromMock().mockReturnValue({
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ is }) }) }),
  })
}

/** Every read answers the next row in turn; the last row answers every read after it. */
function mockJobReads(rows: unknown[]): void {
  const queue = [...rows]
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.is = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve({ data: queue.length > 1 ? queue.shift() : queue[0], error: null }))
  fromMock().mockReturnValue(chain)
}

/** list_jobs' read (scope mine): `.select().eq().is()…order().limit()`. */
function mockListJobs(rows: unknown[]): void {
  const is = vi.fn()
  const tail: Record<string, unknown> = {
    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
  }
  tail.is = is
  is.mockReturnValue(tail)
  fromMock().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ is }) }) })
}

/** get_asset's read, whatever its filter chain: `maybeSingle()` answers the row. */
function mockAssetRead(row: unknown): void {
  const promise = Promise.resolve({ data: row, error: null })
  const chain: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return promise.then.bind(promise)
      if (prop === "maybeSingle") return () => promise
      return () => chain
    },
    apply: () => chain,
  })
  fromMock().mockReturnValue(chain)
}

const structured = (r: ToolCallResult) => r.structuredContent as Record<string, unknown>
const textJson = (r: ToolCallResult) => JSON.parse(r.content[0]?.text as string) as Record<string, any>

describe("jobView — the provider's words in the job envelope", () => {
  it("carries the words when the setting is off", () => {
    expect(jobView(failedJob(WORDS)).errorDetail).toBe(WORDS)
  })

  it("is null with the setting at admin, even when handed a row that still carries the words", () => {
    wordsForAdminsOnly()
    const view = jobView(failedJob(WORDS))
    expect(view).toHaveProperty("errorDetail", null)
    expect(view).toEqual(jobView(failedJob(null)))
    expect(JSON.stringify(view)).not.toContain(WORDS)
  })

  it("an explicit owner setting reads like no setting", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "owner" } })
    __resetSurfaceProfileCacheForTests()
    expect(jobView(failedJob(WORDS)).errorDetail).toBe(WORDS)
  })
})

describe("get_job — the provider's words", () => {
  async function getJob(row: Record<string, unknown>) {
    mockGetJob(row)
    const result = await callTool(serverWithJobTools(), "get_job", { job_id: JOB })
    expect(result.isError).toBeUndefined()
    return result
  }

  it("the owner reads them in the envelope and the text when the setting is off", async () => {
    const result = await getJob(failedJob(WORDS))
    expect(structured(result).errorDetail).toBe(WORDS)
    expect(textJson(result).data.error_detail).toBe(WORDS)
  })

  it("with the setting at admin the job reads as one the provider said nothing about", async () => {
    wordsForAdminsOnly()
    const withheld = await getJob(failedJob(WORDS))
    expect(structured(withheld)).toHaveProperty("errorDetail", null)
    expect(textJson(withheld).data).toHaveProperty("error_detail", null)
    expect(JSON.stringify(withheld)).not.toContain(WORDS)

    const none = await getJob(failedJob(null))
    expect(structured(withheld)).toEqual(structured(none))
    expect(textJson(withheld)).toEqual(textJson(none))
  })
})

describe("wait_for_job — the provider's words on a failed job", () => {
  async function waitFor(row: Record<string, unknown>) {
    // The ownership read, then the wait and the full read answer the failed row.
    mockJobReads([{ id: JOB }, row])
    const result = await callTool(serverWithJobTools(), "wait_for_job", { job_id: JOB, timeout_s: 30 })
    expect(result.isError).toBeUndefined()
    expect(structured(result).status).toBe("failed")
    return result
  }

  it("the owner reads them when the setting is off", async () => {
    const result = await waitFor(failedJob(WORDS))
    expect(structured(result).errorDetail).toBe(WORDS)
  })

  it("with the setting at admin the envelope reads as a failure with no words", async () => {
    wordsForAdminsOnly()
    const withheld = await waitFor(failedJob(WORDS))
    expect(structured(withheld)).toHaveProperty("errorDetail", null)
    expect(JSON.stringify(withheld)).not.toContain(WORDS)

    const none = await waitFor(failedJob(null))
    expect(structured(withheld)).toEqual(structured(none))
    expect(withheld.content).toEqual(none.content)
  })
})

describe("list_jobs — the provider's words on each of your failed jobs", () => {
  const OTHER_WORDS = "task failed: [422] the reference clip is longer than the model accepts."
  const rows = (first: string | null, second: string | null) => [
    failedJob(first, { id: "j1", created_at: "2026-11-11T10:00:02Z" }),
    failedJob(second, { id: "j2", job_type: "image-to-video", created_at: "2026-11-11T10:00:01Z" }),
  ]

  async function listed(page: unknown[]) {
    mockListJobs(page)
    const result = await callTool(serverWithJobTools(), "list_jobs", { limit: 10 })
    expect(result.isError).toBeUndefined()
    const { data } = textJson(result) as { data: Array<Record<string, unknown>> }
    expect(data.map((r) => r.id)).toEqual(["j1", "j2"])
    return { result, data }
  }

  it("the owner reads them on every row when the setting is off", async () => {
    const { data } = await listed(rows(WORDS, OTHER_WORDS))
    expect(data.map((r) => r.error_detail)).toEqual([WORDS, OTHER_WORDS])
  })

  it("with the setting at admin every row reads as a failure with no words", async () => {
    wordsForAdminsOnly()
    const withheld = await listed(rows(WORDS, OTHER_WORDS))
    for (const row of withheld.data) expect(row).toHaveProperty("error_detail", null)
    expect(JSON.stringify(withheld.result)).not.toContain(WORDS)
    expect(JSON.stringify(withheld.result)).not.toContain(OTHER_WORDS)

    const none = await listed(rows(null, null))
    expect(withheld.data).toEqual(none.data)
  })
})

describe("get_asset — the provider's words on a failed job", () => {
  async function getAsset(row: Record<string, unknown>) {
    mockAssetRead(row)
    const result = await callTool(serverWithJobTools(), "get_asset", { job_id: JOB })
    expect(result.isError).toBeUndefined()
    expect(structured(result).status).toBe("failed")
    return result
  }

  it("the owner reads them when the setting is off", async () => {
    const result = await getAsset(failedJob(WORDS))
    expect(structured(result).errorDetail).toBe(WORDS)
  })

  it("with the setting at admin the asset reads as a failure with no words", async () => {
    wordsForAdminsOnly()
    const withheld = await getAsset(failedJob(WORDS))
    expect(structured(withheld)).toHaveProperty("errorDetail", null)
    expect(JSON.stringify(withheld)).not.toContain(WORDS)

    const none = await getAsset(failedJob(null))
    expect(structured(withheld)).toEqual(structured(none))
    expect(withheld.content).toEqual(none.content)
  })
})
