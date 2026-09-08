/**
 * The nine toolkit members a studio-production plugin reaches the host through.
 *
 * `toolkit.ts` is WIRING — every member below is one of this app's own
 * functions handed across the plugin boundary. So what these tests check is
 * not the behaviour of those functions (each has its own suite) but that the
 * wiring did not quietly replace one: that the workflow door still answers
 * 404-then-403, that a library read still carries its owner filter AND the
 * caller's ordering and cap, that a job read still redacts, and that the two
 * pure helpers are the very functions their modules export.
 *
 * Two members are checked by identity on purpose — `waitForJob` and
 * `changesStudioPublishFlag` have their own suites, and an identity assertion
 * is the only one that cannot drift away from them.
 *
 * Mocking convention mirrors `toolkit-jobs.test.ts` in this directory (partial
 * config mock; full-replace only the modules the members under test call).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** One recorded query chain: the table, then every builder call in order. */
interface RecordedQuery {
  table: string
  ops: Array<[string, ...unknown[]]>
}

const state = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; ops: Array<[string, ...unknown[]]> }>,
  result: { data: null as unknown, error: null as { message: string } | null },
}))

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => true }
})

vi.mock("@/lib/supabase.js", () => {
  // A PostgREST-shaped recorder: every builder call is appended to the query's
  // own op list and returns the same chain, so a test can assert the WHOLE
  // read — table, filters, ordering, cap — rather than only its result.
  const build = (record: { table: string; ops: Array<[string, ...unknown[]]> }) => {
    const chain: Record<string, unknown> = {}
    for (const op of ["select", "eq", "in", "is", "order", "limit", "update", "insert"]) {
      chain[op] = (...args: unknown[]) => {
        record.ops.push([op, ...args])
        return chain
      }
    }
    chain.maybeSingle = () => {
      record.ops.push(["maybeSingle"])
      return Promise.resolve(state.result)
    }
    chain.single = () => {
      record.ops.push(["single"])
      return Promise.resolve(state.result)
    }
    // The builder is awaited directly by the reads that take no terminator.
    chain.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(state.result).then(onOk, onErr)
    return chain
  }
  return {
    supabase: {
      from: (table: string) => {
        const record = { table, ops: [] as Array<[string, ...unknown[]]> }
        state.queries.push(record)
        return build(record)
      },
    },
  }
})

const { mockWorkflowAccessFromRow } = vi.hoisted(() => ({
  mockWorkflowAccessFromRow: vi.fn(),
}))

vi.mock(import("@/lib/workflow-access.js"), async (importOriginal) => {
  const actual = await importOriginal()
  // `accessAtLeast` stays REAL — it is the ordering the 403 branch turns on.
  return { ...actual, workflowAccessFromRow: mockWorkflowAccessFromRow }
})

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"
import { WORKFLOW_ACCESS_COLS } from "../../workflow-route-access.js"
import { canChangeWorkflowVisibility } from "../../workflow-access.js"
import { changesStudioPublishFlag } from "../../studio-audience.js"
import { requireScope } from "../../scopes.js"
import { waitForJob } from "../../mcp/tools/_wait-for-job.js"
import Fastify from "fastify"
import { jobSubmissionColumns } from "../../job-submission-context.js"

const CALLER = "00000000-0000-4000-8000-000000000001"
const STRANGER = "00000000-0000-4000-8000-000000000002"
const WF = "00000000-0000-4000-8000-000000000020"

function replyStub() {
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    status(code: number) {
      sent.status = code
      return reply
    },
    send(body: unknown) {
      sent.body = body
      return reply
    },
  }
  return { reply, sent }
}

function lastQuery(): RecordedQuery {
  const q = state.queries.at(-1)
  if (!q) throw new Error("no query was issued")
  return q
}

/** Every op of one recorded chain, by name. */
function opsNamed(q: RecordedQuery, name: string): Array<[string, ...unknown[]]> {
  return q.ops.filter((op) => op[0] === name)
}

