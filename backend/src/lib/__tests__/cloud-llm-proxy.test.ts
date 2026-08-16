import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The LLM lane never reaches the capability router and mostly answers
 * synchronously, so neither the provider registry nor the job-replay path can
 * cover it. These tests pin the two things the route proxy must get right:
 * a local key always wins, and media on THIS instance is re-hosted before the
 * body is forwarded (the cloud refuses private hosts — the same wall
 * image-to-video hit).
 */
const env = {
  KIE_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  R2_PUBLIC_URL: "",
  PUBLIC_URL: "",
  R2_PUBLIC_FALLBACK_DOMAIN: "",
}
vi.mock("../config.js", () => ({ config: env }))

const getNodaroConnection = vi.fn()
vi.mock("../nodaro-connect.js", () => ({
  getNodaroConnection: () => getNodaroConnection(),
  nodaroCloudBase: () => "https://cloud.example",
}))

const ensureCloudReachableMediaUrl = vi.fn(async (u: string) => u)
vi.mock("../../providers/nodaro/client.js", () => ({
  ensureCloudReachableMediaUrl: (u: string) => ensureCloudReachableMediaUrl(u),
}))

/** The local mirror row. Default: the insert succeeds and hands back a local id. */
type InsertResult = { data: { id: string } | null; error: { message: string } | null }
const insertJob = vi.fn(
  async (_req: unknown, _row: Record<string, unknown>): Promise<InsertResult> => ({ data: { id: "local-job-1" }, error: null }),
)
vi.mock("../insert-job.js", () => ({
  insertJob: (req: unknown, row: Record<string, unknown>) => insertJob(req, row),
}))

const { maybeProxyLlmRouteToCloud, maybeProxyLlmStreamToCloud, shouldProxyLlmToCloud, stripInstanceLocalKeys } =
  await import("../cloud-llm-proxy.js")

function makeReply() {
  const state: Record<string, unknown> = {}
  const reply = {
    status: vi.fn((s: number) => { state.status = s; return reply }),
    header: vi.fn(() => reply),
    send: vi.fn((b: unknown) => { state.body = b; return reply }),
    raw: {},
    state,
  }
  return reply
}
const req = { body: {}, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never

describe("shouldProxyLlmToCloud", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
  })

  it("is false when ANY local LLM key exists — a keyed install keeps its own path", async () => {
    for (const key of ["KIE_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const) {
      env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
      env[key] = "set"
      expect(await shouldProxyLlmToCloud(), key).toBe(false)
    }
  })

  it("is false with no connection, so a keyless unconnected install still fails locally with its own message", async () => {
    getNodaroConnection.mockResolvedValue(null)
    expect(await shouldProxyLlmToCloud()).toBe(false)
  })

  it("is true only when keyless AND connected", async () => {
    expect(await shouldProxyLlmToCloud()).toBe(true)
  })
})

describe("maybeProxyLlmRouteToCloud", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) =>
      u.includes("localhost") ? "https://cloud/up/x.png" : u,
    )
  })

  it("declines and lets the local path run when a key is present", async () => {
    env.KIE_API_KEY = "kie"
    const reply = makeReply()
    expect(await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check", "qa-check")).toBe(false)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it("forwards the body and mirrors the cloud's status and payload verbatim", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const reply = makeReply()
    const handled = await maybeProxyLlmRouteToCloud(
      { body: { content: "hi" }, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never,
      reply as never,
      "/v1/qa-check",
      "qa-check",
    )
    expect(handled).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://cloud.example/v1/qa-check",
      expect.objectContaining({ method: "POST" }),
    )
    expect(reply.state.status).toBe(200)
    expect(reply.state.body).toBe(JSON.stringify({ ok: true }))
    fetchSpy.mockRestore()
  })

  it("passes a cloud error through unchanged — a 402 must still read as 402", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "insufficient_credits" } }), { status: 402 }),
    )
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check", "qa-check")
    expect(reply.state.status).toBe(402)
    expect(String(reply.state.body)).toContain("insufficient_credits")
    fetchSpy.mockRestore()
  })

  it("re-hosts instance-local media but leaves prompts containing links alone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {
          imageUrl: "http://localhost:3000/storage/images/a.png",
          prompt: "describe http://localhost:3000/storage/images/a.png",
        },
        raw: { on: vi.fn() },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/image-critic",
      "image-critic",
    )
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.imageUrl).toBe("https://cloud/up/x.png")
    expect(sent.prompt).toBe("describe http://localhost:3000/storage/images/a.png")
    fetchSpy.mockRestore()
  })

  it("answers 502 with an actionable message when the cloud is unreachable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"))
    const reply = makeReply()
    expect(await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check", "qa-check")).toBe(true)
    expect(reply.state.status).toBe(502)
    expect(JSON.stringify(reply.state.body)).toContain("Integrations")
    fetchSpy.mockRestore()
  })
})


