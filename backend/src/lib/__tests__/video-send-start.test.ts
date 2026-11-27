import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  job: { id: "j", job_type: "generate-video-pro", status: "processing", stop_requested_at: null as string | null, video_send_started_at: null as string | null },
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const conditions: Array<() => boolean> = []
      let update: { video_send_started_at: string } | undefined
      const row = db.job as Record<string, unknown>
      const query = {
        update(value: { video_send_started_at: string }) { update = value; return query },
        eq(key: string, value: unknown) { conditions.push(() => row[key] === value); return query },
        is(key: string, value: unknown) { return query.eq(key, value) },
        in(key: string, values: unknown[]) { conditions.push(() => values.includes(row[key])); return query },
        select() {
          if (!update) return query
          const live = conditions.every((matches) => matches())
          if (live) Object.assign(row, update)
          return { data: live ? [{ id: row.id }] : [], error: null }
        },
        maybeSingle: async () => ({ data: conditions.every((matches) => matches()) ? row : null, error: null }),
      }
      return query
    },
  },
}))

import { beginPlannedVideoSegment, markVideoSendStarted } from "../video-send-start.js"

describe("video submit and stop", () => {
  beforeEach(() => { db.job = { id: "j", job_type: "generate-video-pro", status: "processing", stop_requested_at: null, video_send_started_at: null } })

  it("an owner stop that wins before the first submit leaves it unsent", async () => {
    db.job.status = "cancelled"
    await expect(markVideoSendStarted("j")).rejects.toMatchObject({ name: "JobCancelledError" })
    expect(db.job.video_send_started_at).toBeNull()
  })

  it("the active run is marked at submit, including when the sink does not save a task id", async () => {
    await markVideoSendStarted("j")
    expect(db.job.video_send_started_at).toEqual(expect.any(String))
  })

  it.each(["generate-video-pro", "edit-video-pro", "ugc-clip"])("%s finishes the current segment and rejects the next submit after Stop", async (type) => {
    db.job.job_type = type
    await beginPlannedVideoSegment("j")
    const first = db.job.video_send_started_at
    db.job.stop_requested_at = new Date().toISOString()
    await expect(beginPlannedVideoSegment("j")).rejects.toMatchObject({ name: "JobStopRequestedError" })
    expect(db.job.video_send_started_at).toBe(first)
  })
})
