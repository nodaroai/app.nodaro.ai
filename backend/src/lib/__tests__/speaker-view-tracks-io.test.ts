/**
 * The server's reads behind Speaker View's face tracks (P3.9): the Speaker
 * Frames job behind a track file, read OWNER-SCOPED, and the stored box body,
 * checked against the descriptor's size and hash before it is parsed.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SPEAKER_TRACKS_MAX_BYTES, type SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"

const db = vi.hoisted(() => ({
  filters: [] as Array<[string, unknown]>,
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}))

vi.mock("../supabase.js", () => {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      db.filters.push([column, value])
      return chain
    },
    maybeSingle: async () => ({ data: db.row, error: db.error }),
  }
  return { supabase: { from: (table: string) => { db.filters.push(["table", table]); return chain } } }
})

import { readSpeakerTrackBody, resolveSpeakerViewTracksOfNode, SpeakerTrackBodyError, speakerViewTracksServerDeps } from "../speaker-view-tracks-io.js"

const JOB = "11111111-2222-4333-8444-555555555555"
const USER = "00000000-0000-4000-8000-000000000001"
const BODY = Buffer.from(JSON.stringify({ version: 1, sampleFps: 2, detector: { id: "yunet" }, sources: [] }))
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const descriptor = (over: Partial<SpeakerTrackSetDescriptor> = {}): SpeakerTrackSetDescriptor =>
  ({
    version: 1,
    sampleFps: 2,
    detector: { id: "yunet" },
    url: `https://media.example/users/u1/speaker-tracks/${JOB}.json`,
    sha256: sha(BODY),
    bytes: BODY.length,
    sources: [],
    ...over,
  }) as SpeakerTrackSetDescriptor

beforeEach(() => {
  db.filters = []
  db.row = null
  db.error = null
})

describe("readSpeakerTrackBody (size, then hash, then JSON)", () => {
  const io = (body: Buffer | null) => {
    const calls: Array<[string, number]> = []
    return { calls, io: { readOwn: async (url: string, max: number) => { calls.push([url, max]); return body } } }
  }

  it("returns the parsed body when it is the file the descriptor names", async () => {
    const r = io(BODY)
    expect(await readSpeakerTrackBody(descriptor(), r.io)).toEqual(JSON.parse(BODY.toString("utf8")))
    expect(r.calls).toEqual([[descriptor().url, BODY.length]])
  })

  it("reads no more than the descriptor's size, and never past the track-set cap", async () => {
    const r = io(BODY)
    await readSpeakerTrackBody(descriptor({ bytes: SPEAKER_TRACKS_MAX_BYTES * 2 }), r.io).catch(() => undefined)
    expect(r.calls[0]![1]).toBe(SPEAKER_TRACKS_MAX_BYTES)
  })

  it("refuses a file that is not in this install's storage", async () => {
    await expect(readSpeakerTrackBody(descriptor(), io(null).io)).rejects.toThrow(/not in this install's storage/)
  })

  it("refuses a body whose size differs from the descriptor's", async () => {
    await expect(readSpeakerTrackBody(descriptor({ bytes: BODY.length + 1 }), io(BODY).io)).rejects.toBeInstanceOf(SpeakerTrackBodyError)
  })

  it("refuses a body whose hash differs from the descriptor's", async () => {
    await expect(readSpeakerTrackBody(descriptor({ sha256: "0".repeat(64) }), io(BODY).io)).rejects.toThrow(/does not match its descriptor/)
  })

  it("refuses a body that is not JSON", async () => {
    const junk = Buffer.from("{not json")
    await expect(readSpeakerTrackBody(descriptor({ sha256: sha(junk), bytes: junk.length }), io(junk).io)).rejects.toThrow(/is not JSON/)
  })
})

describe("speakerViewTracksServerDeps (the job behind the file, this user's only)", () => {
  it("reads the job owner-scoped: by its id AND the run's user", async () => {
    db.row = { input_data: { edl: { sources: [] } }, output_data: { json: descriptor() } }
    const job = await speakerViewTracksServerDeps(USER).loadFramesJob(JOB)
    expect(job).toEqual(db.row)
    expect(db.filters).toEqual([["table", "jobs"], ["id", JOB], ["user_id", USER]])
  })

  it("is null when this user has no such job", async () => {
    expect(await speakerViewTracksServerDeps(USER).loadFramesJob(JOB)).toBeNull()
  })

  it("never queries for a key that is not a job id", async () => {
    expect(await speakerViewTracksServerDeps(USER).loadFramesJob("../../etc")).toBeNull()
    expect(db.filters).toEqual([])
  })

  it("fails the run when the job cannot be read (never treats an outage as 'no job')", async () => {
    db.error = { message: "timeout" }
    await expect(speakerViewTracksServerDeps(USER).loadFramesJob(JOB)).rejects.toThrow(/could not read the Speaker Frames job/)
  })
})

describe("resolveSpeakerViewTracksOfNode (the workflow run's glue)", () => {
  const deps = { loadFramesJob: async () => null, readTrackBody: async () => ({}) }

  it("is undefined with no tracks wire, and never reads an inline data.tracks", async () => {
    expect(await resolveSpeakerViewTracksOfNode({ data: { tracks: descriptor() } }, {}, deps)).toBeUndefined()
  })

  it("marks a wire whose Speaker Frames has no output (null) for the rule to refuse", async () => {
    expect(await resolveSpeakerViewTracksOfNode({ data: {} }, { tracks: null }, deps)).toMatchObject({ unproduced: true })
  })

  it("resolves the wired descriptor with the corrections and the node's transcript fallback", async () => {
    const out = await resolveSpeakerViewTracksOfNode(
      { data: { motion: "static", transcript: { version: 1, words: [], speakerNames: {} } } },
      { tracks: JSON.stringify(descriptor()), trackAssignments: [] },
      deps,
    )
    expect(out).toMatchObject({ motion: "static", provenance: null })
    expect((out!.tracks as SpeakerTrackSetDescriptor).sha256).toBe(descriptor().sha256)
  })
})
