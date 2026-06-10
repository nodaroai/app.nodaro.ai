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
