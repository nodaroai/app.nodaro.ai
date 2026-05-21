import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  estimateUpfrontCredits,
  resolveMaxCostCredits,
  reservePipelineCredits,
  refundPipelineCredits,
} from "../credits.js"

beforeEach(() => vi.clearAllMocks())

describe("estimateUpfrontCredits", () => {
  it("includes Stage 1 baseline (30) + music (4) + editor (3) + final-merge (3) + storyboard cohesion (5) + video-critic default budget when music is enabled", () => {
    // Phase 1C.2: pipeline-level Stage 7 sub-steps add to the Stage 1 baseline.
    // Phase 1D.2c-b-i: Storyboard Cohesion critic adds 5 credits (all modes).
    // Phase 1D.2c-b-ii (G1): Video Critic per-shot budget — default
    //   first_last → 2cr × max(5, ceil(targetDuration/4)) shots.
    //   60s → 15 shots → 30 cr.
    //   30 (Stage 1) + 4 (music) + 3 (editor) + 3 (final merge) + 5 (cohesion) + 30 (video critic) = 75
    expect(
      estimateUpfrontCredits({
        targetDurationSeconds: 60,
        format: "short_film",
        mode: "manual",
        musicEnabled: true,
        narrationEnabled: true,
        lipsyncEnabled: true,
      }),
    ).toBe(75)
  })

  it("excludes the 4 cr music allocation when music is disabled", () => {
    // 30 (Stage 1) + 0 (music) + 3 (editor) + 3 (final merge) + 5 (cohesion)
    //   + 30 (video critic @ 60s first_last) = 71
    expect(
      estimateUpfrontCredits({
        targetDurationSeconds: 60,
        format: "short_film",
        mode: "manual",
        musicEnabled: false,
        narrationEnabled: true,
        lipsyncEnabled: true,
      }),
    ).toBe(71)
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
    ).toBe(75)
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
    // Phase 1D.2c-b-ii (G1): video critic adds 16cr at 30s first_last (max(5, ceil(30/4)) = 8 shots × 2cr).
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
    // Manual + 5 cohesion + 16 video critic = 61; auto same; guided adds 40 chat-refine = 101.
    expect(manual).toBe(61)
    expect(auto).toBe(61)
    expect(guided).toBe(101)
  })

  // ─── Phase 1D.2c-b-ii G1 — Video Critic per-shot budget ─────────────
  // The Video Critic runs once per shot in Stage 7. Cost scales with the
  // frame_count mode (2/3/5 frames per shot). Shot count is derived from
  // target_duration_seconds via the conservative approximation
  // `max(5, ceil(target_duration_seconds / 4))` — used for upfront
  // reservation; unused credits refund on completion.

  it("G1 default (first_last) — 30s pipeline reserves 2cr × max(5, ceil(30/4)) = 2 × 8 = 16 extra credits", () => {
    // Baseline: 30 + 4 + 3 + 3 + 5 = 45 (manual, music on).
    // Add: 16 (video critic, default mode).
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      // No videoCriticFrameCount → default to "first_last"
    })
    expect(credits).toBe(45 + 16) // 61
  })

  it("G1 first_middle_last — 3cr per shot × 8 shots = 24 extra credits over baseline", () => {
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      videoCriticFrameCount: "first_middle_last",
    })
    expect(credits).toBe(45 + 24) // 69
  })

  it("G1 five_evenly — 4cr per shot × 8 shots = 32 extra credits over baseline", () => {
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      videoCriticFrameCount: "five_evenly",
    })
    expect(credits).toBe(45 + 32) // 77
  })

  it("G1 minimum-shots floor: 5s pipeline still budgets for 5 shots (not duration/4=2)", () => {
    // ceil(5/4)=2, but we floor at 5 shots to keep the per-shot budget safe
    // for very short reels.
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 5,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      videoCriticFrameCount: "first_last",
    })
    // Baseline 45 + 2cr × 5 shots = 55.
    expect(credits).toBe(45 + 10)
  })

  it("G1 scales linearly with duration — 60s pipeline budgets for 15 shots", () => {
    // ceil(60/4)=15 shots, well above the floor of 5.
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 60,
      format: "short_film",
      mode: "manual",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      videoCriticFrameCount: "first_last",
    })
    // Baseline 45 + 2cr × 15 shots = 75.
    expect(credits).toBe(45 + 30)
  })

  it("G1 guided mode combines chat budget AND video-critic budget", () => {
    // 30 + 4 + 3 + 3 + 5 = 45 baseline
    // + 40 chat (guided)
    // + 2 × 8 = 16 video critic (first_last @ 30s = 8 shots)
    // = 101
    const credits = estimateUpfrontCredits({
      targetDurationSeconds: 30,
      format: "short_film",
      mode: "guided",
      musicEnabled: true,
      narrationEnabled: true,
      lipsyncEnabled: true,
      videoCriticFrameCount: "first_last",
    })
    expect(credits).toBe(45 + 40 + 16)
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
