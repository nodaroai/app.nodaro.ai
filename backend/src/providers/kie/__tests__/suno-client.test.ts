/**
 * KIE Suno API client tests.
 *
 * suno-client.ts is the largest single provider file (~1854 lines) with
 * 14 exported functions wrapping different Suno endpoints:
 *
 * Generation flow (POST + poll):
 *   - sunoGenerate     /api/v1/generate
 *   - sunoCover        /api/v1/generate/upload-cover
 *   - sunoExtend       /api/v1/generate/extend
 *   - sunoMashup       /api/v1/generate/mashup
 *   - sunoReplaceSection /api/v1/generate/replace-section
 *   - sunoAddInstrumental /api/v1/generate/add-instrumental
 *   - sunoAddVocals    /api/v1/generate/add-vocals
 *   - sunoUploadExtend /api/v1/generate/upload-extend
 *   (all poll via /api/v1/generate/record-info)
 *
 * Specialised flows (different poll endpoints):
 *   - sunoLyrics       /api/v1/lyrics + /api/v1/lyrics/record-info
 *   - sunoSeparate     /api/v1/vocal-removal/generate + /api/v1/vocal-removal/record-info
 *   - sunoMusicVideo   /api/v1/mp4/generate + /api/v1/mp4/record-info
 *   - sunoConvertWav   /api/v1/wav/generate + /api/v1/wav/record-info
 *
 * Synchronous (no poll):
 *   - sunoStyleBoost   /api/v1/style/generate
 *
 * Each function shares the same create-task error structure (HTTP / non-
 * JSON / non-zero code / missing taskId) and the create-task body uses
 * different snake_case mappings per endpoint.
 *
 * Tests use vi.useFakeTimers + advanceTimersByTimeAsync to skip the
 * exponential-backoff pollDelay between attempts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    NODE_ENV: "test",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import {
  sunoGenerate, sunoCover, sunoExtend, sunoLyrics, sunoSeparate,
  sunoMusicVideo, sunoMashup, sunoReplaceSection, sunoStyleBoost,
  sunoAddInstrumental, sunoAddVocals, sunoConvertWav, sunoUploadExtend,
} from "../suno-client.js"
import { KIE_API_BASE } from "../client.js"

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function withTimers<T>(fn: () => Promise<T>, advanceMs = 600_000): Promise<T> {
  const promise = fn()
  promise.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return promise
}

/** Build a successful pollSunoTask response with one track. */
function recordInfoSuccess(taskId = "t-1", tracks?: Array<Record<string, unknown>>): Response {
  return jsonResponse({
    code: 200,
    data: {
      taskId,
      status: "SUCCESS",
      response: {
        sunoData: tracks ?? [{
          id: "track-1",
          audio_url: "https://r2/song.mp3",
          title: "Test Song",
          duration: 60,
          image_url: "https://r2/cover.png",
        }],
      },
    },
  })
}

// ===========================================================================
// 1) sunoGenerate — covers create-task shape + pollSunoTask exhaustively
// ===========================================================================

