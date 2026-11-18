/**
 * The podcast use-case runs' new fields (decided 2026-11-17): the speakers'
 * names a Tighten Episode or Speaker Layout request sends, and the typed
 * `output_data` an app reads back (clip places, speakers).
 */
import { describe, it, expect, vi, expectTypeOf } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type {
  ClipPackClip,
  ClipPackOutputData,
  SpeakerLayoutOutputData,
  TightenEpisodeOutputData,
  UseCaseSpeaker,
} from "../../entries/edit.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
const client = (fetchMock: typeof fetch) => createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)

describe("speakerNames on a request", () => {
  const speakerNames = { speaker_0: "Dana", speaker_1: "Avi" }
  it("Tighten Episode sends them as given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.tightenEpisode({ mediaUrl: "https://r2/a.mp4", speakerNames })
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4"], speakerNames })
  })
  it("Speaker Layout sends them as given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.speakerLayout({ mediaUrl: "https://r2/a.mp4", speakerNames })
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4"], speakerNames })
  })
  it("left out: not sent", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.tightenEpisode({ mediaUrl: "https://r2/a.mp4" })
    expect(bodyOf(fetchMock)).not.toHaveProperty("speakerNames")
  })
})

describe("the typed output_data", () => {
  it("a Clip Pack clip names its place in the recording; every new field is optional", () => {
    const clip: ClipPackClip = { url: "https://r2/c.mp4", quality: "final" }
    const placed: ClipPackClip = { ...clip, sourceStartMs: 372_000, sourceEndMs: 402_000, sourceSpans: [{ inMs: 372_000, outMs: 380_000 }, { inMs: 395_000, outMs: 402_000 }] }
    expectTypeOf(placed.sourceSpans).toEqualTypeOf<ReadonlyArray<{ readonly inMs: number; readonly outMs: number }> | undefined>()
    const out: ClipPackOutputData = { clips: [clip, placed] }
    expect(out.clips?.[1]?.sourceStartMs).toBe(372_000)
  })
  it("a run's speakers", () => {
    expectTypeOf<NonNullable<TightenEpisodeOutputData["speakers"]>[number]>().toEqualTypeOf<UseCaseSpeaker>()
    expectTypeOf<NonNullable<SpeakerLayoutOutputData["speakers"]>[number]>().toEqualTypeOf<UseCaseSpeaker>()
    expectTypeOf<UseCaseSpeaker>().toEqualTypeOf<{ readonly label: string; readonly name?: string; readonly talkMs: number }>()
  })
  it("an output_data from before the fields reads as the type (they are all optional)", () => {
    const old: unknown = { videoUrl: "https://r2/e.mp4", quality: "final" }
    const read = old as TightenEpisodeOutputData
    expect(read.speakers).toBeUndefined()
  })
})