describe("nested media and client disconnect", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) =>
      u.includes("localhost") ? "https://cloud/up/x.png" : u,
    )
  })

  it("re-hosts media nested inside arrays of objects", async () => {
    // scene-graph takes assets[].url. A top-level-only walk left those local
    // and the cloud refused the whole request.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {
          assets: [
            { id: "a", url: "http://localhost:3000/storage/images/a.png" },
            { id: "b", url: "https://public.example/b.png" },
          ],
        },
        raw: { on: vi.fn() },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/scene-graph/generate",
      "scene-graph-ai",
    )
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.assets[0].url).toBe("https://cloud/up/x.png")
    expect(sent.assets[1].url).toBe("https://public.example/b.png")
    fetchSpy.mockRestore()
  })

  it("aborts the upstream call when the client disconnects", async () => {
    // Otherwise the cloud keeps generating — and billing — for an answer
    // nobody will read.
    let onClose: (() => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      onClose?.()
      expect((init as RequestInit).signal?.aborted).toBe(true)
      return new Response("{}", { status: 200 })
    })
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {},
        raw: { on: (ev: string, cb: () => void) => { if (ev === "close") onClose = cb } },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/qa-check",
      "qa-check",
    )
    expect(fetchSpy).toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

/**
 * A job lives in exactly one database. The two things that follow — and that
 * a direct single-node call can never catch, because only the ORCHESTRATOR
 * puts `workflowId` in the body and only the orchestrator polls the returned
 * `jobId` in the local jobs table. Choose Best inside a workflow on a
 * connected keyless install (2026-08-16): the cloud 500'd on the foreign
 * `workflowId`, and had it not, "Job <cloud id> not found" was next.
 */
