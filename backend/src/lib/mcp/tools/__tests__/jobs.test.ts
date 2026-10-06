import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import { JOB_STATUSES } from "../../../job-status.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))
// The public scope loads the gallery's moderation (settings + accounts); these
// tests are about which jobs it lists, so it loads the built-in word list alone.
vi.mock("../../../gallery-moderation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gallery-moderation.js")>()
  return { ...actual, loadGalleryModeration: async () => actual.OWNER_VIEW_MODERATION }
})

const { registerJobs } = await import("../jobs.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockListJobs(rows: unknown[]) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  })
}

function mockGetJob(row: unknown | null) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    }),
  })
}

describe("list_jobs tool", () => {
  it("returns rows scoped to the session userId", async () => {
    mockListJobs([
      {
        id: "j1",
        status: "completed",
        job_type: "generate-image",
        created_at: "2026-04-01T00:00:00Z",
        credits: 2,
      },
    ])
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_jobs", { limit: 10 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"j1\"")
  })

  it("does NOT register without jobs:read scope", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_jobs")
  })

  it("redacts private remux bases from nested job data", async () => {
    mockListJobs([
      {
        id: "j1",
        status: "completed",
        job_type: "generate-video",
        created_at: "2026-04-01T00:00:00Z",
        input_data: { nested: { unscoredUrl: "https://private.example/input.mp4" } },
        output_data: {
          pro: {
            unscoredUrl: "https://private.example/base.mp4",
            finalUrl: "https://public.example/final.mp4",
          },
        },
      },
    ])
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })

    const result = await callTool(server, "list_jobs", { limit: 10 })

    expect(result.content[0]?.text).toContain("https://public.example/final.mp4")
    expect(result.content[0]?.text).not.toContain("unscoredUrl")
    expect(result.content[0]?.text).not.toContain("private.example")
  })
})

describe("get_job tool", () => {
  it("returns single job row when owned", async () => {
    mockGetJob({
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "u1",
      status: "completed",
      output_data: { imageUrl: "https://r2/x.png" },
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "11111111-1111-4111-8111-111111111111",
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("11111111-1111-4111-8111-111111111111")
  })

  it("adds retryable=false for a content-policy failure", async () => {
    mockGetJob({
      id: "22222222-2222-4222-8222-222222222222",
      user_id: "u1",
      status: "failed",
      error_message:
        "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "22222222-2222-4222-8222-222222222222",
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"retryable": false')
    expect(result.content[0]?.text).toMatch(/Content policy violation/)
  })

  it("PR9: offers suggestedProvider + guidance for a safety-block failure with a catalog fallback", async () => {
    mockGetJob({
      id: "44444444-4444-4444-8444-444444444444",
      user_id: "u1",
      status: "failed",
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "44444444-4444-4444-8444-444444444444",
    })
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0]?.text as string)
    expect(parsed.retryable).toBe(false)
    expect(parsed.suggestedProvider).toBe("nano-banana-pro")
    expect(parsed.guidance).toMatch(/retry the SAME/)
    expect(parsed.guidance).toContain("nano-banana-pro")
  })

  /**
   * A held job (spec 2026-09-03-job-policy-hook-design §6.4) takes neither the
   * failed branch nor a completed one: `status: "pending_review"` with
   * `output_data: null`. Technically correct and completely unactionable — the
   * agent polls forever or, worse, re-runs the request, and the duplicate is
   * held too.
   */
  it("explains a held job and tells the agent NOT to re-run it", async () => {
    mockGetJob({
      id: "55555555-5555-4555-8555-555555555555",
      user_id: "u1",
      status: "pending_review",
      output_data: null,
      error_message: null,
      progress: 100,
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "55555555-5555-4555-8555-555555555555",
    })
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0]?.text as string)
    expect(parsed.data.status).toBe("pending_review")
    expect(parsed.retryable).toBe(false)
    expect(parsed.guidance).toMatch(/do NOT re-run/i)
    expect(parsed.guidance).toMatch(/review/i)
    // It is NOT a failure — the failed-branch fields must not appear.
    expect(parsed.suggestedProvider).toBeUndefined()
  })

  it("list_jobs' status filter derives from JOB_STATUSES, so it admits pending_review", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    const status = (tools.find((t) => t.name === "list_jobs")?.inputSchema as
      | { properties?: { status?: { enum?: string[] } } }
      | undefined)?.properties?.status
    // A hand-rolled copy of the vocabulary silently omits every status added
    // after it was typed — this one omitted `pending_review` on day one.
    expect(status?.enum).toEqual([...JOB_STATUSES])
  })

  it("redacts private remux bases from input and output data", async () => {
    mockGetJob({
      id: "33333333-3333-4333-8333-333333333333",
      user_id: "u1",
      status: "completed",
      input_data: { unscoredUrl: "https://private.example/input.mp4" },
      output_data: {
        pro: {
          unscoredUrl: "https://private.example/base.mp4",
          finalUrl: "https://public.example/final.mp4",
        },
      },
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })

    const result = await callTool(server, "get_job", {
      job_id: "33333333-3333-4333-8333-333333333333",
    })

    expect(result.content[0]?.text).toContain("https://public.example/final.mp4")
    expect(result.content[0]?.text).not.toContain("unscoredUrl")
    expect(result.content[0]?.text).not.toContain("private.example")
  })

  it("returns isError when job not found", async () => {
    mockGetJob(null)
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    // Valid UUID that resolves to no row — exercises the maybeSingle-null
    // not-found path (a non-UUID would short-circuit at the guard below).
    const result = await callTool(server, "get_job", {
      job_id: "00000000-0000-0000-0000-000000000000",
    })
    expect(result.isError).toBe(true)
  })

  it("returns a clean not-found for a non-UUID job_id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
    // The raw Postgres "invalid input syntax for type uuid" must never leak.
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    // Guard short-circuits before touching Supabase.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without jobs:read scope", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("get_job")
  })
})

