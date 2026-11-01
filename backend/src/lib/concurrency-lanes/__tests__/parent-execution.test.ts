// The parent run of a nested workflow execution: the node executor names its
// execution on the internal calls that start one (a use-case node's run or
// continue route; the component route is pinned in billing-context-threading),
// and a route believes the header only on the internal lane.
import { afterEach, describe, expect, it, vi } from "vitest"
import { PARENT_EXECUTION_HEADER, parentExecutionIdOf } from "../parent-execution.js"
import { askRoute } from "../../../services/workflow-engine/use-case-request.js"
import type { OrchestratorContext } from "../../../services/workflow-engine/types.js"

const PARENT = "00000000-0000-4000-8000-0000000000aa"

const req = (authKind: string | undefined, value: unknown) =>
  ({ authKind, headers: value === undefined ? {} : { [PARENT_EXECUTION_HEADER]: value } }) as unknown as Parameters<typeof parentExecutionIdOf>[0]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parentExecutionIdOf", () => {
  it("the internal lane's header names the parent run", () => {
    expect(parentExecutionIdOf(req("internal", PARENT))).toBe(PARENT)
  })

  it("any other caller's header is ignored: it would buy a run with no slot", () => {
    for (const kind of ["jwt", "api_token", "app", undefined]) expect(parentExecutionIdOf(req(kind, PARENT))).toBeUndefined()
  })

  it("a malformed value, or none, names no parent", () => {
    expect(parentExecutionIdOf(req("internal", "exec-1; drop"))).toBeUndefined()
    expect(parentExecutionIdOf(req("internal", ""))).toBeUndefined()
    expect(parentExecutionIdOf(req("internal", undefined))).toBeUndefined()
  })
})

describe("askRoute (a use-case node's call to its run and continue routes)", () => {
  it("sends PARENT_EXECUTION_HEADER naming its own execution: a nested use-case run never takes a run slot", async () => {
    const headers: Array<Record<string, string>> = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      headers.push(init.headers)
      return new Response(JSON.stringify({ jobId: "wrapper-1" }), { status: 202, headers: { "content-type": "application/json" } })
    }))
    const ctx = { executionId: PARENT, userId: "u1", billingContext: { payer: "user", userId: "u1" } } as unknown as OrchestratorContext
    const answer = await askRoute({ path: "/v1/tighten-episode", label: "Tighten Episode", body: {} }, "key-1", ctx)
    expect(answer).toEqual({ kind: "started", jobId: "wrapper-1" })
    expect(headers[0]?.[PARENT_EXECUTION_HEADER]).toBe(PARENT)
  })
})