let tk: PluginToolkit

beforeEach(() => {
  state.queries = []
  state.result = { data: null, error: null }
  mockWorkflowAccessFromRow.mockReset()
  tk = buildToolkit()
})

describe("tk.workflows — the by-id door", () => {
  it("exposes the app's own access projection", () => {
    // A plugin that selected fewer columns would hand `toAccessRow` a row it
    // refuses to judge; the columns are the app's to decide, not the plugin's.
    expect(tk.workflows?.accessCols).toBe(WORKFLOW_ACCESS_COLS)
  })

  it("answers 404 for a stranger — not 403, which would confirm the id is real", async () => {
    state.result = { data: { id: WF, user_id: CALLER, workspace_id: null, visibility: "private" }, error: null }
    mockWorkflowAccessFromRow.mockResolvedValue("none")
    const { reply, sent } = replyStub()

    const loaded = await tk.workflows!.loadWorkflowFor(
      {} as never,
      reply as never,
      STRANGER,
      WF,
      "view",
      WORKFLOW_ACCESS_COLS,
      "Failed to load production",
    )

    expect(loaded.ok).toBe(false)
    expect(sent.status).toBe(404)
    expect(sent.body).toEqual({ error: { code: "not_found", message: "Workflow not found" } })
  })

  it("answers 403 when the caller may look but not touch", async () => {
    state.result = { data: { id: WF, user_id: CALLER, workspace_id: null, visibility: "private" }, error: null }
    mockWorkflowAccessFromRow.mockResolvedValue("view")
    const { reply, sent } = replyStub()

    const loaded = await tk.workflows!.loadWorkflowFor(
      {} as never,
      reply as never,
      STRANGER,
      WF,
      "edit",
      WORKFLOW_ACCESS_COLS,
      "Failed to load production",
    )

    expect(loaded.ok).toBe(false)
    expect(sent.status).toBe(403)
    // Pinned like the 404 body above: the refusal a plugin route forwards is
    // the app's own, word for word, not one the plugin gets to reword.
    expect(sent.body).toEqual({
      error: { code: "forbidden", message: "You do not have permission to do that" },
    })
  })

  it("hands the owner the row and the level it judged", async () => {
    const row = { id: WF, user_id: CALLER, workspace_id: null, visibility: "private" }
    state.result = { data: row, error: null }
    mockWorkflowAccessFromRow.mockResolvedValue("own")
    const { reply } = replyStub()

    const loaded = await tk.workflows!.loadWorkflowFor(
      {} as never,
      reply as never,
      CALLER,
      WF,
      "edit",
      WORKFLOW_ACCESS_COLS,
      "Failed to load production",
    )

    expect(loaded).toEqual({ ok: true, row, access: "own" })
    // The read is unfiltered by creator — the access seam judges it, and a
    // query that filtered by the caller would answer the question first.
    expect(lastQuery().table).toBe("workflows")
    expect(opsNamed(lastQuery(), "eq")).toEqual([["eq", "id", WF]])
  })

  it("delegates the visibility question to the app's own authority", () => {
    expect(tk.workflows?.canChangeVisibility).toBe(canChangeWorkflowVisibility)
  })

  it("delegates the audience-flag diff to studio-audience.ts", () => {
    expect(tk.workflows?.changesStudioPublishFlag).toBe(changesStudioPublishFlag)
  })
})

describe("tk.auth.requireScope", () => {
  it("returns the app's own ready-to-send refusal", () => {
    expect(tk.auth.requireScope?.([], "workflows:write")).toEqual(
      requireScope([], "workflows:write"),
    )
  })

  it("returns null when the token carries the scope", () => {
    expect(tk.auth.requireScope?.(["workflows:write"], "workflows:write")).toBeNull()
  })
})