describe("sunoGenerate — create-task body shape", () => {
  it("posts to /api/v1/generate with required fields + default model V5", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoGenerate({ prompt: "a happy song" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toMatchObject({
      prompt: "a happy song",
      model: "V5",
      customMode: false,
      instrumental: false,
      callBackUrl: "https://callback.placeholder",
    })
  })

  it("respects custom model + customMode + instrumental", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoGenerate({
        prompt: "p", model: "V4_5", customMode: true, instrumental: true,
      }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe("V4_5")
    expect(body.customMode).toBe(true)
    expect(body.instrumental).toBe(true)
  })

  it("forwards optional camelCase → snake_case mapped fields", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoGenerate({
        prompt: "p",
        lyrics: "la la la",
        style: "pop",
        title: "Song",
        negativeStyle: "metal",
        vocalGender: "female",
        styleWeight: 0.8,
        weirdnessConstraint: 0.3,
        audioWeight: 0.7,
      }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.lyrics).toBe("la la la")
    expect(body.style).toBe("pop")
    expect(body.title).toBe("Song")
    expect(body.negative_style).toBe("metal")
    expect(body.vocal_gender).toBe("female")
    expect(body.style_weight).toBe(0.8)
    expect(body.weirdness_constraint).toBe(0.3)
    expect(body.audio_weight).toBe(0.7)
  })

  it("preserves styleWeight=0 (uses != null check)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoGenerate({ prompt: "p", styleWeight: 0 }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.style_weight).toBe(0)
  })

  it("includes Bearer auth + Content-Type headers", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoGenerate({ prompt: "p" }))

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["Authorization"]).toBe("Bearer test-kie-key")
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  it("returns SunoTaskResult with taskId + tracks on poll success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "abc" } }))
      .mockResolvedValueOnce(recordInfoSuccess("abc"))

    const result = await withTimers(() => sunoGenerate({ prompt: "p" }))

    expect(result.taskId).toBe("abc")
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0].audioUrl).toBe("https://r2/song.mp3")
  })
})

describe("sunoGenerate — create-task error paths", () => {
  it("throws when KIE_API_KEY is missing", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_API_KEY: undefined, NODE_ENV: "test", EDITION: "cloud" },
      hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
      isBusiness: () => false, hasAdmin: () => true,
    }))
    const mod = await import("../suno-client.js")
    await expect(mod.sunoGenerate({ prompt: "p" }))
      .rejects.toThrow(/Service is not properly configured/)
    vi.doUnmock("@/lib/config.js")
  })

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("502", 502))
    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("throws on non-JSON response", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("<html>"))
    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("throws on non-zero/non-200 code", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 999, msg: "internal" }))
    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("throws when create response is missing taskId", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("accepts code: 0 and code: 200 alike", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { taskId: "t-200" } }))
      .mockResolvedValueOnce(recordInfoSuccess("t-200"))
    const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
    expect(r.taskId).toBe("t-200")
  })
})

describe("sunoGenerate — pollSunoTask behaviour (via sunoGenerate)", () => {
  it("FIRST_SUCCESS continues polling until SUCCESS", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { taskId: "t", status: "FIRST_SUCCESS" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoGenerate({ prompt: "p" }))

    // 1 create + 2 polls
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("PENDING/PROCESSING continues polling until SUCCESS", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { taskId: "t", status: "PENDING" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { taskId: "t", status: "PROCESSING" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoGenerate({ prompt: "p" }))

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("FAILED status throws with failReason", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "FAILED", failReason: "internal" },
      }))

    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("status containing 'FAILED' or 'ERROR' substring also throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "GENERATE_AUDIO_FAILED" },
      }))

    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("HTTP error during poll → continue polling", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(textResponse("502", 502))
      .mockResolvedValueOnce(recordInfoSuccess())

    const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
    expect(r.tracks).toHaveLength(1)
  })

  it("invalid JSON during poll → continue polling", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(textResponse("<html>"))
      .mockResolvedValueOnce(recordInfoSuccess())

    const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
    expect(r.tracks).toHaveLength(1)
  })

  it("SUCCESS with empty sunoData throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "SUCCESS", response: { sunoData: [] } },
      }))

    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("SUCCESS with tracks lacking audio URL throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t",
          status: "SUCCESS",
          response: { sunoData: [{ id: "x", title: "no url" }] },
        },
      }))

    await expect(withTimers(() => sunoGenerate({ prompt: "p" })))
      .rejects.toThrow(/Music generation/)
  })

  it("track URL fallback: audio_url > audioUrl > song_url > songUrl > url", async () => {
    // Provide each fallback in turn and verify it's picked.
    for (const key of ["audio_url", "audioUrl", "song_url", "songUrl", "url"] as const) {
      fetchMock.mockReset()
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
        .mockResolvedValueOnce(jsonResponse({
          code: 200,
          data: {
            taskId: "t", status: "SUCCESS",
            response: { sunoData: [{ id: "x", [key]: `https://r2/${key}.mp3` }] },
          },
        }))

      const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
      expect(r.tracks[0].audioUrl).toBe(`https://r2/${key}.mp3`)
    }
  })

  it("filters out tracks without audio URL but keeps valid ones", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t", status: "SUCCESS",
          response: {
            sunoData: [
              { id: "x", audio_url: "https://r2/ok.mp3" },
              { id: "y" }, // no URL — filtered
            ],
          },
        },
      }))

    const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
    expect(r.tracks).toHaveLength(1)
    expect(r.tracks[0].id).toBe("x")
  })

  it("metadata fallback: title from song_name, duration from song_duration, image from cover_url", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t", status: "SUCCESS",
          response: {
            sunoData: [{
              id: "x", audio_url: "u",
              song_name: "from-snake", song_duration: 90, cover_url: "https://r2/c.png",
            }],
          },
        },
      }))

    const r = await withTimers(() => sunoGenerate({ prompt: "p" }))
    expect(r.tracks[0].title).toBe("from-snake")
    expect(r.tracks[0].duration).toBe(90)
    expect(r.tracks[0].imageUrl).toBe("https://r2/c.png")
  })
})