describe("orchestrated calls: instance-local keys and the mirrored job", () => {
  const orchestratorBody = {
    strategyId: "pick-best-llm",
    strategyConfig: { criteria: "Pick the highest-quality result." },
    inputs: ["a", "b"],
    workflowId: "9adc452f-ed39-4dcb-b3a2-e0454003e257",
    nodeId: "node_4",
    userId: "3d5da08c-ec5e-43ae-80d3-29b53f126abf",
    forcePrivate: true,
  }
  const orchestratorReq = () =>
    ({ body: { ...orchestratorBody }, userId: orchestratorBody.userId, raw: { on: vi.fn() }, log: { error: vi.fn() } }) as never

  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) => u)
    insertJob.mockReset().mockResolvedValue({ data: { id: "local-job-1" }, error: null })
  })

  it("stripInstanceLocalKeys removes exactly workflowId / nodeId / userId and nothing else", () => {
    expect(stripInstanceLocalKeys(orchestratorBody)).toEqual({
      strategyId: "pick-best-llm",
      strategyConfig: { criteria: "Pick the highest-quality result." },
      inputs: ["a", "b"],
      forcePrivate: true,
    })
    // Non-objects pass through; the caller's body is never mutated.
    expect(stripInstanceLocalKeys(null)).toBeNull()
    expect(stripInstanceLocalKeys(["x"])).toEqual(["x"])
    expect(orchestratorBody.workflowId).toBe("9adc452f-ed39-4dcb-b3a2-e0454003e257")
  })

  it("the cloud never sees the local workflowId / nodeId / userId — the rest of the body travels intact", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    await maybeProxyLlmRouteToCloud(orchestratorReq(), makeReply() as never, "/v1/reduce", "reduce")
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent).not.toHaveProperty("workflowId")
    expect(sent).not.toHaveProperty("nodeId")
    expect(sent).not.toHaveProperty("userId")
    expect(sent).toMatchObject({ strategyId: "pick-best-llm", inputs: ["a", "b"], forcePrivate: true })
    fetchSpy.mockRestore()
  })

  it("the stream variant strips the same keys", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
    )
    const raw = { writeHead: vi.fn(), write: vi.fn(() => true), end: vi.fn(), once: vi.fn(), destroyed: false, headersSent: false }
    const req = { body: { ...orchestratorBody }, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never
    await maybeProxyLlmStreamToCloud(req, { raw } as never, "/v1/llm-chat/generate-stream")
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent).not.toHaveProperty("workflowId")
    expect(sent).not.toHaveProperty("userId")
    expect(sent.strategyId).toBe("pick-best-llm")
    fetchSpy.mockRestore()
  })

  it("mirrors a finished cloud job as a local completed row and answers with the LOCAL jobId", async () => {
    const cloudAnswer = { jobId: "cloud-job-9", output: "a", meta: { selectedIndex: 0 } }
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(cloudAnswer), { status: 200, headers: { "content-type": "application/json" } }),
    )
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(orchestratorReq(), reply as never, "/v1/reduce", "reduce")

    // The row: attributed HERE (the keys the cloud must not see), completed,
    // and its output_data IS the cloud answer — so pollJobToCompletion reads
    // exactly what the sync path would have read from the response.
    expect(insertJob).toHaveBeenCalledTimes(1)
    const row = insertJob.mock.calls[0]![1]
    expect(row).toMatchObject({
      user_id: orchestratorBody.userId,
      workflow_id: orchestratorBody.workflowId,
      node_id: "node_4",
      force_private: true,
      status: "completed",
      provider: "nodaro",
      input_data: { type: "reduce", viaNodaroCloud: true, cloudJobId: "cloud-job-9" },
      output_data: { output: "a", meta: { selectedIndex: 0 }, viaNodaroCloud: true, cloudJobId: "cloud-job-9" },
    })
    expect(row.output_data).not.toHaveProperty("jobId")

    // The answer: same payload, jobId rewritten to the local row.
    expect(reply.state.status).toBe(200)
    const body = JSON.parse(String(reply.state.body))
    expect(body).toMatchObject({ jobId: "local-job-1", output: "a", meta: { selectedIndex: 0 }, viaNodaroCloud: true, cloudJobId: "cloud-job-9" })
    fetchSpy.mockRestore()
  })

  it("still delivers the answer when the mirror row cannot be written — without a jobId that resolves nowhere", async () => {
    insertJob.mockResolvedValue({ data: null, error: { message: "db down" } })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "cloud-job-9", output: "a" }), { status: 200 }),
    )
    const req = orchestratorReq()
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/reduce", "reduce")
    const body = JSON.parse(String(reply.state.body))
    expect(body).not.toHaveProperty("jobId")
    expect(body).toMatchObject({ output: "a", viaNodaroCloud: true, cloudJobId: "cloud-job-9" })
    expect((req as { log: { error: ReturnType<typeof vi.fn> } }).log.error).toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("does not mirror when there is no local user on the request (no owner for the row)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobId: "cloud-job-9", output: "a" }), { status: 200 }),
    )
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      { body: { inputs: ["a"] }, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never,
      reply as never,
      "/v1/reduce",
      "reduce",
    )
    expect(insertJob).not.toHaveBeenCalled()
    expect(JSON.parse(String(reply.state.body))).not.toHaveProperty("jobId")
    fetchSpy.mockRestore()
  })

  it("passes through untouched whatever is not a finished job: errors, non-JSON, JSON without a jobId", async () => {
    const cases: Array<[Response, string]> = [
      [new Response(JSON.stringify({ jobId: "cloud-job-9", error: { code: "insufficient_credits" } }), { status: 402 }), "a 402 keeps its body and its jobId"],
      [new Response("not json", { status: 200 }), "non-JSON"],
      [new Response(JSON.stringify({ text: "no job here" }), { status: 200 }), "JSON without a jobId"],
      [new Response(JSON.stringify([1, 2]), { status: 200 }), "a JSON array"],
    ]
    for (const [res, label] of cases) {
      insertJob.mockClear()
      const expected = await res.clone().text()
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(res)
      const reply = makeReply()
      await maybeProxyLlmRouteToCloud(orchestratorReq(), reply as never, "/v1/reduce", "reduce")
      expect(String(reply.state.body), label).toBe(expected)
      expect(insertJob, label).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    }
  })
})
