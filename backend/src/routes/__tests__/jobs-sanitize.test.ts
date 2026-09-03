import { describe, it, expect, vi } from "vitest"

// jobs.ts pulls in supabase/queue/credit modules at import time — stub them
// so the pure sanitize function can be unit-tested in isolation.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: {}, tryRemoveFromQueue: vi.fn(), redis: {} }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

import { sanitizeJobForPublic } from "../jobs.js"

const baseJob = {
  id: "j1",
  status: "processing",
  progress: 85,
  input_data: { prompt: "x" },
  output_data: null,
  error_message: null,
  created_at: "2026-06-10T10:00:00Z",
  started_at: "2026-06-10T10:00:01Z",
  completed_at: null,
  user_id: "u1",
  credits: 6,
  job_type: "generate-image",
  provider: "kie",
  provider_cost: 0.06,
  display_cost: 0.075,
  credits_actual: null,
} as never

describe("sanitizeJobForPublic — recovering flag (audit UX)", () => {
  it("exposes recovering:true for a processing row the reconcile system has touched", () => {
    const job = { ...(baseJob as Record<string, unknown>), reconcile_attempts: 2 }
    const out = sanitizeJobForPublic(job as never, false) as unknown as Record<string, unknown>
    expect(out.recovering).toBe(true)
    // The raw internal counter must NOT leak.
    expect(out).not.toHaveProperty("reconcile_attempts")
  })

  it("omits the flag for an untouched processing row", () => {
    const job = { ...(baseJob as Record<string, unknown>), reconcile_attempts: 0 }
    const out = sanitizeJobForPublic(job as never, false) as unknown as Record<string, unknown>
    expect(out).not.toHaveProperty("recovering")
  })

  it("omits the flag once terminal (completed row with prior recovery attempts)", () => {
    const job = {
      ...(baseJob as Record<string, unknown>),
      status: "completed",
      reconcile_attempts: 3,
    }
    const out = sanitizeJobForPublic(job as never, false) as unknown as Record<string, unknown>
    expect(out).not.toHaveProperty("recovering")
  })

  it("still strips USD cost fields for non-admin", () => {
    const job = { ...(baseJob as Record<string, unknown>), reconcile_attempts: 1 }
    const out = sanitizeJobForPublic(job as never, false) as unknown as Record<string, unknown>
    expect(out).not.toHaveProperty("provider")
    expect(out).not.toHaveProperty("provider_cost")
    expect(out).not.toHaveProperty("display_cost")
  })
})

/**
 * THE LEAK PROOF (spec D6), as a test.
 *
 * A held job's media lives in `held_output_data`, NOT in `output_data`, because
 * `output_data` is on PUBLIC_JOB_KEYS, appears in five explicit selects, and is
 * one of the four columns migration 347 grants to `authenticated` — so it also
 * rides the Realtime UPDATE payload. The `held_*` columns are on NEITHER key
 * list. That is what makes "not exposed" a property of the schema rather than a
 * promise eleven readers have to keep.
 */
describe("sanitizeJobForPublic — a held job never leaks its withheld payload", () => {
  const heldJob = {
    ...(baseJob as Record<string, unknown>),
    status: "pending_review",
    output_data: null,
    held_output_data: { imageUrl: "https://cdn.example.com/images/j1.png" },
    held_completion_fields: { provider: "kie", provider_cost: 0.4, metered: true },
    held_objects: [{ key: "images/j1.png", kind: "image", index: 0 }],
    held_at: "2026-09-03T10:00:00Z",
  }

  for (const isAdmin of [false, true]) {
    it(`drops every held_* key on the ${isAdmin ? "ADMIN" : "non-admin"} branch`, () => {
      const out = sanitizeJobForPublic(heldJob as never, isAdmin) as unknown as Record<string, unknown>
      expect(Object.keys(out).filter((k) => k.startsWith("held_"))).toEqual([])
      expect(out.status).toBe("pending_review")
      expect(out.output_data).toBeNull()
      // and nothing anywhere in the response quotes the withheld URL
      expect(JSON.stringify(out)).not.toContain("cdn.example.com")
    })
  }

  it("still carries the policy-block hint, which IS user-facing by contract", () => {
    const blocked = {
      ...(baseJob as Record<string, unknown>),
      status: "failed",
      error_message: "Blocked by content policy",
      error_hint: { kind: "policy-block", policyId: "sai-moderation", reason: "Blocked by content policy", hookPoint: "result" },
    }
    const out = sanitizeJobForPublic(blocked as never, false) as unknown as Record<string, unknown>
    expect(out.error_hint).toEqual({
      kind: "policy-block", policyId: "sai-moderation",
      reason: "Blocked by content policy", hookPoint: "result",
    })
  })
})

/** The other half of the same proof: the key lists themselves. */
describe("the held payload is on neither key list", () => {
  it("PUBLIC_JOB_KEYS and ADMIN_ONLY_JOB_KEYS name no held_* column", async () => {
    const { PUBLIC_JOB_KEYS, ADMIN_ONLY_JOB_KEYS } = await import("../jobs.js")
    expect([...PUBLIC_JOB_KEYS, ...ADMIN_ONLY_JOB_KEYS].filter((k) => k.startsWith("held_"))).toEqual([])
  })
})