describe("tk.entities.listOwned", () => {
  it("scopes the read to the owner AND keeps the caller's ordering and cap", async () => {
    // Without the last two assertions a bounded, newest-first library read
    // becomes an unbounded arbitrary one and nothing says so: `listOwned`
    // hands back rows, so the caller cannot re-impose either.
    state.result = { data: [{ id: "c1", name: "Kira" }], error: null }

    const rows = await tk.entities!.listOwned(CALLER, "creatures", "id, name", {
      orderBy: "updated_at",
      ascending: false,
      limit: 300,
    })

    expect(rows).toEqual([{ id: "c1", name: "Kira" }])
    const q = lastQuery()
    expect(q.table).toBe("creatures")
    expect(opsNamed(q, "select")).toEqual([["select", "id, name"]])
    // `entityOwnerFilter` — the one ownership predicate, both halves of it.
    expect(opsNamed(q, "eq")).toEqual([["eq", "user_id", CALLER]])
    expect(opsNamed(q, "is")).toEqual([["is", "deleted_at", null]])
    expect(opsNamed(q, "order")).toEqual([["order", "updated_at", { ascending: false }]])
    expect(opsNamed(q, "limit")).toEqual([["limit", 300]])
  })

  it("throws on a read error rather than reporting an empty library", async () => {
    state.result = { data: null, error: { message: "connection reset" } }
    await expect(
      tk.entities!.listOwned(CALLER, "characters", "id, name", {
        orderBy: "updated_at",
        ascending: false,
        limit: 300,
      }),
    ).rejects.toThrow(/connection reset/)
  })
})

describe("tk.jobs.readJobsOwnedBy", () => {
  it("reads only the caller's rows and redacts the server-only fields", async () => {
    state.result = {
      data: [
        {
          id: "job-1",
          status: "completed",
          output_data: { videoUrl: "https://cdn/a.mp4", unscoredUrl: "https://cdn/private.mp4" },
          error_message: null,
        },
      ],
      error: null,
    }

    const rows = await tk.jobs.readJobsOwnedBy!(CALLER, ["job-1", "job-2"])

    // `job-2` is somebody else's (or nothing at all) — the two are one answer.
    expect(rows.map((r) => r.id)).toEqual(["job-1"])
    expect(rows[0].output_data).toEqual({ videoUrl: "https://cdn/a.mp4" })

    const q = lastQuery()
    expect(q.table).toBe("jobs")
    expect(opsNamed(q, "in")).toEqual([["in", "id", ["job-1", "job-2"]]])
    // Never a post-filter in JS: a query that asks for rows it must then throw
    // away is one refactor from keeping them.
    expect(opsNamed(q, "eq")).toEqual([["eq", "user_id", CALLER]])
  })

  it("issues no query at all for an empty id list", async () => {
    expect(await tk.jobs.readJobsOwnedBy!(CALLER, [])).toEqual([])
    expect(state.queries).toHaveLength(0)
  })

  it("throws on a read error rather than reporting nothing landed", async () => {
    state.result = { data: null, error: { message: "connection reset" } }
    await expect(tk.jobs.readJobsOwnedBy!(CALLER, ["job-1"])).rejects.toThrow(/connection reset/)
  })
})

describe("tk.jobs.waitForJob", () => {
  it("is the MCP layer's own waiter, not a second one", () => {
    // The backoff, the jitter, the abort signal and the held-job early return
    // all live there; an identity assertion is the only one that cannot drift.
    expect(tk.jobs.waitForJob).toBe(waitForJob)
  })
})

