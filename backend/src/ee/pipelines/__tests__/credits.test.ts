import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  estimateUpfrontCredits,
  resolveMaxCostCredits,
  reservePipelineCredits,
  refundPipelineCredits,
} from "../credits.js"

beforeEach(() => vi.clearAllMocks())

describe("estimateUpfrontCredits", () => {
  it("includes Stage 1 baseline (30) + music (4) + editor (3) + final-merge (3) + storyboard cohesion (5) when music is enabled", () => {
    // Phase 1C.2: pipeline-level Stage 7 sub-steps add to the Stage 1 baseline.
    // Phase 1D.2c-b-i: Storyboard Cohesion critic adds 5 credits to the baseline (all modes).
    //   30 (Stage 1) + 4 (music) + 3 (editor) + 3 (final merge) + 5 (storyboard cohesion) = 45
    expect(
      estimateUpfrontCredits({
        targetDurationSeconds: 60,
        format: "short_film",
        mode: "manual",
        musicEnabled: true,
        narrationEnabled: true,
        lipsyncEnabled: true,
      }),
    ).toBe(45)
  })

  it("excludes the 4 cr music allocation when music is disabled", () => {
    // 30 (Stage 1) + 0 (music disabled) + 3 (editor) + 3 (final merge) + 5 (storyboard cohesion) = 41
    expect(
      estimateUpfrontCredits({
        targetDurationSeconds: 60,
        format: "short_film",
        mode: "manual",
        musicEnabled: false,
        narrationEnabled: true,
        lipsyncEnabled: true,
      }),
    ).toBe(41)
  })

  it("auto mode currently costs the same as manual (no premium yet)", () => {
    expect(
      estimateUpfrontCredits({
        targetDurationSeconds: 60,
        format: "short_film",
        mode: "auto",
        musicEnabled: true,
        narrationEnabled: true,
        lipsyncEnabled: true,
      }),
    ).toBe(45)
  })

  it("adds 40 credits for mode='guided' vs mode='manual' baseline", () => {
    const baseline = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
    })
    const guided = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "guided",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
    })
    expect(guided - baseline).toBe(40) // CHAT_TURN_CAPS.script (20) × 2 credits/turn
  })

  it("adds 5 credits for the Storyboard Cohesion critic to the baseline in all 3 modes", () => {
    // Phase 1D.2c-b-i: critic runs once during Stage 6 (scene_images) in manual/auto/guided.
    const args = {
      targetDurationSeconds: 30,
      format: "short_film" as const,
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
    }
    const manual = estimateUpfrontCredits({ ...args, mode: "manual" })
    const auto = estimateUpfrontCredits({ ...args, mode: "auto" })
    const guided = estimateUpfrontCredits({ ...args, mode: "guided" })
    // Manual + 5 cohesion = 45; auto same; guided adds 40 chat-refine on top = 85.
    expect(manual).toBe(45)
    expect(auto).toBe(45)
    expect(guided).toBe(85)
  })
})

describe("resolveMaxCostCredits", () => {
  it("returns tier cap when nothing requested", () => {
    expect(resolveMaxCostCredits({ tier: "pro" })).toBe(2000)
  })
  it("clamps requested to tier cap", () => {
    expect(resolveMaxCostCredits({ requested: 10_000, tier: "basic" })).toBe(300)
  })
  it("respects requested below tier cap", () => {
    expect(resolveMaxCostCredits({ requested: 100, tier: "pro" })).toBe(100)
  })
  it("falls back to 300 for unknown tier", () => {
    expect(resolveMaxCostCredits({ tier: "made_up" })).toBe(300)
  })
})

function makeSupabaseMock(reserveResult: { data?: string | null; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({
    data: reserveResult.data ?? null,
    error: reserveResult.error ?? null,
  })
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const from = vi.fn().mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { reservation_usage_log_id: "log-1" },
          error: null,
        }),
      }),
    }),
    update: () => ({ eq: updateEq }),
  }))
  return { rpc, from, updateEq } as never as { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn>; updateEq: ReturnType<typeof vi.fn> }
}

describe("reservePipelineCredits", () => {
  it("calls reserve_credits with expected payload and persists the usage_log_id", async () => {
    const supabase = makeSupabaseMock({ data: "log-1" })
    const result = await reservePipelineCredits({
      supabase: supabase as never,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
    })
    expect(result).toEqual({ ok: true, usageLogId: "log-1" })
    expect(supabase.rpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({
        p_user_id: "u1",
        p_credits: 30,
        p_job_id: null,
        p_model_identifier: "pipeline-orchestration",
      }),
    )
  })

  it("returns insufficient_credits when RPC error mentions insufficient", async () => {
    const supabase = makeSupabaseMock({
      error: { message: "Insufficient credits available" },
    })
    const result = await reservePipelineCredits({
      supabase: supabase as never,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
    })
    expect(result).toEqual({ ok: false, reason: "insufficient_credits" })
  })

  it("returns insufficient_credits when RPC returns null without error", async () => {
    const supabase = makeSupabaseMock({ data: null })
    const result = await reservePipelineCredits({
      supabase: supabase as never,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.reason).toBe("insufficient_credits")
  })

  it("returns rpc_error for non-insufficient errors", async () => {
    const supabase = makeSupabaseMock({ error: { message: "connection refused" } })
    const result = await reservePipelineCredits({
      supabase: supabase as never,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.reason).toBe("rpc_error")
      expect(result.detail).toContain("connection")
    }
  })
})

describe("refundPipelineCredits", () => {
  it("calls refund_credits with the persisted usage_log_id", async () => {
    const supabase = makeSupabaseMock({})
    await refundPipelineCredits({
      supabase: supabase as never,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
      reason: "cancel",
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      "refund_credits",
      expect.objectContaining({ p_usage_log_id: "log-1" }),
    )
  })

  it("is a no-op when there is no reservation_usage_log_id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = {
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as never
    await refundPipelineCredits({
      supabase,
      userId: "u1",
      pipelineId: "p1",
      credits: 30,
      reason: "cancel",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
