/**
 * The sweep that removes the empty workflows a failed home-page handoff left
 * behind (#904).
 *
 * Everything here is about what it must NOT delete. A cleanup that takes one
 * workflow it should not have taken is worse than the clutter it exists to
 * remove, and three of the four conditions guard exactly that.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"

interface Row {
  id: string
  user_id: string
  workflow_id: string
}

const state = vi.hoisted(() => ({
  threads: [] as unknown[],
  threadError: null as unknown,
  /** `copilot_turns` rows: a thread listed here has been spoken to. */
  turns: [] as unknown[],
  workflows: [] as unknown[],
  deleted: [] as Array<{ workflowId: string; userId: string }>,
  filters: [] as Array<[string, unknown]>,
}))

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "lt", "limit", "in"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.eq = vi.fn((col: string, value: unknown) => {
    if (table === "copilot_threads") state.filters.push([col, value])
    return chain
  })
  ;(chain as { then: unknown }).then = (onResolve: (v: unknown) => unknown) => {
    const result =
      table === "copilot_threads"
        ? { data: state.threads, error: state.threadError }
        : table === "copilot_turns"
          ? { data: state.turns, error: null }
          : { data: state.workflows, error: null }
    return Promise.resolve(result).then(onResolve)
  }
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => makeChain(t) } }))
vi.mock("../../../lib/workflow-delete.js", () => ({
  // The real RPC is owner-scoped and returns false when the caller does not
  // own the row. Stubbing a bare `true` would make every owner mistake
  // invisible to this file, which is the one thing it is here to catch.
  deleteWorkflowWithPrivateMedia: async (args: { workflowId: string; userId: string }) => {
    state.deleted.push(args)
    const owner = (state.workflows as Array<{ id: string; user_id: string }>).find(
      (w) => w.id === args.workflowId,
    )?.user_id
    return owner === args.userId
  },
}))

const { sweepAbandonedCopilotWorkflows, ABANDONED_SEED_AGE_MS } = await import("../abandoned-sweep.js")

const NOW = Date.parse("2026-08-25T12:00:00Z")
const OLD = new Date(NOW - ABANDONED_SEED_AGE_MS - 60_000).toISOString()
const RECENT = new Date(NOW - 60_000).toISOString()

const thread: Row = { id: "th1", user_id: "u1", workflow_id: "wf1" }
const emptyWorkflow = { id: "wf1", user_id: "u1", nodes: [], edges: [], updated_at: OLD }

beforeEach(() => {
  state.threads = [thread]
  state.threadError = null
  state.turns = []
  state.workflows = [emptyWorkflow]
  state.deleted = []
  state.filters = []
})

describe("what it deletes", () => {
  it("removes an old, empty, never-spoken-to workflow the handshake created", async () => {
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result).toMatchObject({ deleted: 1, kept: 0, skipped: false })
    // Owner-scoped: the delete carries the workflow's OWN user id, not the
    // thread's, so a mismatched pair can never delete across users.
    expect(state.deleted).toEqual([{ workflowId: "wf1", userId: "u1" }])
  })

  it("asks only for threads that CREATED their workflow and never produced a turn", async () => {
    await sweepAbandonedCopilotWorkflows(NOW)
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["created_workflow", true],
        ["user_turn_count", 0],
      ]),
    )
  })
})

describe("what it must never delete", () => {
  it("leaves a workflow whose canvas has nodes", async () => {
    // The hop can fail and the user can then BUILD by hand without ever
    // messaging the copilot: turn count stays 0 while the workflow becomes
    // real work.
    state.workflows = [{ ...emptyWorkflow, nodes: [{ id: "n1" }] }]
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result).toMatchObject({ deleted: 0, kept: 1 })
    expect(state.deleted).toEqual([])
  })

  it("leaves a workflow whose canvas has edges but no nodes", async () => {
    state.workflows = [{ ...emptyWorkflow, edges: [{ id: "e1" }] }]
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 1 })
  })

  it("leaves a workflow somebody touched recently", async () => {
    state.workflows = [{ ...emptyWorkflow, updated_at: RECENT }]
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 1 })
  })

  it("leaves a young seed alone — the failed hop puts the sentence back in the composer", async () => {
    // The age filter is a SQL `.lt(created_at, cutoff)`, so the proof it is
    // there is the cutoff itself, computed from the age constant.
    expect(ABANDONED_SEED_AGE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it("deletes nothing when the workflow row is already gone", async () => {
    state.workflows = []
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 0 })
    expect(state.deleted).toEqual([])
  })
})

describe("before the migration reaches the shared database", () => {
  it("is a no-op, not a thrown cron", async () => {
    // Staging shares the production database, so the gap between the dev merge
    // and the promotion is real running time.
    state.threadError = { code: "42703", message: "column does not exist" }
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, skipped: true })
  })

  it("still throws on a real failure", async () => {
    state.threadError = { code: "57014", message: "statement timeout" }
    await expect(sweepAbandonedCopilotWorkflows(NOW)).rejects.toThrow(/statement timeout/)
  })
})

