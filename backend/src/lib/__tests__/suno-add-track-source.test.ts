/**
 * The source and the style of an Add Vocals / Add Instrumental run (decided
 * 2026-11-23): the request's link, else the Suno track's saved audio (any
 * account's); the request's style, else the caller's own original song's
 * (on Add Vocals without its instrumental tag); refused when neither exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, error: null as null | { message: string }, lookups: 0 }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const q = { eq: () => q, limit: async () => { db.lookups++; return { data: db.rows, error: db.error } } }
        return q
      },
    }),
  },
}))

import {
  SUNO_ADD_TRACK_SOURCE_CODE,
  SUNO_ADD_TRACK_STYLE_CODE,
  inheritedSunoStyle,
  resolveSunoAddTrackSource,
} from "../suno-add-track-source.js"

const ME = "user-me"
const SONG = (over: Record<string, unknown> = {}) => ({
  user_id: ME, status: "completed",
  input_data: { style: "uk garage, 2-step, instrumental", title: "Input Title" },
  output_data: { sunoTitle: "Fresh Step", sunoTrackId: "a-1", audioUrl: "https://cdn/a1.wav", sunoTracks: [
    { id: "a-1", audioUrl: "https://cdn/a1.wav", title: "Fresh Step" },
    { id: "a-2", audioUrl: "https://cdn/a2.wav", title: "Fresh Step v2" },
  ] },
  ...over,
})

beforeEach(() => {
  db.rows = []
  db.error = null
  db.lookups = 0
})

describe("resolveSunoAddTrackSource", () => {
  it("ids alone: the named track's saved audio, my original style without the instrumental tag (Add Vocals), its title", async () => {
    db.rows = [SONG()]
    const r = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-2" })
    expect(r).toEqual({ ok: true, uploadUrl: "https://cdn/a2.wav", style: "uk garage, 2-step", title: "Fresh Step v2" })
  })

  it("Add Instrumental keeps the original style whole", async () => {
    db.rows = [SONG()]
    const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
    expect(r).toMatchObject({ ok: true, style: "uk garage, 2-step, instrumental" })
  })

  it("the request's own link, style and title win, and nothing is looked up", async () => {
    const r = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, uploadUrl: "https://x/beat.mp3", taskId: "t", audioId: "a-1", style: "soul", title: "Mine" })
    expect(r).toEqual({ ok: true, uploadUrl: "https://x/beat.mp3", style: "soul", title: "Mine" })
    expect(db.lookups).toBe(0)
  })

  it("another account's song: its audio is used, its style and title are not", async () => {
    db.rows = [SONG({ user_id: "someone" })]
    const refused = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" })
    expect(refused).toMatchObject({ ok: false, status: 400, code: SUNO_ADD_TRACK_STYLE_CODE })
    const ok = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1", style: "gospel" })
    expect(ok).toEqual({ ok: true, uploadUrl: "https://cdn/a1.wav", style: "gospel" })
  })

  it("a link with no style and no Suno song: refused, asking for a style", async () => {
    const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, uploadUrl: "https://x/vocal.mp3" })
    expect(r).toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
  })

  it("no source at all, or a track with no saved audio: refused, naming the source", async () => {
    expect(await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, style: "pop" })).toMatchObject({ ok: false, code: SUNO_ADD_TRACK_SOURCE_CODE })
    db.rows = [SONG({ output_data: {} })]
    expect(await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1", style: "pop" })).toMatchObject({ ok: false, code: SUNO_ADD_TRACK_SOURCE_CODE })
  })

  it("a finished row is read before a failed one; the primary track counts when no track list was kept", async () => {
    db.rows = [
      { user_id: ME, status: "failed", input_data: { style: "wrong" }, output_data: null },
      { user_id: ME, status: "completed", input_data: { tags: "piano" }, output_data: { sunoTrackId: "a-1", audioUrl: "https://cdn/p.wav", sunoTitle: "P" } },
    ]
    const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
    expect(r).toEqual({ ok: true, uploadUrl: "https://cdn/p.wav", style: "piano", title: "P" })
  })

  it("a failed lookup is thrown, never read as 'no song'", async () => {
    db.error = { message: "down" }
    await expect(resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" })).rejects.toThrow(/lookup failed/)
  })
})

describe("inheritedSunoStyle", () => {
  it("drops an instrumental / no-vocals tag on Add Vocals only; nothing left is no style", () => {
    expect(inheritedSunoStyle("lofi, Instrumental, chill", "suno-add-vocals")).toBe("lofi, chill")
    expect(inheritedSunoStyle("no vocals", "suno-add-vocals")).toBeUndefined()
    expect(inheritedSunoStyle("lofi, instrumental", "suno-add-instrumental")).toBe("lofi, instrumental")
    expect(inheritedSunoStyle("  ", "suno-add-vocals")).toBeUndefined()
  })
})
