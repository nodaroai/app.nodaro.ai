import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerDiagnose, classifyFailure } = await import("../diagnose.js")
const { supabase } = await import("../../../supabase.js")

let batchFilters: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.clearAllMocks()
  batchFilters = []
})

/**
 * Route supabase.from() per table: workflow_executions resolves via
 * select→eq→eq→maybeSingle; jobs resolves via the single-row chain
 * (eq→eq→maybeSingle) AND the batch chain (select→in).
 */
function mockSupabase(opts: {
  execution?: unknown
  jobSingle?: unknown
  jobsBatch?: unknown[]
}): void {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (table: string) => {
      if (table === "workflow_executions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: opts.execution ?? null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === "jobs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: opts.jobSingle ?? null, error: null }),
              }),
            }),
            // The batch chain may narrow by owner: rows carrying a `user_id`
            // must match it (fixtures without one stand for the caller's).
            in: () => {
              const filters: Record<string, unknown> = {}
              const q = {
                eq: (col: string, v: unknown) => { filters[col] = v; return q },
                then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
                  batchFilters.push({ ...filters })
                  const rows = (opts.jobsBatch ?? []).filter((r) =>
                    Object.entries(filters).every(([k, v]) => {
                      const row = r as Record<string, unknown>
                      return !(k in row) || row[k] === v
                    }))
                  return Promise.resolve({ data: rows, error: null }).then(res, rej)
                },
              }
              return q
            },
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  )
}

