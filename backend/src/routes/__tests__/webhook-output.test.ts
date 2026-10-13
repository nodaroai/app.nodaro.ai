import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
}))

const { canRunWorkflowMock, resolveHttpAuthMock } = vi.hoisted(() => ({
  canRunWorkflowMock: vi.fn(),
  resolveHttpAuthMock: vi.fn(),
}))
vi.mock("@/lib/workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow-access.js")>()),
  canRunWorkflow: canRunWorkflowMock,
}))
vi.mock("@/lib/http-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http-credentials.js")>()),
  resolveHttpAuthHeaders: resolveHttpAuthMock,
}))

import { webhookOutputRoutes } from "../webhook-output.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"
import { supabase } from "../../lib/supabase.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { HttpCredentialError } from "../../lib/http-credentials.js"

let app: FastifyInstance
let authKind: "jwt" | "api_token" | "app_token" = "jwt"

function setupJobMocks() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  // A thenable chain: a completion awaits .eq(); markJobFailed's CAS goes on
  // with .in("status", …).select("id").
  const updateChain: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) }
  const mockEq = vi.fn(() => updateChain)
  updateChain.eq = mockEq
  updateChain.in = vi.fn(() => updateChain)
  updateChain.select = vi.fn(() => updateChain)
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  authKind = "jwt"
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
    req.authKind = authKind
  })
  await app.register(async (instance) => {
    await webhookOutputRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/webhook-output/send", () => {
  it("returns 400 when safeFetch blocks the webhook URL", async () => {
    setupJobMocks()
    vi.mocked(safeFetch).mockRejectedValue(
      new Error("safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.9"),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: {
        url: "https://example.com/hook",
        payload: { hello: "world" },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      jobId: "job-1",
      success: false,
      statusCode: 0,
      responseBody: "",
      error: "Webhook URL resolves to a blocked address",
    })
  })
})

/**
 * F10 — a request-gate BLOCK is a client outcome, not a server failure.
 *
 * `docs/api-integration.md` promises 422 `job_blocked` with the policy's own
 * message and tells clients a 500 means "server bug — retry with backoff". This
 * lane answered 500 with a bare string body, so an SDK consumer retried a
 * PERMANENT block with backoff (each retry re-gating, re-blocking and writing
 * another `job_policy_decisions` row) and `JobBlockedError` never fired —
 * `throwFromResponse` maps only `status === 422 && code === "job_blocked"`.
 */