// ── Audit 2026-09-06 fix #2: one envelope + a supported wait ────────────────
function mockJobReads(rows: Array<unknown | null>) {
  const queue = [...rows]
  const maybeSingle = vi.fn().mockImplementation(() => Promise.resolve({ data: queue.length > 1 ? queue.shift() : queue[0], error: null }))
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = maybeSingle
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  return { maybeSingle }
}
const JOB = "11111111-1111-4111-8111-111111111111"
const jobsSession = () => newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" })

describe("get_job — the one job envelope", () => {
  it("declares the envelope as outputSchema and returns it as structuredContent", async () => {
    mockGetJob({ id: JOB, user_id: "u1", status: "completed", job_type: "generate-image", progress: 100, output_data: { imageUrl: "https://r2/x.png" }, credits: 12 })
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const tool = tools.find((t) => t.name === "get_job")
    expect((tool as { outputSchema?: unknown } | undefined)?.outputSchema).toBeDefined()
    expect((tool?.description ?? "")).toContain("every 5")
    const result = await callTool(server, "get_job", { job_id: JOB })
    expect(result.isError).toBeUndefined()
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.jobId).toBe(JOB)
    expect(sc.status).toBe("completed")
    expect(sc.outputUrl).toBe("https://r2/x.png")
    expect(sc.assetKind).toBe("image")
    // The text envelope is unchanged for existing clients.
    expect(result.content[0]?.text).toContain('"data"')
  })

  it("carries the allowlisted input so a server-side prompt fold can be verified (F12)", async () => {
    mockGetJob({
      id: JOB, user_id: "u1", status: "completed", job_type: "generate-video", progress: 100,
      output_data: { videoUrl: "https://r2/x.mp4" }, credits: 40,
      input_data: {
        prompt: "a woman turns, match cut", userPrompt: "a woman turns", direction: { transition: "match-cut" },
        endFrameUrl: "https://r2/b.png", workflowId: "wf-internal", nodeId: "n-internal",
      },
    })
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "get_job", { job_id: JOB })
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.input).toEqual({
      prompt: "a woman turns, match cut",
      userPrompt: "a woman turns",
      direction: { transition: "match-cut" },
      endFrameUrl: "https://r2/b.png",
    })
  })
})

describe("wait_for_job tool", () => {
  it("blocks until the owned job completes and returns the envelope", async () => {
    mockJobReads([
      { id: JOB, user_id: "u1", status: "processing", job_type: "generate-image", output_data: null, error_message: null },
      { id: JOB, user_id: "u1", status: "completed", job_type: "generate-image", output_data: { imageUrl: "https://r2/x.png" }, error_message: null },
    ])
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "wait_for_job", { job_id: JOB, timeout_s: 30 })
    expect(result.isError).toBeUndefined()
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe("completed")
    expect(sc.outputUrl).toBe("https://r2/x.png")
    expect(sc.jobId).toBe(JOB)
  })

  it("answers status timeout (not an error) when the job is still running at the deadline, with next-step guidance", async () => {
    mockJobReads([{ id: JOB, user_id: "u1", status: "processing", job_type: "generate-video", output_data: null, error_message: null }])
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "wait_for_job", { job_id: JOB, timeout_s: 1 })
    expect(result.isError).toBeUndefined()
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe("timeout")
    expect(result.content[0]?.text).toContain("wait_for_job again")
  })

  it("returns not found for a job the caller does not own — never waits on it", async () => {
    const { maybeSingle } = mockJobReads([null])
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "wait_for_job", { job_id: JOB, timeout_s: 30 })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })

  it("caps timeout_s at 120 in the schema and does NOT register without jobs:read", async () => {
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const tools = await listTools(server)
    const tool = tools.find((t) => t.name === "wait_for_job")
    const schema = tool?.inputSchema as { properties?: Record<string, { maximum?: number }> }
    expect(schema.properties?.timeout_s?.maximum).toBe(120)
    const noScope = buildServer()
    registerJobs({ server: noScope, session: newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }), fastify: Fastify() })
    expect((await listTools(noScope)).map((t) => t.name)).not.toContain("wait_for_job")
  })
})

