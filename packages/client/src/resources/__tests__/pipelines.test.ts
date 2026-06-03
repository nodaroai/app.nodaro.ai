import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NodaroError,
  NotFoundError,
  ForbiddenError,
} from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("pipelines resource", () => {
  it("branch POSTs to /v1/pipelines/:id/branch with fromStage in body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ pipelineId: "new-pipe-1", clonedStages: ["script"], clonedEntities: 3 }, 201),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.branch("orig-pipe-1", { fromStage: "characters" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines/orig-pipe-1/branch")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({ fromStage: "characters" })
    expect(result.pipelineId).toBe("new-pipe-1")
    expect(result.clonedStages).toEqual(["script"])
    expect(result.clonedEntities).toBe(3)
  })

  it("branch encodes the pipeline id in the URL", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ pipelineId: "p2", clonedStages: [], clonedEntities: 0 }, 201),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.pipelines.branch("pipe/with/slashes", { fromStage: "script" })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/pipe%2Fwith%2Fslashes/branch",
    )
  })

  it("branch throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Pipeline not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.pipelines.branch("missing", { fromStage: "script" })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("branch throws ForbiddenError on 403", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(403, { error: { code: "forbidden" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.pipelines.branch("other-user-pipe", { fromStage: "locations" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  // ── chatStage / applyChatProposal / getStageChat (Phase 1D.2b §5.9) ──────

  it("chatStage POSTs to /v1/pipelines/:id/stages/:stage/chat with {message} body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        turnId: "turn-1",
        role: "assistant",
        content: "Got it — I tightened Act II.",
        proposed_change: null,
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("tk"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.chatStage(
      "pipe-1",
      "script",
      "Make Act II tighter, please.",
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines/pipe-1/stages/script/chat")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers["Authorization"]).toBe("Bearer tk")
    expect(JSON.parse(init.body)).toEqual({ message: "Make Act II tighter, please." })
    expect(result.turnId).toBe("turn-1")
    expect(result.role).toBe("assistant")
    expect(result.proposed_change).toBeNull()
  })

  it("chatStage encodes the pipeline id and stage in the URL", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ turnId: "t", role: "assistant", content: "", proposed_change: null }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.pipelines.chatStage("pipe/with/slashes", "script", "hi")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/pipe%2Fwith%2Fslashes/stages/script/chat",
    )
  })

  it("chatStage propagates a proposed_change of edit_artifact verbatim", async () => {
    const proposed = {
      change_type: "edit_artifact" as const,
      json_patch: [{ op: "replace" as const, path: "/title", value: "New Title" }],
      summary: "Rename title.",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        turnId: "turn-7",
        role: "assistant",
        content: "Renamed.",
        proposed_change: proposed,
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.chatStage("p1", "script", "Rename the title")
    expect(result.proposed_change).toEqual(proposed)
  })

  it("chatStage throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.pipelines.chatStage("missing", "script", "hi"),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("applyChatProposal POSTs to /v1/pipelines/:id/stages/:stage/chat/turns/:turnId/apply with empty body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ applied: true, attemptId: "att-9", newOutput: { plan: { v: 2 } } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("tk"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.applyChatProposal("pipe-1", "script", "turn-7")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://api.example.com/v1/pipelines/pipe-1/stages/script/chat/turns/turn-7/apply",
    )
    expect(init.method).toBe("POST")
    expect(init.headers["Authorization"]).toBe("Bearer tk")
    expect(JSON.parse(init.body)).toEqual({})
    expect(result).toEqual({ applied: true, attemptId: "att-9", newOutput: { plan: { v: 2 } } })
  })

  it("applyChatProposal encodes all three path segments", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ applied: true, attemptId: "a", newOutput: {} }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.pipelines.applyChatProposal("p/1", "script", "t/1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/p%2F1/stages/script/chat/turns/t%2F1/apply",
    )
  })

  it("applyChatProposal returns {applied:false,error} for recoverable failures (200 response)", async () => {
    // The route returns 200 with `{ applied: false, error }` for
    // schema_invalid / reference_integrity_failed — recoverable cases where a
    // follow-up assistant turn was inserted in chat. Hard failures (409) take
    // the throw path tested below.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        applied: false,
        error: { code: "schema_invalid", detail: { path: "/scenes/0", message: "required" } },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.applyChatProposal("p1", "script", "t1")
    expect(result.applied).toBe(false)
    if (!result.applied) {
      expect(result.error.code).toBe("schema_invalid")
    }
  })

  it("applyChatProposal throws on hard failure (409)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "stage_not_awaiting" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.pipelines.applyChatProposal("p1", "script", "t1"),
    ).rejects.toBeInstanceOf(NodaroError)
  })

  it("getStageChat GETs /v1/pipelines/:id/stages/:stage/chat", async () => {
    const turn = {
      id: "turn-1",
      turn_n: 1,
      role: "user" as const,
      content: "hello",
      proposed_change: null,
      llm_call_id: null,
      applied_to_attempt_id: null,
      created_at: "2026-05-21T00:00:00Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ turns: [turn] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("tk"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.getStageChat("pipe-1", "script")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines/pipe-1/stages/script/chat")
    expect(init.method).toBe("GET")
    expect(init.headers["Authorization"]).toBe("Bearer tk")
    // GET requests don't carry a body — assert undefined rather than empty
    // string, which would still be technically valid but is not what the
    // shared request helper emits.
    expect(init.body).toBeUndefined()
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].id).toBe("turn-1")
  })

  it("getStageChat returns empty turns array when stage has no chat yet", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ turns: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.getStageChat("pipe-1", "script")
    expect(result.turns).toEqual([])
  })

  it("getStageChat encodes the pipeline id in the URL", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ turns: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.pipelines.getStageChat("pipe/with/slashes", "script")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/pipe%2Fwith%2Fslashes/stages/script/chat",
    )
  })

  // ── Control surface (Phase 2 — agent commands the engine) ──────────────────

  function ctrlClient(fetchMock: ReturnType<typeof vi.fn>) {
    return createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock as unknown as typeof fetch,
    })
  }

  it("create POSTs the input to /v1/pipelines and returns the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "pipe-new" }, 201))
    const c = ctrlClient(fetchMock)
    const result = await c.pipelines.create({
      pipeline_type: "story_to_video",
      root_node_id: "n1",
      story_prompt: "A lighthouse keeper at dawn",
      target_duration_seconds: 30,
      format: "reel",
      output_resolution: "720p",
      language: "en",
      mode: "auto",
      video_critic_frame_count: "first_last",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toMatchObject({
      story_prompt: "A lighthouse keeper at dawn",
      mode: "auto",
    })
    expect(result.id).toBe("pipe-new")
  })

  it("get fetches the pipeline record", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "p1", status: "running", current_stage: "characters" }),
    )
    const c = ctrlClient(fetchMock)
    const rec = await c.pipelines.get("p1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pipelines/p1")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
    expect(rec.status).toBe("running")
  })

  it("list GETs /v1/pipelines", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk([{ id: "p1" }, { id: "p2" }]))
    const c = ctrlClient(fetchMock)
    const all = await c.pipelines.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pipelines")
    expect(all).toHaveLength(2)
  })

  it("cancel POSTs to /cancel", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ok: true }))
    const c = ctrlClient(fetchMock)
    const r = await c.pipelines.cancel("p1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pipelines/p1/cancel")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(r.ok).toBe(true)
  })

  it("pendingApprovals GETs the pending stages", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk([{ stage_name: "script", output: { plan: {} } }]),
    )
    const c = ctrlClient(fetchMock)
    const pa = await c.pipelines.pendingApprovals("p1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/p1/pending-approvals",
    )
    expect(pa[0]?.stage_name).toBe("script")
  })

  it("approveStage POSTs to /stages/:stage/approve, wrapping edits", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ok: true }))
    const c = ctrlClient(fetchMock)
    await c.pipelines.approveStage("p1", "script", [
      { op: "replace", path: "/x", value: 1 },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines/p1/stages/script/approve")
    expect(JSON.parse(init.body)).toEqual({
      edits: [{ op: "replace", path: "/x", value: 1 }],
    })
  })

  it("approveStage sends an empty body when no edits given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ok: true }))
    const c = ctrlClient(fetchMock)
    await c.pipelines.approveStage("p1", "characters")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({})
  })

  it("approveSubGate POSTs to /sub-gates/:gate/approve", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ ok: true, gate: "dialogue_recheck", resumed_at: "2026-06-01T00:00:00Z" }),
    )
    const c = ctrlClient(fetchMock)
    const r = await c.pipelines.approveSubGate("p1", "dialogue_recheck")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/p1/sub-gates/dialogue_recheck/approve",
    )
    expect(r.gate).toBe("dialogue_recheck")
  })

  it("getTimeline GETs the assembled timeline", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ fps: 30, width: 1280, height: 720, scenes: [] }),
    )
    const c = ctrlClient(fetchMock)
    const tl = await c.pipelines.getTimeline("p1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pipelines/p1/timeline")
    expect(tl.fps).toBe(30)
  })
})