// ===========================================================================
// 2) sunoCover — endpoint + body shape
// ===========================================================================

describe("sunoCover", () => {
  it("posts to /api/v1/generate/upload-cover with upload_url + prompt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoCover({ prompt: "p", uploadUrl: "https://src.mp3" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/upload-cover`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.upload_url).toBe("https://src.mp3")
    expect(body.prompt).toBe("p")
  })

  it("default model V5 + customMode false + instrumental false", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoCover({ prompt: "p", uploadUrl: "u" }))

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe("V5")
    expect(body.customMode).toBe(false)
    expect(body.instrumental).toBe(false)
  })

  it("forwards lyrics + style + title + negativeStyle + vocalGender", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoCover({
        prompt: "p", uploadUrl: "u",
        lyrics: "L", style: "S", title: "T",
        negativeStyle: "N", vocalGender: "male",
      }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.lyrics).toBe("L")
    expect(body.negative_style).toBe("N")
    expect(body.vocal_gender).toBe("male")
  })
})

// ===========================================================================
// 3) sunoExtend — endpoint + camelCase preservation
// ===========================================================================

describe("sunoExtend", () => {
  it("posts to /api/v1/generate/extend with audioId + default flag", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoExtend({ audioId: "a-1" }))

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/extend`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.audioId).toBe("a-1")
    expect(body.defaultParamFlag).toBe(true) // default
  })

  it("respects defaultParamFlag: false", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoExtend({ audioId: "a", defaultParamFlag: false }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.defaultParamFlag).toBe(false)
  })

  it("uses negativeTags (NOT negative_style) for extend", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoExtend({ audioId: "a", negativeStyle: "metal" }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    // sunoExtend uses negativeTags as the field name (different from sunoGenerate)
    expect(body.negativeTags).toBe("metal")
    expect(body.negative_style).toBeUndefined()
  })

  it("forwards continueAt as camelCase (NOT continue_at)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() => sunoExtend({ audioId: "a", continueAt: 30 }))

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.continueAt).toBe(30)
  })
})

// ===========================================================================
// 4) sunoLyrics — separate poll endpoint + result shape
// ===========================================================================

describe("sunoLyrics", () => {
  it("posts to /api/v1/lyrics + polls /api/v1/lyrics/record-info", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t-lyr" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t-lyr", status: "SUCCESS",
          response: {
            data: [{ text: "verse 1", title: "Sunset" }],
          },
        },
      }))

    const result = await withTimers(() => sunoLyrics({ prompt: "p" }))

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/lyrics`)
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/lyrics/record-info?taskId=t-lyr`,
    )
    expect(result.taskId).toBe("t-lyr")
    expect(result.lyrics).toEqual([{ text: "verse 1", title: "Sunset" }])
  })

  it("FIRST_SUCCESS treated as terminal for lyrics (returns)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t", status: "FIRST_SUCCESS",
          response: { data: [{ text: "v", title: "T" }] },
        },
      }))

    const result = await withTimers(() => sunoLyrics({ prompt: "p" }))
    expect(result.lyrics).toHaveLength(1)
  })

  it("FAILED throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "FAILED", failReason: "bad prompt" },
      }))

    await expect(withTimers(() => sunoLyrics({ prompt: "p" })))
      .rejects.toThrow(/Lyrics generation/)
  })

  it("SUCCESS with empty data array throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "SUCCESS", response: { data: [] } },
      }))

    await expect(withTimers(() => sunoLyrics({ prompt: "p" })))
      .rejects.toThrow(/Lyrics generation/)
  })

  it("defaults missing text/title to empty strings", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t", status: "SUCCESS",
          response: { data: [{}] }, // missing text + title
        },
      }))

    const result = await withTimers(() => sunoLyrics({ prompt: "p" }))
    expect(result.lyrics[0]).toEqual({ text: "", title: "" })
  })
})

// ===========================================================================
// 5) sunoSeparate — stem-name → result-key mapping
// ===========================================================================

describe("sunoSeparate", () => {
  it("posts to /api/v1/vocal-removal/generate with type", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t-sep" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t-sep",
          response: {
            originData: [
              { stem_type_group_name: "vocals", audio_url: "https://r2/v.mp3" },
              { stem_type_group_name: "instrumental", audio_url: "https://r2/i.mp3" },
            ],
          },
        },
      }))

    const result = await withTimers(() =>
      sunoSeparate({ taskId: "src", audioId: "a", type: "separate_vocal" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/vocal-removal/generate`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.type).toBe("separate_vocal")
    expect(body.taskId).toBe("src")
    expect(body.audioId).toBe("a")

    expect(result.vocalUrl).toBe("https://r2/v.mp3")
    expect(result.instrumentalUrl).toBe("https://r2/i.mp3")
  })

  it("maps all 14 stem types to their result keys", async () => {
    const stems = [
      ["vocals", "vocalUrl"],
      ["instrumental", "instrumentalUrl"],
      ["backing vocals", "backingVocalsUrl"],
      ["drums", "drumsUrl"],
      ["bass", "bassUrl"],
      ["guitar", "guitarUrl"],
      ["piano", "pianoUrl"],
      ["keyboard", "keyboardUrl"],
      ["percussion", "percussionUrl"],
      ["strings", "stringsUrl"],
      ["synth", "synthUrl"],
      ["fx", "fxUrl"],
      ["brass", "brassUrl"],
      ["woodwinds", "woodwindsUrl"],
    ] as const

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t",
          response: {
            originData: stems.map(([name]) => ({
              stem_type_group_name: name,
              audio_url: `https://r2/${name.replace(" ", "-")}.mp3`,
            })),
          },
        },
      }))

    const result = await withTimers(() =>
      sunoSeparate({ taskId: "src", audioId: "a", type: "split_stem" }),
    ) as unknown as Record<string, string | undefined>

    for (const [stem, key] of stems) {
      expect(result[key], `expected ${key} for stem '${stem}'`).toBe(
        `https://r2/${stem.replace(" ", "-")}.mp3`,
      )
    }
  })

  it("uppercases stem names matched case-insensitively", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t",
          response: {
            originData: [
              { stem_type_group_name: "VOCALS", audio_url: "https://r2/v.mp3" },
            ],
          },
        },
      }))

    const result = await withTimers(() =>
      sunoSeparate({ taskId: "src", audioId: "a", type: "separate_vocal" }),
    )

    expect(result.vocalUrl).toBe("https://r2/v.mp3")
  })

  it("ignores unknown stem types", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t",
          response: {
            originData: [
              { stem_type_group_name: "vocals", audio_url: "https://r2/v.mp3" },
              { stem_type_group_name: "saxophone", audio_url: "https://r2/sax.mp3" },
            ],
          },
        },
      }))

    const result = await withTimers(() =>
      sunoSeparate({ taskId: "src", audioId: "a", type: "split_stem" }),
    ) as unknown as Record<string, string | undefined>

    expect(result.vocalUrl).toBe("https://r2/v.mp3")
    // saxophone has no result key — silently dropped
    expect(Object.values(result).filter((v) => v === "https://r2/sax.mp3")).toHaveLength(0)
  })

  it("FAILED status throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "FAILED", failReason: "bad audio" },
      }))

    await expect(
      withTimers(() => sunoSeparate({ taskId: "src", audioId: "a", type: "separate_vocal" })),
    ).rejects.toThrow(/Stem separation/)
  })
})