describe("tk.http.internalRequest", () => {
  it("carries submission metadata through real Fastify injection without exposing it on the wire", async () => {
    const app = Fastify()
    app.post("/v1/generate-image", async (req) => {
      req.userId = req.headers["x-internal-user-id"] as string
      return {
        columns: jobSubmissionColumns(req, { user_id: req.userId, job_type: "generate-image" }),
        body: req.body,
      }
    })
    try {
      expect(tk.http.supportsJobSubmissionContext).toBe(true)
      const replies = await Promise.all(["first", "second"].map((attemptId) => tk.http.internalRequest!(app, {
        method: "POST", url: "/v1/generate-image", userId: CALLER,
        payload: { prompt: attemptId },
        jobSubmission: { jobType: "generate-image", metadata: { attemptId } },
      })))
      expect(replies.map((reply) => JSON.parse(reply.body))).toEqual(["first", "second"].map((attemptId) => ({
        columns: { submission_context: { attemptId } }, body: { prompt: attemptId },
      })))
      const publicReply = await app.inject({ method: "POST", url: "/v1/generate-image",
        headers: { "x-internal-user-id": CALLER, "x-job-submission-context": "forged" },
        payload: { submission_context: { attemptId: "forged" } },
      })
      expect(publicReply.json().columns).toEqual({})
    } finally { await app.close() }
  })
  it("carries the caller's identity the way the MCP layer sends it", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })

    await tk.http.internalRequest!({ inject } as never, {
      method: "POST",
      url: "/v1/generate-image",
      userId: CALLER,
      workspaceId: "ws-1",
      payload: { prompt: "a lighthouse at dawn" },
      headers: { "idempotency-key": "studio:abc:0" },
    })

    const sent = inject.mock.calls[0][0] as {
      method: string
      url: string
      headers: Record<string, string>
      payload?: unknown
    }
    expect(sent.method).toBe("POST")
    expect(sent.url).toBe("/v1/generate-image")
    expect(sent.payload).toEqual({ prompt: "a lighthouse at dawn" })
    expect(sent.headers["x-internal-user-id"]).toBe(CALLER)
    expect(sent.headers["x-internal-orchestrator-secret"]).toBeTruthy()
    expect(sent.headers["x-nodaro-workspace"]).toBe("ws-1")
    expect(sent.headers["idempotency-key"]).toBe("studio:abc:0")
  })

  it("omits the workspace header when the caller had no workspace", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })
    await tk.http.internalRequest!({ inject } as never, {
      method: "GET",
      url: "/v1/credits/balance",
      userId: CALLER,
    })
    const sent = inject.mock.calls[0][0] as { headers: Record<string, string>; payload?: unknown }
    expect("x-nodaro-workspace" in sent.headers).toBe(false)
    expect("payload" in sent).toBe(false)
  })

  it("refuses to let a caller header override the two it owns", async () => {
    // The headers are spread FIRST on purpose: a caller adds what its route
    // needs and cannot impersonate somebody else with the same argument.
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })
    await tk.http.internalRequest!({ inject } as never, {
      method: "GET",
      url: "/v1/credits/balance",
      userId: CALLER,
      headers: { "x-internal-user-id": STRANGER },
    })
    const sent = inject.mock.calls[0][0] as { headers: Record<string, string> }
    expect(sent.headers["x-internal-user-id"]).toBe(CALLER)
  })
})

describe("tk.jobs.readJobSubmissionsOwnedBy", () => {
  it("deduplicates requested ids and scopes the private projection to the owner", async () => {
    state.result.data = [{ id: "one", submission_context: { attemptId: "trusted" } },
      { id: "two", submission_context: null }, { id: "three", submission_context: [] }]
    expect(await tk.jobs.readJobSubmissionsOwnedBy!(CALLER, ["one", "two", "one"])).toEqual([
      { id: "one", submission_context: { attemptId: "trusted" } },
    ])
    expect(lastQuery()).toEqual({ table: "jobs", ops: [
      ["select", "id, submission_context"], ["eq", "user_id", CALLER], ["in", "id", ["one", "two"]],
    ] })
  })
  it("does not query an empty request and fails closed on a database error", async () => {
    expect(await tk.jobs.readJobSubmissionsOwnedBy!(CALLER, [])).toEqual([])
    expect(state.queries).toHaveLength(0)
    state.result.error = { message: "private database detail" }
    await expect(tk.jobs.readJobSubmissionsOwnedBy!(CALLER, ["one"])).rejects.toThrow("Failed to read job submission records")
  })
})
