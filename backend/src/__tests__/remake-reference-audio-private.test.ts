// @test-reads-none the serializers it pins are called in memory
/**
 * Video Remake's reference audio keys are server-only (decided 2026-11-27,
 * lib/job-output-visibility.ts): the admin's per-engine-size choice the
 * platform puts in a run's request (`input_data.prismReferenceAudio` /
 * `pulseReferenceAudio`) and what the engine records it did with it
 * (`output_data.prismReferenceAudio…`, `pulseReferenceAudio…`). No public job
 * read returns them, an admin's included, for a row stored before the rule
 * too: the lists and the read by id (`sanitizeJobForPublic`, also the Trash,
 * a session's items, an upload's job and a webhook's fresh body), MCP
 * `get_job` (`jobView`) and `list_jobs` (`redactPrivateJobData`),
 * `wait_for_job`, the task reads and the share pages (`redactPrivateJobOutput`),
 * and a webhook body recorded before the rule (`redactRecordedJobEvent`).
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: {}, tryRemoveFromQueue: vi.fn(), redis: {} }))

const { sanitizeJobForPublic } = await import("../routes/jobs.js")
const { jobView } = await import("../lib/mcp/tools/_job-view.js")
const { redactPrivateJobData, redactPrivateJobOutput, redactRecordedJobEvent } = await import("../lib/public-job-data.js")

const JOB = "11111111-2222-4333-8444-555555555555"

/** A stored Video Remake row with every reference audio key the platform and the engine write. */
function storedRow() {
  return {
    id: JOB, status: "completed", progress: 100, user_id: "u1", job_type: "cast-swap",
    input_data: {
      type: "cast-swap",
      engine: "seedance-2-5",
      resolution: "720p",
      prismReferenceAudio: { "720p": { mode: "voice", semitones: 4 } },
      pulseReferenceAudio: { "1080p": { mode: "full", semitones: 0 } },
    },
    output_data: {
      videoUrl: `https://cdn.test/videos/${JOB}.mp4`,
      resolution: "720p",
      prismReferenceAudio: "voice",
      prismReferenceAudioSemitones: 4,
      prismReferenceAudioResolution: "720p",
      prismReferenceAudioFallback: true,
      prismReferenceAudioFallbackReason: "no-voice",
      pulseReferenceAudioResolution: "1080p",
    },
    error_message: null, created_at: "2026-11-27T10:00:00Z", started_at: null, completed_at: null, credits: 10,
  }
}

const PUBLIC_INPUT = { type: "cast-swap", engine: "seedance-2-5", resolution: "720p" }
const PUBLIC_OUTPUT = { videoUrl: `https://cdn.test/videos/${JOB}.mp4`, resolution: "720p" }

describe("a Video Remake run's reference audio never leaves the server", () => {
  it("the read by id and the lists (sanitizeJobForPublic) drop it, for an admin as for anyone", () => {
    for (const isAdmin of [false, true]) {
      const out = sanitizeJobForPublic(storedRow() as never, isAdmin) as unknown as Record<string, unknown>
      expect(JSON.stringify(out)).not.toContain("ReferenceAudio")
      expect(out.output_data).toEqual(PUBLIC_OUTPUT)
      expect(out.input_data).toMatchObject(PUBLIC_INPUT)
    }
  })

  it("MCP get_job (jobView) drops it from the output and the input it shows", () => {
    const view = jobView(storedRow() as never)
    expect(JSON.stringify(view)).not.toContain("ReferenceAudio")
    expect(view.outputData).toEqual(PUBLIC_OUTPUT)
  })

  it("MCP list_jobs and every whole-row read (redactPrivateJobData) drop it from each row", () => {
    const answer = redactPrivateJobData({ data: [storedRow(), storedRow()] })
    expect(JSON.stringify(answer)).not.toContain("ReferenceAudio")
    expect(answer.data[0]!.input_data).toEqual(PUBLIC_INPUT)
    expect(answer.data[1]!.output_data).toEqual(PUBLIC_OUTPUT)
  })

  it("a bare output read (wait_for_job, the task reads, the share pages) drops it", () => {
    expect(redactPrivateJobOutput(storedRow().output_data)).toEqual(PUBLIC_OUTPUT)
  })

  it("the stored row keeps it: the strip is on read, never on write", () => {
    const row = storedRow()
    sanitizeJobForPublic(row as never, false)
    redactPrivateJobData(row)
    redactPrivateJobOutput(row.output_data)
    expect(row.input_data).toHaveProperty("prismReferenceAudio")
    expect(row.output_data).toHaveProperty("prismReferenceAudioSemitones")
  })

  it("keeps a key of the run that only resembles it (a nested one, another name)", () => {
    const row = { input_data: { pulseAudio: "original", trend: { prismReferenceAudio: "voice" } }, output_data: { referenceAudio: 1 } }
    expect(redactPrivateJobData(row)).toEqual(row)
  })
})

describe("a webhook body recorded before the rule (redactRecordedJobEvent)", () => {
  const recorded = (job: Record<string, unknown>) =>
    JSON.stringify({ id: "d1", type: "job.completed", createdAt: "2026-11-27T10:00:00Z", data: { job } })

  it("is sent and shown without the reference audio keys, everything else as recorded", () => {
    const { input_data, output_data, id, status } = storedRow()
    const body = redactRecordedJobEvent(recorded({ id, status, input_data, output_data }))
    expect(body).not.toContain("ReferenceAudio")
    expect(JSON.parse(body)).toEqual({
      id: "d1", type: "job.completed", createdAt: "2026-11-27T10:00:00Z",
      data: { job: { id, status, input_data: PUBLIC_INPUT, output_data: PUBLIC_OUTPUT } },
    })
  })

  it("is the same text, byte for byte, when there is nothing to drop", () => {
    const body = recorded({ id: JOB, status: "completed", input_data: PUBLIC_INPUT, output_data: PUBLIC_OUTPUT })
    expect(redactRecordedJobEvent(body)).toBe(body)
    const ping = JSON.stringify({ id: "d2", type: "ping", data: { webhookId: "w1" } })
    expect(redactRecordedJobEvent(ping)).toBe(ping)
    expect(redactRecordedJobEvent("not json")).toBe("not json")
  })
})