// ===========================================================================
// 6) sunoMusicVideo — multi-key URL extraction
// ===========================================================================

describe("sunoMusicVideo", () => {
  it("posts to /api/v1/mp4/generate with taskId + audioId", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t-mv" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t-mv", response: { videoUrl: "https://r2/v.mp4" } },
      }))

    const result = await withTimers(() =>
      sunoMusicVideo({ taskId: "src", audioId: "a" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/mp4/generate`)
    expect(result.videoUrl).toBe("https://r2/v.mp4")
  })

  it.each([
    ["videoUrl", "https://r2/v.mp4"],
    ["video_url", "https://r2/v.mp4"],
    ["mp4Url", "https://r2/v.mp4"],
    ["mp4_url", "https://r2/v.mp4"],
  ] as const)("URL extracted from response.%s", async (key, url) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", response: { [key]: url } },
      }))

    const result = await withTimers(() =>
      sunoMusicVideo({ taskId: "src", audioId: "a" }),
    )
    expect(result.videoUrl).toBe(url)
  })

  it("scans response values for *.mp4 when SUCCESS but no known URL key matches", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t",
          status: "SUCCESS",
          response: { someOddField: "https://r2/scan-found.mp4" },
        },
      }))

    const result = await withTimers(() =>
      sunoMusicVideo({ taskId: "src", audioId: "a" }),
    )
    expect(result.videoUrl).toBe("https://r2/scan-found.mp4")
  })

  it("FAILED throws", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "FAILED", failReason: "render error" },
      }))

    await expect(
      withTimers(() => sunoMusicVideo({ taskId: "src", audioId: "a" })),
    ).rejects.toThrow(/Music video generation/)
  })
})

// ===========================================================================
// 7) sunoMashup
// ===========================================================================

describe("sunoMashup", () => {
  it("posts to /api/v1/generate/mashup with upload_url_list", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoMashup({ uploadUrlList: ["https://a.mp3", "https://b.mp3"] }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/mashup`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.upload_url_list).toEqual(["https://a.mp3", "https://b.mp3"])
    expect(body.model).toBe("V5") // default
  })
})

