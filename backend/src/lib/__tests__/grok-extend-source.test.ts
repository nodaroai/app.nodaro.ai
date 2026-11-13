import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Grok extends only its own clips: a completed Grok Imagine text-to-video
 * (`grok`) or image-to-video (`grok-i2v`) run of the same user, made on this
 * install. Every other source is refused here, before anything is reserved,
 * with one code and one message — and the check itself only reads.
 */

type Row = {
  id: string
  user_id: string | null
  status: string | null
  provider_task_id: string | null
  provider_kind: string | null
  relay_job_id?: string | null
  parent_job_id?: string | null
  job_type: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  deleted_at?: string | null
}

const db = vi.hoisted(() => ({ rows: [] as Row[], queries: 0, writes: [] as string[], filters: [] as Array<[string, unknown]> }))
vi.mock("../supabase.js", () => {
  const write = (what: string) => () => {
    db.writes.push(what)
    throw new Error(`the Grok source check must not write (${what})`)
  }
  const chain = () => {
    const filters: Array<[string, unknown]> = []
    const nullFilters: string[] = []
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters.push([col, val]); db.filters.push([col, val]); return q },
      // `.is(col, null)`: the column is NULL (a row that never set it reads as NULL too).
      is: (col: string, val: unknown) => { nullFilters.push(col); db.filters.push([col, val]); return q },
      // As the database answers: the rows every filter matches, at most `n` of them, in table order.
      limit: async (n: number) => {
        db.queries++
        const matches = (r: Record<string, unknown>) =>
          filters.every(([c, v]) => r[c] === v) && nullFilters.every((c) => r[c] == null)
        return { data: db.rows.filter((r) => matches(r as Record<string, unknown>)).slice(0, n), error: null }
      },
      insert: write("insert"),
      update: write("update"),
      upsert: write("upsert"),
      delete: write("delete"),
    }
    return q
  }
  return { supabase: { from: () => chain(), rpc: write("rpc") } }
})

const probe = vi.hoisted(() => ({
  fn: (async () => ({ width: 1280, height: 720, durationSeconds: 6.08, videoDurationSeconds: 6.041667 })) as (url: string) => Promise<{
    width: number
    height: number
    durationSeconds: number
    videoDurationSeconds?: number
  }>,
  urls: [] as string[],
  opts: [] as Array<{ signal?: AbortSignal } | undefined>,
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: async (url: string, opts?: { signal?: AbortSignal }) => {
    probe.urls.push(url)
    probe.opts.push(opts)
    return probe.fn(url)
  },
}))

import { GROK_EXTEND_SOURCE_MESSAGE, GROK_EXTEND_SOURCE_PROVIDERS, resolveGrokExtendSource } from "../grok-extend-source.js"
import { GROK_EXTEND_SOURCE_MODELS } from "@nodaro/shared/models"

const USER = "user-a"
const TASK = "task-grok-src"

function grokRow(over: Partial<Row> = {}, input: Record<string, unknown> = {}): Row {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    user_id: USER,
    status: "completed",
    provider_task_id: TASK,
    provider_kind: "kie-standard",
    job_type: "text-to-video",
    input_data: { provider: "grok", duration: 6, ...input },
    output_data: { videoUrl: "https://cdn.example/grok.mp4", providerTaskId: TASK, kieTaskId: TASK },
    ...over,
  }
}

const REFUSAL = { ok: false, code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE }

beforeEach(() => {
  db.rows = []
  db.queries = 0
  db.writes = []
  db.filters = []
  probe.fn = async () => ({ width: 1280, height: 720, durationSeconds: 6.08, videoDurationSeconds: 6.041667 })
  probe.urls = []
  probe.opts = []
})

