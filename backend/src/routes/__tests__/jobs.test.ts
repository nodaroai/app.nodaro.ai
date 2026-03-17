import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

let mockIsCloud = false

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => mockIsCloud,
  hasCredits: () => mockIsCloud,
  isCommunity: () => !mockIsCloud,
  isBusiness: () => false,
  hasAdmin: () => mockIsCloud,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { sanitizeJobForPublic, type JobRecord } from "../jobs.js"

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleJob: JobRecord = {
  id: "job-1",
  status: "completed",
  progress: 100,
  input_data: { prompt: "test" },
  output_data: { url: "https://example.com/result.png" },
  error_message: null,
  created_at: "2024-01-01T00:00:00Z",
  started_at: "2024-01-01T00:00:01Z",
  completed_at: "2024-01-01T00:00:05Z",
  user_id: "user-1",
  provider: "nano-banana",
  provider_cost: 0.02,
  display_cost: 0.025,
  credits: 1,
  credits_actual: null,
  job_type: "generate-image",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sanitizeJobForPublic", () => {
  it("returns the full job unchanged for admin users", () => {
    const result = sanitizeJobForPublic(sampleJob, true)

    expect(result).toEqual(sampleJob)
    expect("provider" in result).toBe(true)
    expect("provider_cost" in result).toBe(true)
    expect("credits_actual" in result).toBe(true)
  })

  it("strips provider and cost details for regular users", () => {
    const result = sanitizeJobForPublic(sampleJob, false)

    // Sensitive fields should be removed
    expect("provider" in result).toBe(false)
    expect("provider_cost" in result).toBe(false)
    expect("display_cost" in result).toBe(false)
    expect("credits_actual" in result).toBe(false)

    // Public cost field should be present with display_cost value
    expect("cost" in result).toBe(true)
    expect((result as unknown as Record<string, unknown>).cost).toBe(0.025)

    // Other fields should be preserved
    expect(result.id).toBe("job-1")
    expect(result.status).toBe("completed")
    expect(result.credits).toBe(1)
  })

  it("handles null display_cost correctly for regular users", () => {
    const jobWithNullCost: JobRecord = {
      ...sampleJob,
      display_cost: null,
    }

    const result = sanitizeJobForPublic(jobWithNullCost, false)
    expect((result as unknown as Record<string, unknown>).cost).toBeNull()
  })
})