describe("the column the sweep keys off exists", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations/349_copilot_seeded_workflow.sql"),
    "utf8",
  ).replace(/\s+/g, " ")

  it("migration 349 adds created_workflow to copilot_threads, defaulting to false", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.copilot_threads ADD COLUMN IF NOT EXISTS created_workflow boolean NOT NULL DEFAULT false/i,
    )
  })
})

describe("owner scoping is a real check, not a tautology", () => {
  it("declines a workflow the thread's owner no longer owns", async () => {
    // The delete RPC only removes what the caller owns. Handing it the
    // workflow row's OWN user id would satisfy that check by construction and
    // buy nothing; handed the thread's, it asks a real question.
    state.threads = [{ ...thread, user_id: "u2" }]
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result.deleted).toBe(0)
    expect(state.deleted).toEqual([{ workflowId: "wf1", userId: "u2" }])
  })
})

describe("a thread anyone ever sent a message on is not a seed", () => {
  // `user_turn_count` is bumped at turn END, so it reads 0 for the whole
  // duration of a turn AND for every turn that died. The dangerous shape: a
  // user walks away from a failed hop, comes back hours later and sends from
  // the seeded draft — SAME thread, same `created_at`, count still 0, canvas
  // still empty while the model reads. A tick landing there would delete the
  // workflow out from under a running turn.
  it("leaves a workflow whose thread has a turn in flight", async () => {
    state.turns = [{ thread_id: "th1" }]
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result).toMatchObject({ deleted: 0, kept: 0 })
    expect(state.deleted).toEqual([])
  })

  it("still sweeps a sibling seed nobody spoke to", async () => {
    // Proof the exclusion is per-thread and not a blanket bail-out.
    state.threads = [thread, { id: "th2", user_id: "u1", workflow_id: "wf2" }]
    state.workflows = [emptyWorkflow, { ...emptyWorkflow, id: "wf2" }]
    state.turns = [{ thread_id: "th1" }]
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result.deleted).toBe(1)
    expect(state.deleted).toEqual([{ workflowId: "wf2", userId: "u1" }])
  })
})

describe("timestamps are compared as instants, not as strings", () => {
  // Postgres hands back `...+00:00`; `toISOString()` produces `...Z`. Two
  // spellings of the same moment that sort differently as soon as the digits
  // before them agree — and any offset other than +00:00 breaks the ordering
  // outright. A string compare here deletes workflows people are working in.
  /** What `toISOString()` produces, and what the old code compared against. */
  const cutoffIso = new Date(NOW - ABANDONED_SEED_AGE_MS).toISOString()

  it("keeps a workflow sitting exactly on the cutoff in Postgres's own spelling", async () => {
    // Postgres drops a zero fraction: `2026-08-25T09:00:00+00:00`. As text that
    // sorts BELOW `2026-08-25T09:00:00.000Z`, because '+' (43) precedes
    // '.' (46) — the same instant, one spelling of it deleted.
    const onCutoff = cutoffIso.replace(".000Z", "+00:00")
    expect(onCutoff < cutoffIso).toBe(true) // the disagreement this test exists for
    state.workflows = [{ ...emptyWorkflow, updated_at: onCutoff }]
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 1 })
  })

  it("keeps a workflow touched a minute ago that carries a NEGATIVE offset", async () => {
    // A session on a western timezone renders the same instant with a small
    // wall clock: 06:59-05:00 IS 11:59 UTC, a minute old — and sorts below a
    // 09:00 cutoff string, so the text compare would have deleted it.
    const wall = new Date(NOW - 60_000 - 5 * 60 * 60 * 1000).toISOString()
    const shifted = wall.replace(".000Z", "-05:00")
    expect(shifted < cutoffIso).toBe(true) // the disagreement this test exists for
    state.workflows = [{ ...emptyWorkflow, updated_at: shifted }]
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 1 })
  })

  it("keeps a workflow whose timestamp cannot be read at all", async () => {
    // Unparseable must mean "leave it alone", never "it is old enough".
    state.workflows = [{ ...emptyWorkflow, updated_at: "not a timestamp" }]
    expect(await sweepAbandonedCopilotWorkflows(NOW)).toMatchObject({ deleted: 0, kept: 1 })
  })
})

describe("a truncated turn probe deletes nothing", () => {
  it("reports saturation instead of reading a short page as 'nobody spoke'", async () => {
    // The probe's ceiling is SWEEP_BATCH * 10. If it ever comes back full,
    // "this thread has no turns" and "its turns fell outside the page" are
    // indistinguishable, and the wrong guess deletes a workflow someone used.
    state.turns = Array.from({ length: 2000 }, (_, i) => ({ thread_id: `other-${i}` }))
    const result = await sweepAbandonedCopilotWorkflows(NOW)
    expect(result).toMatchObject({ deleted: 0, saturated: true })
    expect(state.deleted).toEqual([])
  })
})