describe("POST /v1/webhook-output/send — request-gate block (F10)", () => {
  afterEach(() => clearJobPolicies())

  it("answers 422 job_blocked with the policy's user message, not 500", async () => {
    setupJobMocks()
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: "https://example.com/hook", payload: { a: 1 } },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
    // The gate refused BEFORE the insert, so the webhook must not have fired.
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// A stored credential on the single-node lane (plan D7 / D10). The route has
// no orchestrator context, so the workflow the send belongs to must be NAMED:
// the credential resolves for that workflow's owner after the caller's own
// access check, and the response body is never returned once a key rode along.
// ---------------------------------------------------------------------------
describe("POST /v1/webhook-output/send — stored credential", () => {
  const CALLER = "00000000-0000-4000-8000-000000000001"
  const OWNER = "00000000-0000-4000-8000-000000000002"
  const WORKFLOW = "00000000-0000-4000-8000-000000000020"
  const CRED = "00000000-0000-4000-8000-0000000000c1"
  const HOOK = "https://hooks.example.com/in/abc"

  /** Job mocks plus a `workflows` lookup answering the given owner (or nothing) whose graph carries the credential. */
  function setupWithWorkflow(ownerId: string | null, opts: { credentialOnGraph?: boolean } = {}) {
    const nodes = opts.credentialOnGraph === false
      ? [{ id: "hook-1", type: "webhook-output", data: { url: HOOK } }]
      : [{ id: "hook-1", type: "webhook-output", data: { url: HOOK, credentialId: CRED } }]
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
    const mockSelectJob = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelectJob })
    const updates: Array<Record<string, unknown>> = []
    // A thenable chain: a completion awaits .eq(); markJobFailed's CAS goes on
    // with .in("status", …).select("id").
    const updateChain: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) }
    const mockEq = vi.fn(() => updateChain)
    updateChain.eq = mockEq
    updateChain.in = vi.fn(() => updateChain)
    updateChain.select = vi.fn(() => updateChain)
    const mockUpdate = vi.fn((fields: Record<string, unknown>) => {
      updates.push(fields)
      return { eq: mockEq }
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: ownerId ? { id: WORKFLOW, user_id: ownerId, nodes } : null, error: null }),
            }),
          }),
        } as never
      }
      return { insert: mockInsert, update: mockUpdate } as never
    })
    return { updates, mockInsert }
  }

  beforeEach(() => {
    canRunWorkflowMock.mockReset()
    resolveHttpAuthMock.mockReset()
  })

  it("requires workflowId — the credential resolves for a workflow's owner, not for the caller alone", async () => {
    setupWithWorkflow(OWNER)
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("credential_requires_workflow")
    expect(resolveHttpAuthMock).not.toHaveBeenCalled()
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("refuses a workflow the caller may not run (404, no oracle) before touching the vault", async () => {
    setupWithWorkflow(OWNER)
    canRunWorkflowMock.mockResolvedValue(false)
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
    })
    expect(res.statusCode).toBe(404)
    expect(resolveHttpAuthMock).not.toHaveBeenCalled()
  })

  it("resolves for the OWNER with runnerIsOwner false for a collaborator, sends on the credential lane, returns no body, stores no body", async () => {
    const { updates } = setupWithWorkflow(OWNER)
    canRunWorkflowMock.mockResolvedValue(true)
    resolveHttpAuthMock.mockResolvedValue({ headers: { "X-API-Key": "secret" }, headerName: "X-API-Key", binding: { url: HOOK, match: "exact" } })
    vi.mocked(safeFetch).mockResolvedValue({ ok: true, status: 200, text: async () => "X-API-Key: secret reflected" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: { a: 1 }, credentialId: CRED, workflowId: WORKFLOW },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveHttpAuthMock).toHaveBeenCalledWith(CRED, OWNER, HOOK, { ownerInitiated: false })
    const init = vi.mocked(safeFetch).mock.calls[0]![1] as Record<string, unknown>
    expect(init.credentialHeaders).toEqual({ "X-API-Key": "secret" })
    expect(init.credentialBinding).toEqual({ url: HOOK, match: "exact" })
    expect(JSON.stringify(init.headers)).not.toContain("secret")
    expect(res.json()).toEqual({ jobId: "job-1", success: true, statusCode: 200, responseBody: "" })
    const completed = updates.find((u) => u.status === "completed")!
    expect((completed.output_data as Record<string, unknown>).responseBody).toBe("")
    expect((completed.output_data as Record<string, unknown>).credentialId).toBe(CRED)
    expect(JSON.stringify(updates)).not.toContain("reflected")
  })

  it("the owner's own BROWSER run is owner-initiated; the same owner through an API or OAuth token is not", async () => {
    setupWithWorkflow(CALLER)
    canRunWorkflowMock.mockResolvedValue(true)
    resolveHttpAuthMock.mockResolvedValue({ headers: { "X-API-Key": "s" }, headerName: "X-API-Key", binding: null })
    vi.mocked(safeFetch).mockResolvedValue({ ok: true, status: 200, text: async () => "" } as never)
    const send = () =>
      app.inject({
        method: "POST",
        url: "/v1/webhook-output/send",
        payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
      })
    await send()
    expect(resolveHttpAuthMock).toHaveBeenLastCalledWith(CRED, CALLER, HOOK, { ownerInitiated: true })

    for (const kind of ["api_token", "app_token"] as const) {
      authKind = kind
      await send()
      // req.userId IS the owner for these tokens — the token kind is what says no.
      expect(resolveHttpAuthMock).toHaveBeenLastCalledWith(CRED, CALLER, HOOK, { ownerInitiated: false })
    }
  })

  it("refuses a credential that no Webhook Output of the named workflow carries — before touching the vault", async () => {
    setupWithWorkflow(CALLER, { credentialOnGraph: false })
    canRunWorkflowMock.mockResolvedValue(true)
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("credential_not_in_workflow")
    expect(resolveHttpAuthMock).not.toHaveBeenCalled()
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("answers the vault's typed refusal as 400 with its code, and sends nothing", async () => {
    setupWithWorkflow(OWNER)
    canRunWorkflowMock.mockResolvedValue(true)
    resolveHttpAuthMock.mockRejectedValue(new HttpCredentialError("unbound_shared_run"))
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unbound_shared_run")
    expect(vi.mocked(safeFetch)).not.toHaveBeenCalled()
  })

  it("a failed credentialed POST reports the status only — no reflected body, no transport message", async () => {
    const { updates } = setupWithWorkflow(CALLER)
    canRunWorkflowMock.mockResolvedValue(true)
    resolveHttpAuthMock.mockResolvedValue({ headers: { "X-API-Key": "s" }, headerName: "X-API-Key", binding: null })
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad key s" } as never)
    const denied = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
    })
    expect(denied.statusCode).toBe(502)
    expect(denied.json().responseBody).toBe("")
    expect(JSON.stringify(updates)).not.toContain("bad key")

    vi.mocked(safeFetch).mockRejectedValueOnce(new Error("TypeError: header value s"))
    const thrown = await app.inject({
      method: "POST",
      url: "/v1/webhook-output/send",
      payload: { url: HOOK, payload: {}, credentialId: CRED, workflowId: WORKFLOW },
    })
    expect(thrown.statusCode).toBe(502)
    expect(thrown.json().error).toBe("Webhook POST failed: transport error")
    expect(JSON.stringify(updates)).not.toContain("TypeError")
  })
})