function diagnoseSession(scopes: Scope[] = ["jobs:read"]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

function parse(result: { content: { text?: string }[] }) {
  return JSON.parse(result.content[0]?.text ?? "{}")
}

describe("classifyFailure", () => {
  it("flags content-policy rejections", () => {
    expect(classifyFailure("Request blocked by content moderation").class).toBe(
      "content_policy",
    )
    expect(classifyFailure("NSFW content detected").class).toBe("content_policy")
  })

  it("flags copyright blocks as content_policy (the sanitized KIE copyright message)", () => {
    expect(
      classifyFailure(
        "Blocked for copyright: the provider refused this generation because the output may contain copyrighted material (recognizable characters, footage, music, or logos). Change the input image/clip or rephrase the prompt — retrying the same request will fail again.",
      ).class,
    ).toBe("content_policy")
  })

  it("flags input validation errors", () => {
    expect(classifyFailure("prompt is required").class).toBe("validation")
    expect(classifyFailure("Invalid aspect ratio: 7:3").class).toBe("validation")
  })

  it("flags rate-limit / quota errors", () => {
    expect(classifyFailure("429 Too Many Requests").class).toBe("rate_limited")
    expect(classifyFailure("provider quota exceeded").class).toBe("rate_limited")
  })

  it("flags transient timeout / network errors", () => {
    expect(classifyFailure("Request timed out after 30s").class).toBe("timeout")
    expect(classifyFailure("ECONNRESET").class).toBe("timeout")
  })

  it("flags post-processing (post-delivery) failures", () => {
    expect(classifyFailure("ffmpeg failed: invalid codec").class).toBe(
      "post_processing",
    )
    expect(classifyFailure("Failed to upload to R2").class).toBe("post_processing")
  })

  it("defaults a generic provider message to provider_error", () => {
    expect(classifyFailure("Provider returned status 500").class).toBe(
      "provider_error",
    )
  })

  it("classifies a missing message as unknown", () => {
    expect(classifyFailure(null).class).toBe("unknown")
    expect(classifyFailure("").class).toBe("unknown")
  })

  it("always returns a non-empty remediation hint", () => {
    for (const msg of [
      "moderation",
      "invalid",
      "quota",
      "timeout",
      "ffmpeg",
      "boom",
      null,
    ]) {
      expect(classifyFailure(msg).remediation.length).toBeGreaterThan(0)
    }
  })
})

describe("diagnose_run tool", () => {
  it("does NOT register without jobs:read scope", async () => {
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession([]), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.find((t) => t.name === "diagnose_run")).toBeUndefined()
  })

  it("diagnoses a failed execution, surfacing each failed node + its job error", async () => {
    mockSupabase({
      execution: {
        id: "exec1",
        status: "failed",
        node_states: {
          n1: { status: "completed", nodeType: "text-prompt" },
          n2: {
            status: "failed",
            nodeType: "generate-video",
            jobId: "job-v",
            error: "node-level error",
          },
          n3: {
            status: "failed",
            nodeType: "generate-image",
            jobId: "job-i",
          },
        },
        error_message: "Execution failed",
      },
      jobsBatch: [
        {
          id: "job-v",
          error_message: "429 Too Many Requests",
          input_data: { provider: "veo3" },
          credits_estimated: 63,
          credits_actual: null,
        },
        {
          id: "job-i",
          error_message: "ffmpeg failed: invalid codec",
          input_data: { provider: "flux" },
          credits_estimated: 2,
          credits_actual: 2,
        },
      ],
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "exec1" }))

    expect(out.kind).toBe("execution")
    expect(out.status).toBe("failed")
    expect(out.failures).toHaveLength(2)
    const byNode = Object.fromEntries(
      out.failures.map((f: { nodeId: string }) => [f.nodeId, f]),
    )
    expect(byNode.n2.provider).toBe("veo3")
    expect(byNode.n2.class).toBe("rate_limited")
    expect(byNode.n3.class).toBe("post_processing")
    expect(byNode.n3.creditsActual).toBe(2)
    expect(out.summary).toContain("2")
  })

  it("attacker: a node_states jobId naming another user's job yields no facts of it", async () => {
    // node_states was client-writable before 474, so a jobId in it is a
    // pointer: the batch read is the caller's own jobs only.
    mockSupabase({
      execution: {
        id: "exec1",
        status: "failed",
        node_states: { n1: { status: "failed", nodeType: "generate-image", jobId: "job-planted" } },
        error_message: "Execution failed",
      },
      jobsBatch: [
        {
          id: "job-planted",
          user_id: "victim",
          error_message: "victim's private error",
          input_data: { provider: "victim-provider" },
          credits_actual: 99,
        },
      ],
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "exec1" }))

    expect(batchFilters).toEqual([{ user_id: "u1" }])
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0].error).toBeNull()
    expect(out.failures[0].provider).toBeNull()
    expect(out.failures[0].creditsActual).toBeNull()
    expect(JSON.stringify(out)).not.toContain("victim")
  })

  it("falls back to single-job diagnosis when the id is a job id", async () => {
    mockSupabase({
      execution: null,
      jobSingle: {
        id: "job-x",
        status: "failed",
        error_message: "Invalid aspect ratio",
        input_data: { provider: "nano-banana" },
        credits_estimated: 1,
        credits_actual: null,
        job_type: "generate-image",
      },
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "job-x" }))

    expect(out.kind).toBe("job")
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0].class).toBe("validation")
    expect(out.failures[0].provider).toBe("nano-banana")
  })

  it("returns isError when neither an execution nor a job is found", async () => {
    mockSupabase({ execution: null, jobSingle: null })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const result = await callTool(server, "diagnose_run", { id: "nope" })
    expect(result.isError).toBe(true)
  })

  it("reports no failures for a completed execution", async () => {
    mockSupabase({
      execution: {
        id: "exec-ok",
        status: "completed",
        node_states: {
          n1: { status: "completed", nodeType: "generate-image", jobId: "j1" },
        },
        error_message: null,
      },
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "exec-ok" }))
    expect(out.status).toBe("completed")
    expect(out.outcome).toBe("succeeded")
    expect(out.failures).toHaveLength(0)
  })

  it("a completed run that skipped a node for want of input reads nothing_new, and names the reason on the node", async () => {
    mockSupabase({
      execution: {
        id: "exec-idle",
        status: "completed",
        node_states: {
          feed: { status: "completed", nodeType: "telegram-channel-feed" },
          llm: { status: "skipped", nodeType: "llm-chat", skipReason: "empty_input" },
          gated: { status: "skipped", nodeType: "generate-image" },
        },
        error_message: null,
      },
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "exec-idle" }))
    expect(out.status).toBe("completed")
    expect(out.outcome).toBe("nothing_new")
    expect(out.failures).toHaveLength(0)
    const nodes = out.nodes as Array<{ nodeId: string; skipReason?: string }>
    expect(nodes.find((n) => n.nodeId === "llm")?.skipReason).toBe("empty_input")
    expect(nodes.find((n) => n.nodeId === "gated")?.skipReason).toBeUndefined()
  })

  it("lists EVERY node's dispatched job id — the only execution→job mapping surface (2026-08-03)", async () => {
    mockSupabase({
      execution: {
        id: "exec-map",
        status: "completed",
        node_states: {
          "gvp-a": { status: "completed", nodeType: "generate-video-pro", jobId: "job-a" },
          "gvp-b": { status: "completed", nodeType: "generate-video-pro", jobId: "job-b" },
          "txt": { status: "completed", nodeType: "text-prompt" },
        },
        error_message: null,
      },
    })
    const server = buildServer()
    registerDiagnose({ server, session: diagnoseSession(), fastify: Fastify() })
    const out = parse(await callTool(server, "diagnose_run", { id: "exec-map" }))
    expect(out.nodes).toEqual([
      { nodeId: "gvp-a", nodeType: "generate-video-pro", status: "completed", jobId: "job-a" },
      { nodeId: "gvp-b", nodeType: "generate-video-pro", status: "completed", jobId: "job-b" },
      { nodeId: "txt", nodeType: "text-prompt", status: "completed", jobId: null },
    ])
  })
})
