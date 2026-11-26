// @test-reads-none the serializers it pins are called in memory
/**
 * `jobs.server_output` (migration 695, decided 2026-11-22) holds what a job
 * stored that its owner must not read — a watermarked Extend's unwatermarked
 * raw clip among it. `output_data` is readable by the owner straight over
 * PostgREST and Realtime (347's column grant), so the reference must live
 * here, and nothing an owner can read may carry it. Pinned here: the
 * user-facing job serializers and webhook columns never carry it. (That no
 * migration grants it to a client role is pinned beside the migration, in
 * jobs-server-output-migration.test.ts.)
 * (That a watermarked Extend writes the clip here and never to output_data is
 * pinned in workers/handlers/__tests__/extend-seedance25.test.ts.)
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: {}, tryRemoveFromQueue: vi.fn(), redis: {} }))

const { sanitizeJobForPublic } = await import("../routes/jobs.js")
const { jobView } = await import("../lib/mcp/tools/_job-view.js")
const { jobEventColumns } = await import("../lib/webhooks/event.js")

const RAW = "https://cdn.test/videos/11111111-2222-4333-8444-555555555555-raw-99999999-8888-4777-8666-555555555555.mov"

describe("jobs.server_output stays server-only", () => {
  it("the job serializers an owner reads and the webhook columns never carry it", () => {
    const row = {
      id: "11111111-2222-4333-8444-555555555555", status: "completed", progress: 100, user_id: "u1", job_type: "extend-video",
      input_data: {}, output_data: { videoUrl: "https://cdn.test/videos/11111111-2222-4333-8444-555555555555.mp4" },
      error_message: null, created_at: "2026-11-22T10:00:00Z", started_at: null, completed_at: null, credits: 10,
      server_output: { rawExtensionUrl: RAW, stored: { "videos/x-raw.mov": 1 } },
    }
    for (const isAdmin of [false, true]) {
      const out = JSON.stringify(sanitizeJobForPublic(row as never, isAdmin))
      expect(out).not.toContain("server_output")
      expect(out).not.toContain("-raw-")
    }
    expect(JSON.stringify(jobView(row as never))).not.toContain("-raw-")
    expect(jobEventColumns().split(/,\s*/)).not.toContain("server_output")
  })
})