// ===========================================================================
// 8) sunoReplaceSection
// ===========================================================================

describe("sunoReplaceSection", () => {
  it("posts to /api/v1/generate/replace-section with snake_case infill bounds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoReplaceSection({
        taskId: "src", audioId: "a",
        infillStartS: 30, infillEndS: 60,
        prompt: "p", tags: "rock",
      }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/replace-section`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.infill_start_s).toBe(30)
    expect(body.infill_end_s).toBe(60)
    expect(body.tags).toBe("rock")
  })

  it("preserves infillStartS=0 (truthy/falsy bug-prone)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoReplaceSection({
        taskId: "src", audioId: "a",
        infillStartS: 0, infillEndS: 6,
        prompt: "p", tags: "t",
      }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.infill_start_s).toBe(0)
  })
})

// ===========================================================================
// 9) sunoStyleBoost — synchronous (no poll)
// ===========================================================================

describe("sunoStyleBoost", () => {
  it("posts to /api/v1/style/generate and returns text immediately (no poll)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 200,
      data: { text: "enhanced epic orchestral with strings" },
    }))

    const result = await withTimers(() => sunoStyleBoost({ content: "epic" }))

    expect(fetchMock).toHaveBeenCalledTimes(1) // no poll
    expect(result.text).toBe("enhanced epic orchestral with strings")
  })

  it("accepts data as a bare string", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 200,
      data: "raw string output",
    }))

    const result = await withTimers(() => sunoStyleBoost({ content: "x" }))
    expect(result.text).toBe("raw string output")
  })

  it("falls back to data.style when data.text missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 200,
      data: { style: "from-style-key" },
    }))

    const result = await withTimers(() => sunoStyleBoost({ content: "x" }))
    expect(result.text).toBe("from-style-key")
  })

  it("falls back to data.content when text+style missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 200,
      data: { content: "from-content-key" },
    }))

    const result = await withTimers(() => sunoStyleBoost({ content: "x" }))
    expect(result.text).toBe("from-content-key")
  })

  it("throws on non-zero/non-200 code", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 999, msg: "bad" }))
    await expect(withTimers(() => sunoStyleBoost({ content: "x" })))
      .rejects.toThrow(/Style boost/)
  })

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("502", 502))
    await expect(withTimers(() => sunoStyleBoost({ content: "x" })))
      .rejects.toThrow(/Style boost/)
  })
})

// ===========================================================================
// 10) sunoAddInstrumental + sunoAddVocals
// ===========================================================================

describe("sunoAddInstrumental", () => {
  it("posts to /api/v1/generate/add-instrumental with default model V5", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoAddInstrumental({ taskId: "src", audioId: "a" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/add-instrumental`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.taskId).toBe("src")
    expect(body.model).toBe("V5")
  })

  it("respects V4_5PLUS model override", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoAddInstrumental({ taskId: "src", audioId: "a", model: "V4_5PLUS" }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe("V4_5PLUS")
  })
})

