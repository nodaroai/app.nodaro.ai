/**
 * Which LLM lane served a job is an internal diagnostic. Describe to Picker,
 * Text to Picker, Image to Text and the structured LLM route write it to
 * `jobs.provider` — and what the call cost the platform to `jobs.provider_cost`
 * — which owners never see:
 *  - it is not in PUBLIC_JOB_KEYS (the `/v1/jobs` projection),
 *  - it is outside the browser's column grant on `jobs` (migration 347 grants
 *    `id, user_id, status, output_data` only, so PostgREST and Realtime cannot
 *    read it),
 *  - and the MCP job view never reads the column.
 * `output_data` IS owner-readable on all three surfaces, so the lane must not
 * ride in it. These cases pin both halves.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sanitizeJobForPublic, PUBLIC_JOB_KEYS, ADMIN_ONLY_JOB_KEYS, type JobRecord } from "../jobs.js"
import { jobView } from "../../lib/mcp/tools/_job-view.js"

/** A completed Describe to Picker row as the route writes it, after a fallback. */
const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "completed",
  progress: 100,
  input_data: { type: "describe-to-picker", imageUrl: "https://cdn.example/portrait.png", targetPickers: ["person"] },
  output_data: { json: { person: { age: "age-30s" } }, targetPickers: ["person"], usage: { inputTokens: 900, outputTokens: 30 } },
  error_message: null,
  created_at: "2026-10-09T00:00:00.000Z",
  started_at: "2026-10-09T00:00:00.000Z",
  completed_at: "2026-10-09T00:00:05.000Z",
  user_id: "00000000-0000-4000-8000-000000000001",
  provider: "direct-gemini",
  provider_cost: 0.0073,
  display_cost: null,
  credits: 2,
  credits_actual: null,
  job_type: null,
} as unknown as JobRecord

describe("the serving lane never reaches a job's owner", () => {
  it("is absent from the owner's /v1/jobs view, and so is the provider cost", () => {
    const view = sanitizeJobForPublic(ROW, false)

    expect(view).not.toHaveProperty("provider")
    expect(view).not.toHaveProperty("provider_cost")
    expect(JSON.stringify(view)).not.toMatch(/direct-gemini|0\.0073/)
  })

  it("is present for an admin — the one place it is meant to be read", () => {
    expect(sanitizeJobForPublic(ROW, true)).toHaveProperty("provider", "direct-gemini")
    expect(sanitizeJobForPublic(ROW, true)).toHaveProperty("provider_cost", 0.0073)
  })

  it("is absent from the MCP job view", () => {
    expect(JSON.stringify(jobView(ROW as never))).not.toMatch(/direct-gemini|0\.0073/)
  })

  it("lives in a column the projection keeps admin-only", () => {
    expect(PUBLIC_JOB_KEYS as readonly string[]).not.toContain("provider")
    expect(PUBLIC_JOB_KEYS as readonly string[]).not.toContain("provider_cost")
    expect(ADMIN_ONLY_JOB_KEYS as readonly string[]).toContain("provider")
    expect(ADMIN_ONLY_JOB_KEYS as readonly string[]).toContain("provider_cost")
  })

  it("lives in a column outside the browser's grant on jobs, unlike output_data", () => {
    const migration = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "supabase", "migrations", "347_jobs_cost_columns_and_private_by_default.sql"),
      "utf8",
    )
    expect(migration).toContain("GRANT SELECT (id, user_id, status, output_data) ON TABLE public.jobs TO authenticated;")
  })

  it("is not written into output_data by any of the four routes, and each writes the provider cost beside it", () => {
    for (const route of ["describe-to-picker.ts", "text-to-picker.ts", "image-to-text.ts", "llm-structured.ts"]) {
      const source = readFileSync(join(import.meta.dirname, "..", route), "utf8")
      expect(source, route).not.toMatch(/usage\s*[:=]\s*\{[^}]*\blane\b/)
      expect(source, route).not.toMatch(/output_data:\s*\{[^}]*\bproviderCost\b/)
      expect(source, route).toMatch(/provider:\s*[^,\n]*lane/i)
      expect(source, route).toMatch(/provider_cost:/)
    }
  })
})
