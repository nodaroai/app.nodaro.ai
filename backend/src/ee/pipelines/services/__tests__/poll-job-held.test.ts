/**
 * `pollJobUntilComplete` and a job parked in `pending_review`
 * (spec 2026-09-03-job-policy-hook-design §6.4).
 *
 * Without the arm, a held child burns the whole 30-minute stage budget and
 * then fails with `"Job … timed out after 1800000ms"` — which names the wrong
 * cause (the job is healthy; its OUTPUT is withheld), blames whichever stage
 * happened to be running, and leaves the pipeline to move on while a later
 * approval completes a job nobody consumes.
 *
 * A contract guard: pipeline children are hold-INELIGIBLE in v1 (D8 excludes
 * every job with a `pipeline_id`), so this cannot fire today. It fixes the
 * behaviour before eligibility widens.
 */
import { describe, it, expect, vi } from "vitest"
import { JobHeldError, pollJobUntilComplete } from "../_poll.js"

function supabaseReturning(status: string) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { status, output_data: null, error_message: null, credits_actual: null },
    error: null,
  })
  const client = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    }),
  }
  return { client, maybeSingle }
}

describe("pollJobUntilComplete — pending_review", () => {
  it("throws JobHeldError on the first read instead of burning the stage timeout", async () => {
    const { client, maybeSingle } = supabaseReturning("pending_review")

    await expect(
      pollJobUntilComplete(client as never, "job-held", { pollIntervalMs: 1, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(JobHeldError)

    // One read: it did not loop to the deadline.
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })

  it("carries policy_hold as the pipeline failure_reason, and the job id", async () => {
    const { client } = supabaseReturning("pending_review")

    const err = await pollJobUntilComplete(client as never, "job-held-2", {
      pollIntervalMs: 1,
      timeoutMs: 60_000,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(JobHeldError)
    expect((err as JobHeldError).failureReason).toBe("policy_hold")
    expect((err as JobHeldError).jobId).toBe("job-held-2")
    // NOT a timeout — the message must not be mistaken for one.
    expect((err as Error).message).not.toMatch(/timed out/i)
    expect((err as Error).message).toMatch(/review/i)
  })

  it("still resolves normally on a completed job", async () => {
    const { client } = supabaseReturning("completed")
    const row = await pollJobUntilComplete(client as never, "job-ok", {
      pollIntervalMs: 1,
      timeoutMs: 60_000,
    })
    expect(row.status).toBe("completed")
  })
})