// ── The Preview label on an old render (round 2, decided 2026-10-06) ────────
// A render recorded before its quality was stored carries none in output_data.
// The job reads fill it from the order, by the one rule (`jobRowStamp`), in the
// response only — the same fill the job-status routes apply.
describe("MCP job reads fill the Preview label of an old render", () => {
  const render = (over: Record<string, unknown>) => ({
    id: JOB,
    user_id: "u1",
    status: "completed",
    job_type: "apply-edl",
    progress: 100,
    input_data: { quality: "proxy" },
    output_data: { videoUrl: "https://r2/cut.mp4" },
    error_message: null,
    ...over,
  })

  it("get_job: an order at proxy is a Preview — output_data.quality filled, in the text and the envelope", async () => {
    mockGetJob(render({}))
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "get_job", { job_id: JOB })
    const sc = result.structuredContent as { outputData?: Record<string, unknown>; preview?: boolean }
    expect(sc.outputData?.quality).toBe("proxy")
    expect(sc.preview).toBe(true)
    const text = JSON.parse(result.content[0]?.text as string) as { data: { output_data: Record<string, unknown> } }
    expect(text.data.output_data.quality).toBe("proxy")
  })

  it("get_job: an order at any other quality is the final — labelled final, never a Preview", async () => {
    mockGetJob(render({ input_data: { quality: "final" } }))
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "get_job", { job_id: JOB })
    const sc = result.structuredContent as { outputData?: Record<string, unknown>; preview?: boolean }
    expect(sc.outputData?.quality).toBe("final")
    expect(sc.preview).toBeUndefined()
  })

  it("get_job: a stored label wins over the order, and a job that is not a render is left alone", async () => {
    mockGetJob(render({ input_data: { quality: "final" }, output_data: { videoUrl: "https://r2/cut.mp4", quality: "proxy" } }))
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const stored = await callTool(server, "get_job", { job_id: JOB })
    expect((stored.structuredContent as { outputData?: Record<string, unknown> }).outputData?.quality).toBe("proxy")

    mockGetJob(render({ job_type: "generate-video", input_data: { quality: "proxy" } }))
    const other = await callTool(server, "get_job", { job_id: JOB })
    const sc = other.structuredContent as { outputData?: Record<string, unknown>; preview?: boolean }
    expect(sc.outputData).not.toHaveProperty("quality")
    expect(sc.preview).toBeUndefined()
  })

  it("wait_for_job: the finished render's envelope carries the filled label", async () => {
    mockJobReads([
      render({ status: "processing", output_data: null }),
      render({}),
    ])
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "wait_for_job", { job_id: JOB, timeout_s: 30 })
    const sc = result.structuredContent as { status?: string; outputData?: Record<string, unknown>; preview?: boolean }
    expect(sc.status).toBe("completed")
    expect(sc.outputData?.quality).toBe("proxy")
    expect(sc.preview).toBe(true)
  })

  it("the envelope declares `preview` in its outputSchema", async () => {
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    for (const name of ["get_job", "wait_for_job"]) {
      const tool = (await listTools(server)).find((t) => t.name === name)
      const schema = (tool as { outputSchema?: { properties?: Record<string, unknown> } } | undefined)?.outputSchema
      expect(schema?.properties, name).toHaveProperty("preview")
    }
  })
})

