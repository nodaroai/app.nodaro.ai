/**
 * The source and the style of an Add Vocals / Add Instrumental run (decided
 * 2026-11-23): the request's link, else the Suno track's saved audio (any
 * account's); the request's style, else the caller's own original song's
 * (on Add Vocals without its instrumental tag) — its style or tags, else the
 * description of a song made in description mode; refused when none exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SUNO_ADD_TRACK_STYLE_MAX } from "@nodaro/shared/models"

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

  describe("a song made in Create Music's description mode (no style, no tags: the description is its style)", () => {
    const DESCRIPTION = "a breezy indie pop song about cycling through a sunny city, warm male voice"
    // The row as the generate route records it (buildJobInputData of its body:
    // `customMode` defaults to false, no style) — and as a workflow run does.
    const DESCRIBED = (input: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => SONG({
      input_data: { type: "suno-generate", prompt: DESCRIPTION, userPrompt: DESCRIPTION, customMode: false, instrumental: false, model: "V5_5", ...input },
      ...over,
    })

    it("Add Instrumental takes the description as the style", async () => {
      db.rows = [DESCRIBED()]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toEqual({ ok: true, uploadUrl: "https://cdn/a1.wav", style: DESCRIPTION, title: "Fresh Step" })
    })

    it("Add Vocals takes it too", async () => {
      db.rows = [DESCRIBED()]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: true, style: DESCRIPTION })
    })

    it("Add Vocals leaves out the words that ask for no singing, wherever they stand in the sentence", async () => {
      db.rows = [DESCRIBED({ instrumental: true, prompt: "a relaxing instrumental piano piece with no vocals, soft and warm" })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: true, style: "a relaxing piano piece, soft and warm" })
      db.rows = [DESCRIBED({ instrumental: true, prompt: "Instrumental only lo-fi beat without vocals" })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: true, style: "lo-fi beat" })
    })

    it("Add Vocals: a description that only asked for no singing is no style", async () => {
      db.rows = [DESCRIBED({ instrumental: true, prompt: " Instrumental, no vocals " })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-vocals", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
    })

    it("Add Instrumental keeps the description whole, its instrumental words included", async () => {
      const described = "a relaxing instrumental piano piece with no vocals"
      db.rows = [DESCRIBED({ instrumental: true, prompt: described })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: true, style: described })
    })

    it("a row that does not say customMode is description mode (Suno's default)", async () => {
      db.rows = [DESCRIBED({ customMode: undefined })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: true, style: DESCRIPTION })
    })

    it("a non-custom cover's description counts as well", async () => {
      db.rows = [DESCRIBED({ type: "suno-cover" })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: true, style: DESCRIPTION })
    })

    it("the original's style or tags still win over its description", async () => {
      db.rows = [DESCRIBED({ tags: "synthwave" })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: true, style: "synthwave" })
    })

    it("the request's own style still wins over the description", async () => {
      db.rows = [DESCRIBED()]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1", style: "jazz trio" })
      expect(r).toMatchObject({ ok: true, style: "jazz trio" })
    })

    it("lyrics are never taken as a style: a custom-mode song's prompt, or another tool's prompt, is refused", async () => {
      db.rows = [DESCRIBED({ customMode: true, prompt: "[Verse] la la la" })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
      db.rows = [DESCRIBED({ type: "suno-add-vocals", customMode: undefined, prompt: "[Verse] la la la" })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
      db.rows = [DESCRIBED({ type: "suno-extend", customMode: undefined, prompt: "[Verse] la la la" })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
    })

    it("another account's description is never reused", async () => {
      db.rows = [DESCRIBED({}, { user_id: "someone" })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect(r).toMatchObject({ ok: false, status: 400, code: SUNO_ADD_TRACK_STYLE_CODE })
    })

    it("a description longer than the style limit is cut to it (inherited, not typed)", async () => {
      db.rows = [DESCRIBED({ prompt: "x".repeat(SUNO_ADD_TRACK_STYLE_MAX + 50) })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      expect((r as { style: string }).style).toHaveLength(SUNO_ADD_TRACK_STYLE_MAX)
    })

    it("the cut fits a relayed run too: the cloud route counts UTF-16 units, so a character outside the BMP counts twice and is never split", async () => {
      // U+1D11E (musical G clef): one character, two UTF-16 units.
      const clef = "\u{1D11E}"
      db.rows = [DESCRIBED({ prompt: `a${clef.repeat(SUNO_ADD_TRACK_STYLE_MAX)}` })]
      const r = await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" })
      const style = (r as { style: string }).style
      expect(style.length).toBeLessThanOrEqual(SUNO_ADD_TRACK_STYLE_MAX)
      expect(style).toBe(`a${clef.repeat((SUNO_ADD_TRACK_STYLE_MAX - 2) / 2)}`)
      expect(style).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    })

    it("an empty description is no style", async () => {
      db.rows = [DESCRIBED({ prompt: "   " })]
      expect(await resolveSunoAddTrackSource({ jobType: "suno-add-instrumental", userId: ME, taskId: "t", audioId: "a-1" }))
        .toMatchObject({ ok: false, code: SUNO_ADD_TRACK_STYLE_CODE })
    })
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