describe("sunoAddVocals", () => {
  it("posts to /api/v1/generate/add-vocals with default model V5", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoAddVocals({ taskId: "src", audioId: "a" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/add-vocals`)
  })
})

// ===========================================================================
// 11) sunoConvertWav — separate poll endpoint
// ===========================================================================

describe("sunoConvertWav", () => {
  it("posts to /api/v1/wav/generate + polls /api/v1/wav/record-info", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t-wav" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: {
          taskId: "t-wav",
          response: { audioUrl: "https://r2/song.wav" },
        },
      }))

    const result = await withTimers(() =>
      sunoConvertWav({ taskId: "src", audioId: "a" }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/wav/generate`)
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/wav/record-info?taskId=t-wav`,
    )
    expect(result.audioUrl).toBe("https://r2/song.wav")
  })

  it.each([
    ["audioUrl", "https://r2/x.wav"],
    ["audio_url", "https://r2/x.wav"],
    ["wavUrl", "https://r2/x.wav"],
    ["wav_url", "https://r2/x.wav"],
  ] as const)("WAV URL fallback chain: response.%s", async (key, url) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", response: { [key]: url } },
      }))

    const result = await withTimers(() =>
      sunoConvertWav({ taskId: "src", audioId: "a" }),
    )
    expect(result.audioUrl).toBe(url)
  })

  it("FAILED throws with WAV-specific context", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { taskId: "t", status: "FAILED", failReason: "encoding error" },
      }))

    await expect(
      withTimers(() => sunoConvertWav({ taskId: "src", audioId: "a" })),
    ).rejects.toThrow(/WAV/)
  })
})

// ===========================================================================
// 12) sunoUploadExtend
// ===========================================================================

describe("sunoUploadExtend", () => {
  it("posts to /api/v1/generate/upload-extend with upload_url + continueAt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoUploadExtend({ uploadUrl: "https://src.mp3", continueAt: 45 }),
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/generate/upload-extend`)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.upload_url).toBe("https://src.mp3")
    expect(body.continueAt).toBe(45)
    expect(body.defaultParamFlag).toBe(false) // default for upload-extend (different from sunoExtend!)
  })

  it("respects defaultParamFlag override", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(recordInfoSuccess())

    await withTimers(() =>
      sunoUploadExtend({
        uploadUrl: "u", continueAt: 0, defaultParamFlag: true,
      }),
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.defaultParamFlag).toBe(true)
  })
})