// ── list_jobs lists Apply EDL renders (round 3, decided 2026-10-06) ─────────
// Apply EDL is on the `video` and `audio` kinds: a render is listed under the
// kind its OUTPUT is (a cut is a video, a mix is an audio), per job. It is
// OWNER-ONLY: `scope: "public"` never lists one — a Preview is private, and a
// final by a user whose outputs are public would be exposure nobody decided.
// The Preview label an old render lacks is filled from its order, with `preview`.
describe("list_jobs and Apply EDL renders", () => {
  const edl = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: "completed",
    job_type: "apply-edl",
    created_at: "2026-10-06T00:00:00Z",
    input_data: { quality: "proxy", output: "video" },
    output_data: { videoUrl: "https://r2/cut.mp4" },
    ...over,
  })
  const mix = (id: string, over: Record<string, unknown> = {}) =>
    edl(id, { input_data: { quality: "final", output: "audio" }, output_data: { audioUrl: "https://r2/mix.m4a" }, ...over })
  const generated = {
    id: "v1",
    status: "completed",
    job_type: "generate-video",
    created_at: "2026-10-06T00:00:00Z",
    input_data: { quality: "proxy" },
    output_data: { videoUrl: "https://r2/v.mp4" },
  }
  const listed = async (rows: unknown[], args: Record<string, unknown>) => {
    mockListJobs(rows)
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "list_jobs", { limit: 10, ...args })
    return (JSON.parse(result.content[0]?.text as string) as { data: Array<Record<string, any>> }).data
  }
  const ids = (rows: Array<Record<string, any>>) => rows.map((r) => r.id)

  it("lists a render under the kind its output is — a cut under video, a mix under audio — per job", async () => {
    const rows = [edl("cut"), mix("mix")]
    expect(ids(await listed(rows, {}))).toEqual(["cut"])
    expect(ids(await listed(rows, { kinds: ["video"] }))).toEqual(["cut"])
    expect(ids(await listed(rows, { kinds: ["audio"] }))).toEqual(["mix"])
    expect(ids(await listed(rows, { kinds: ["image", "video", "audio"] }))).toEqual(["cut", "mix"])
    expect(ids(await listed(rows, { kinds: ["image"] }))).toEqual([])
  })

  it("an in-flight render has no output yet: its order's medium decides", async () => {
    const rows = [
      edl("run-v", { status: "processing", output_data: null }),
      edl("run-a", { status: "processing", output_data: null, input_data: { quality: "final", output: "audio" } }),
    ]
    expect(ids(await listed(rows, { kinds: ["video"] }))).toEqual(["run-v"])
    expect(ids(await listed(rows, { kinds: ["audio"] }))).toEqual(["run-a"])
  })

  it("an old proxy row has its output_data.quality filled and is marked a Preview; a final is labelled final, no marker", async () => {
    const rows = await listed([edl("old"), edl("fin", { input_data: { quality: "final", output: "video" } })], {})
    expect(rows[0]?.output_data.quality).toBe("proxy")
    expect(rows[0]?.preview).toBe(true)
    expect(rows[1]?.output_data.quality).toBe("final")
    expect(rows[1]).not.toHaveProperty("preview")
  })

  it("a stored label wins over the order", async () => {
    const [row] = await listed([edl("stored", { input_data: { quality: "final", output: "video" }, output_data: { videoUrl: "https://r2/cut.mp4", quality: "proxy" } })], {})
    expect(row?.output_data.quality).toBe("proxy")
    expect(row?.preview).toBe(true)
  })

  it("the rows around it are passed through as they were: no label, no marker, no helper columns", async () => {
    const rows = await listed([edl("e1"), generated], {})
    expect(ids(rows)).toEqual(["e1", "v1"])
    expect(rows[1]?.output_data).toEqual({ videoUrl: "https://r2/v.mp4" })
    expect(rows[1]).not.toHaveProperty("preview")
    expect(rows[1]).not.toHaveProperty("input_quality")
  })

  it("scope public never lists an Apply EDL render — not a Preview, not a final, whatever the rows hold", async () => {
    const rows = [edl("p1", { user_id: "someone-else" }), edl("f1", { user_id: "someone-else", input_data: { quality: "final", output: "video" } }), mix("m1", { user_id: "someone-else" }), { ...generated, user_id: "someone-else" }]
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Proxy({}, { get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => void) => res({ data: rows, error: null }) : () => (supabase.from as any)()) }),
    )
    const server = buildServer()
    registerJobs({ server, session: jobsSession(), fastify: Fastify() })
    const result = await callTool(server, "list_jobs", { limit: 10, scope: "public", kinds: ["image", "video", "audio"] })
    const data = (JSON.parse(result.content[0]?.text as string) as { data: Array<Record<string, any>> }).data
    expect(ids(data)).toEqual(["v1"])
  })

  /** Pins exactly where Apply EDL sits: the video and the audio kind, never the image kind. */
  it("Apply EDL is on exactly the video and audio kinds' allowlists", () => {
    const src = readFileSync(join(__dirname, "..", "jobs.ts"), "utf8")
    const block = src.slice(src.indexOf("const setForKind"), src.indexOf("const kinds ="))
    expect(block.length).toBeGreaterThan(100)
    const arrays = Object.fromEntries([...block.matchAll(/\b(image|video|audio): \[([^\]]*)\]/g)].map((m) => [m[1], m[2] ?? ""]))
    expect(Object.keys(arrays).sort()).toEqual(["audio", "image", "video"])
    expect(arrays.video).toMatch(/["']apply-edl["']/)
    expect(arrays.audio).toMatch(/["']apply-edl["']/)
    expect(arrays.image).not.toMatch(/["']apply-edl["']/)
    expect(block.match(/["']apply-edl["']/g)).toHaveLength(2)
  })
})