describe("resolveGrokExtendSource — refusals", () => {
  it("refuses a source Grok cannot extend before reserving", async () => {
    const cases: Array<{ name: string; taskId: string; rows: Row[] }> = [
      // An uploaded clip (or any URL) has no provider task: the upstream node hands no task id.
      { name: "an upload URL with no task id", taskId: "", rows: [grokRow()] },
      { name: "a blank task id", taskId: "   ", rows: [grokRow({ provider_task_id: "   " })] },
      // An upload's own job row carries no provider task, so no row answers the id.
      { name: "a task id no job carries", taskId: "task-unknown", rows: [grokRow({ provider_task_id: null, input_data: { provider: "upload" } })] },
      {
        name: "a grok-imagine-video-1.5 job",
        taskId: TASK,
        rows: [grokRow({ job_type: "image-to-video" }, { provider: "grok-imagine-video-1.5", resolution: "480p", duration: 8 })],
      },
      { name: "another user's job", taskId: TASK, rows: [grokRow({ user_id: "user-b" })] },
      { name: "a failed job", taskId: TASK, rows: [grokRow({ status: "failed", output_data: null })] },
      { name: "a job still running", taskId: TASK, rows: [grokRow({ status: "processing", output_data: null })] },
      { name: "a cancelled job", taskId: TASK, rows: [grokRow({ status: "cancelled" })] },
      // `grok` is also Grok Imagine's IMAGE id: a still has a task id but no video.
      {
        name: "a Grok Imagine image job",
        taskId: TASK,
        rows: [grokRow({ job_type: "generate-image", output_data: { imageUrl: "https://cdn.example/grok.png", providerTaskId: TASK } })],
      },
      { name: "another model's video", taskId: TASK, rows: [grokRow({}, { provider: "seedance-2-5" })] },
      // Rendered through a connected nodaro.ai account: its task is on that account, not this install's.
      { name: "a relayed job", taskId: TASK, rows: [grokRow({ relay_job_id: "remote-job-1" })] },
      { name: "a job run on nodaro-cloud", taskId: TASK, rows: [grokRow({ provider_kind: "nodaro-cloud" })] },
      { name: "a job run by another vendor", taskId: TASK, rows: [grokRow({ provider_kind: "replicate-prediction" })] },
      // Grok bills an extension at the source's resolution, and is priced at 480p and 720p only.
      { name: "a 1080p source", taskId: TASK, rows: [grokRow({}, { resolution: "1080p" })] },
    ]
    for (const c of cases) {
      db.rows = c.rows
      db.writes = []
      probe.urls = []
      const r = await resolveGrokExtendSource({ taskId: c.taskId, userId: USER })
      expect(r, c.name).toEqual(REFUSAL)
      // Nothing reserved or written — the check only reads — and no source probed for a refusal.
      expect(db.writes, c.name).toEqual([])
      expect(probe.urls, c.name).toEqual([])
    }
  })

  it("asks no query for a blank task id", async () => {
    db.rows = [grokRow({ provider_task_id: "" })]
    await expect(resolveGrokExtendSource({ taskId: "", userId: USER })).resolves.toEqual(REFUSAL)
    expect(db.queries).toBe(0)
  })

  it("refuses for a caller with no user id", async () => {
    db.rows = [grokRow({ user_id: null })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: "" })).resolves.toEqual(REFUSAL)
  })

  it("checks the same Grok Imagine models a workflow hands a Grok extend a task from", () => {
    expect([...GROK_EXTEND_SOURCE_PROVIDERS].sort()).toEqual([...GROK_EXTEND_SOURCE_MODELS].sort())
  })

  it("the message names what Grok can extend, and only that", () => {
    expect(GROK_EXTEND_SOURCE_MESSAGE).toMatch(/Grok Imagine/)
    expect(GROK_EXTEND_SOURCE_MESSAGE).toMatch(/text/)
    expect(GROK_EXTEND_SOURCE_MESSAGE).toMatch(/image/)
    // No vendor or wire words: the user never sees a task id.
    expect(GROK_EXTEND_SOURCE_MESSAGE).not.toMatch(/KIE|task id|task_id|taskId/i)
  })
})