// ===========================================================================
// 13) Cross-cutting: parametrized create-task error tests
// ===========================================================================

describe("create-task error parity (all generation functions)", () => {
  type Caller = () => Promise<unknown>
  const callers: Array<[string, Caller]> = [
    ["sunoGenerate",       () => sunoGenerate({ prompt: "p" })],
    ["sunoCover",          () => sunoCover({ prompt: "p", uploadUrl: "u" })],
    ["sunoExtend",         () => sunoExtend({ audioId: "a" })],
    ["sunoLyrics",         () => sunoLyrics({ prompt: "p" })],
    ["sunoSeparate",       () => sunoSeparate({ taskId: "t", audioId: "a", type: "separate_vocal" })],
    ["sunoMusicVideo",     () => sunoMusicVideo({ taskId: "t", audioId: "a" })],
    ["sunoMashup",         () => sunoMashup({ uploadUrlList: ["a", "b"] })],
    ["sunoReplaceSection", () => sunoReplaceSection({ taskId: "t", audioId: "a", infillStartS: 1, infillEndS: 6, prompt: "p", tags: "t" })],
    ["sunoAddInstrumental",() => sunoAddInstrumental({ taskId: "t", audioId: "a" })],
    ["sunoAddVocals",      () => sunoAddVocals({ taskId: "t", audioId: "a" })],
    ["sunoConvertWav",     () => sunoConvertWav({ taskId: "t", audioId: "a" })],
    ["sunoUploadExtend",   () => sunoUploadExtend({ uploadUrl: "u", continueAt: 0 })],
  ]

  it.each(callers)("%s throws on HTTP 500 from create-task", async (_label, fn) => {
    fetchMock.mockResolvedValueOnce(textResponse("server error", 500))
    await expect(withTimers(fn)).rejects.toThrow()
  })

  it.each(callers)("%s throws when create response missing taskId", async (_label, fn) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
    await expect(withTimers(fn)).rejects.toThrow()
  })

  it.each(callers)("%s throws on non-zero/non-200 code", async (_label, fn) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 999, msg: "bad" }))
    await expect(withTimers(fn)).rejects.toThrow()
  })

  it.each(callers)("%s sends Bearer KIE_API_KEY auth header", async (_label, fn) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      // Generic terminal-success that matches every poll variant. Successive
      // tests don't rely on poll output beyond "doesn't loop forever".
      .mockResolvedValue(jsonResponse({
        code: 200,
        data: {
          taskId: "t", status: "SUCCESS",
          response: {
            sunoData: [{ id: "x", audio_url: "u" }],
            data: [{ text: "x", title: "y" }],
            originData: [{ stem_type_group_name: "vocals", audio_url: "u" }],
            videoUrl: "u",
            audioUrl: "u",
          },
        },
      }))

    try { await withTimers(fn) } catch { /* style-boost path is sync — ignore */ }

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["Authorization"]).toBe("Bearer test-kie-key")
    expect(init.headers["Content-Type"]).toBe("application/json")
  })
})
