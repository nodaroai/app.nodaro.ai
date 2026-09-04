/**
 * `job_policy_decisions` — the PLUMBING, which every other job-policy test
 * mocks away.
 *
 * `job-policy-gate.test.ts` replaces this whole module with `vi.mock`, so it
 * proves what the gate ASKS FOR and nothing about what actually reaches
 * Postgres. That gap is what let `user_message` be a design decision with no
 * wire: the column can exist, the gate can pass `userMessage`, and the insert
 * can still drop it on the floor — after which every re-applied block silently
 * degrades to the generic platform sentence and no test says a word.
 *
 * So these three assertions are about the wire only: the key the INSERT writes,
 * the column the reuse SELECT asks for, and how a row missing that column maps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => {
  const inserted: Record<string, unknown>[] = []
  const selects: string[] = []
  const reuseRows = { value: [] as Record<string, unknown>[] }
  const from = vi.fn(() => ({
    insert: (row: Record<string, unknown>) => {
      inserted.push(row)
      return { select: () => ({ single: async () => ({ data: { id: "decision-1" }, error: null }) }) }
    },
    select: (cols: string) => {
      selects.push(cols)
      const chain = {
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: async () => ({ data: reuseRows.value, error: null }),
      }
      return chain
    },
  }))
  return { from, inserted, selects, reuseRows }
})
vi.mock("../supabase.js", () => ({ supabase: { from: db.from } }))

import { recordJobPolicyDecision, findReusableDecision } from "../job-policy-audit.js"

beforeEach(() => {
  db.inserted.length = 0
  db.selects.length = 0
  db.reuseRows.value = []
  vi.clearAllMocks()
})

describe("job_policy_decisions — the user-safe column is actually wired (D13, migration 380)", () => {
  it("the INSERT writes user_message, and writes it SEPARATELY from the machine reason", async () => {
    await recordJobPolicyDecision({
      jobId: "job-1",
      hookPoint: "result",
      policyId: "nsfw",
      verdict: "block",
      reason: "nsfw_score=0.98 label=explicit",
      userMessage: "This image could not be published",
    })
    expect(db.inserted[0]).toMatchObject({
      reason: "nsfw_score=0.98 label=explicit",
      user_message: "This image could not be published",
    })
  })

  it("a decision that showed the user nothing writes NULL, never a copy of the reason", async () => {
    // A `hold` parks the job behind an overlay and says nothing. If the absent
    // `userMessage` defaulted to `reason`, the column would be seeded with the
    // very scores it exists to keep off a canvas.
    await recordJobPolicyDecision({
      jobId: "job-1", hookPoint: "result", policyId: "nsfw", verdict: "hold",
      reason: "nsfw_score=0.71 label=suggestive",
    })
    expect(db.inserted[0]!.user_message).toBeNull()
  })

  it("the reuse lookup ASKS for user_message and maps it", async () => {
    db.reuseRows.value = [{
      id: "d1", verdict: "block", reason: "nsfw_score=0.98 label=explicit",
      user_message: "This image could not be published", policy_id: "nsfw",
      applied: null, hold_downgraded: false,
    }]
    const reused = await findReusableDecision("job-1", "result", "hash-1")
    // Without the column in the select list PostgREST simply omits it and the
    // gate falls back forever — the failure is silent, so it is pinned here.
    expect(db.selects[0]).toContain("user_message")
    expect(reused?.userMessage).toBe("This image could not be published")
  })

  it("a row written BEFORE 380 maps to null — NOT to the machine reason", async () => {
    // PostgREST omits the key entirely on a database without the column. The
    // one mapping that must never appear here is `?? row.reason`.
    db.reuseRows.value = [{
      id: "d1", verdict: "block", reason: "nsfw_score=0.98 label=explicit",
      policy_id: "nsfw", applied: null, hold_downgraded: false,
    }]
    const reused = await findReusableDecision("job-1", "result", "hash-1")
    expect(reused?.reason).toBe("nsfw_score=0.98 label=explicit")
    expect(reused?.userMessage).toBeNull()
  })
})