describe("resolveGrokExtendSource — a Grok clip", () => {
  it("answers the measured picture length and the source's resolution", async () => {
    db.rows = [grokRow({}, { resolution: "480p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toEqual({ ok: true, sourceSec: 6.041667, resolution: "480p", taskId: TASK })
    // Looked up by the task id, and the stored clip was the one measured.
    expect(db.filters).toContainEqual(["provider_task_id", TASK])
    expect(probe.urls).toEqual(["https://cdn.example/grok.mp4"])
    expect(db.writes).toEqual([])
  })

  it("an image-to-video clip extends too", async () => {
    db.rows = [grokRow({ job_type: "image-to-video" }, { provider: "grok-i2v", resolution: "720p", duration: 10 })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toEqual({ ok: true, sourceSec: 6.041667, resolution: "720p", taskId: TASK })
  })

  it("a workflow run's clip (its job type is the node's) extends too", async () => {
    db.rows = [grokRow({ job_type: "generate-video", parent_job_id: null }, { provider: "grok-i2v", resolution: "480p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "480p" })
  })

  it("a resolution spelled in capitals is the same resolution", async () => {
    db.rows = [grokRow({}, { resolution: " 720P " })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "720p" })
  })

  it("a run that named no resolution: what it rendered at — text-to-video's request pins 720p, image-to-video's sends none and Grok renders 480p", async () => {
    db.rows = [grokRow({}, { provider: "grok" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "720p" })
    db.rows = [grokRow({ job_type: "image-to-video" }, { provider: "grok-i2v" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "480p" })
  })

  it("a clip whose task stamp never landed still extends (the pickup's pre-task stamp, or none)", async () => {
    // The pickup stamps `pre-task`, which the task's own stamp replaces — best-effort, so a
    // failed write leaves it; the completion still records the task id.
    for (const provider_kind of ["pre-task", null]) {
      db.rows = [grokRow({ provider_kind }, { resolution: "480p" })]
      await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER }), String(provider_kind)).resolves.toMatchObject({ ok: true, resolution: "480p" })
    }
  })

  it("picks the caller's completed Grok clip among the rows that carry the task id", async () => {
    db.rows = [
      grokRow({ id: "row-other-user", user_id: "user-b" }),
      grokRow({ id: "row-failed-retry", status: "failed", output_data: null }),
      grokRow({ id: "row-own", output_data: { videoUrl: "https://cdn.example/own.mp4" } }, { resolution: "720p" }),
    ]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "720p" })
    expect(probe.urls).toEqual(["https://cdn.example/own.mp4"])
  })

  it("reads the picture's length, not the container's (the sound can run past the last frame)", async () => {
    db.rows = [grokRow()]
    probe.fn = async () => ({ width: 1280, height: 720, durationSeconds: 10.2, videoDurationSeconds: 10.041667 })
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ sourceSec: 10.041667 })
    // A probe with no stream length falls back to the container's.
    probe.fn = async () => ({ width: 1280, height: 720, durationSeconds: 6.1 })
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ sourceSec: 6.1 })
  })

  it("finds the caller's own clip however many other rows carry the same task id (owner and status are asked of the database)", async () => {
    // More rows than one read takes, all ahead of the caller's: other users' and the caller's own failed retries.
    db.rows = [
      ...Array.from({ length: 12 }, (_, i) => grokRow({ id: `row-other-${i}`, user_id: `user-${i}` })),
      ...Array.from({ length: 12 }, (_, i) => grokRow({ id: `row-failed-${i}`, status: "failed", output_data: null })),
      grokRow({ id: "row-own", output_data: { videoUrl: "https://cdn.example/own.mp4" } }, { resolution: "480p" }),
    ]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, resolution: "480p" })
    expect(probe.urls).toEqual(["https://cdn.example/own.mp4"])
    expect(db.filters).toEqual(expect.arrayContaining([["provider_task_id", TASK], ["user_id", USER], ["status", "completed"]]))
  })

  it("refuses a clip in the Trash, and asks the database to leave the Trash out", async () => {
    db.rows = [grokRow({ deleted_at: "2026-11-13T00:00:00Z" }, { resolution: "720p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: false, code: "grok_extend_source" })
    expect(db.filters).toContainEqual(["deleted_at", null])
    expect(probe.urls).toEqual([])
  })

  it("answers the task id it matched, trimmed — the one the run must send", async () => {
    db.rows = [grokRow({}, { resolution: "720p" })]
    await expect(resolveGrokExtendSource({ taskId: `  ${TASK}\n`, userId: USER })).resolves.toEqual({ ok: true, sourceSec: 6.041667, resolution: "720p", taskId: TASK })
    expect(db.filters).toContainEqual(["provider_task_id", TASK])
  })

  it("measures the source within the caller's time limit, when it sets one", async () => {
    db.rows = [grokRow({}, { resolution: "480p" })]
    await resolveGrokExtendSource({ taskId: TASK, userId: USER, probeTimeoutMs: 20_000 })
    expect(probe.opts[0]?.signal).toBeInstanceOf(AbortSignal)
    // A probe the limit stops falls back to the length the run asked for, like any failed probe.
    probe.fn = async () => { throw Object.assign(new Error("ffprobe failed: aborted"), { killed: true }) }
    db.rows = [grokRow({}, { duration: 10, resolution: "480p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER, probeTimeoutMs: 20_000 })).resolves.toMatchObject({ ok: true, sourceSec: 10 })
  })

  it("an extension made by Grok Extend is no source: Grok extends only a text- or image-to-video run", async () => {
    // The extend job's own row records its provider as grok-extend, and carries the extension's own task.
    db.rows = [grokRow({ job_type: "extend-video", provider_task_id: "task-grok-ext-1", output_data: { videoUrl: "https://cdn.example/ext.mp4", kieTaskId: "task-grok-ext-1" } }, { provider: "grok-extend", resolution: "720p", kieTaskId: TASK, duration: 6 })]
    await expect(resolveGrokExtendSource({ taskId: "task-grok-ext-1", userId: USER })).resolves.toEqual(REFUSAL)
    expect(probe.urls).toEqual([])
  })

  it("a source that cannot be measured falls back to the length its run asked for (Grok renders exactly that), else its default", async () => {
    probe.fn = async () => { throw new Error("ffprobe timed out") }
    db.rows = [grokRow({}, { duration: 10, resolution: "480p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toEqual({ ok: true, sourceSec: 10, resolution: "480p", taskId: TASK })
    db.rows = [grokRow({}, { duration: "10", resolution: "480p" })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ sourceSec: 10 })
    db.rows = [grokRow({ job_type: "image-to-video" }, { provider: "grok-i2v", duration: undefined })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ ok: true, sourceSec: 6 })
    // A probe that answers no usable length counts as unmeasured.
    probe.fn = async () => ({ width: 0, height: 0, durationSeconds: 0, videoDurationSeconds: 0 })
    db.rows = [grokRow({}, { duration: 10 })]
    await expect(resolveGrokExtendSource({ taskId: TASK, userId: USER })).resolves.toMatchObject({ sourceSec: 10 })
  })
})
