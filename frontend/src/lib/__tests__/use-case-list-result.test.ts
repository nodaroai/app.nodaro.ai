import { describe, it, expect } from "vitest"
import { usecaseFailedDeliveriesField, usecaseListFields, usecaseListRowFields, usecaseListRows } from "@/lib/use-case-list-result"
import { usecaseRunResultFields, usecaseTakeFields, usecaseTakeMedium } from "@/lib/use-case-run-result"

const out = { formats: [{ format: "9:16", url: "https://r2/a.mp4" }, { format: "1:1", url: "https://r2/b.mp4" }], videoUrl: "https://r2/a.mp4", quality: "final", useCaseSettings: { formats: ["9:16", "1:1"] } }

describe("a Trailer's deliveries land as rows of one run", () => {
  it("one row per delivery, each naming the run (its wrapper) and its quality", () => {
    expect(usecaseListRows("episode-trailer", out, "00000000-0000-4000-8000-000000000007", "2026-10-14T10:00:00Z")).toEqual([
      expect.objectContaining({ url: "https://r2/a.mp4", jobId: "00000000-0000-4000-8000-000000000007", quality: "final", useCaseSettings: { formats: ["9:16", "1:1"] }, timestamp: "2026-10-14T10:00:00Z" }),
      expect.objectContaining({ url: "https://r2/b.mp4", jobId: "00000000-0000-4000-8000-000000000007", quality: "final" }),
    ])
  })
  it("each row is named by its format", () => {
    expect(usecaseListRows("episode-trailer", out, "j", "t").map((r) => r.format)).toEqual(["9:16", "1:1"])
  })
  it("the node's list, its stamps, the first delivery on show", () => {
    expect(usecaseListFields("episode-trailer", out)).toEqual({
      __listResults: ["https://r2/a.mp4", "https://r2/b.mp4"],
      __listResultStamps: [{ quality: "final" }, { quality: "final" }],
      generatedVideoUrl: "https://r2/a.mp4",
      activeResultIndex: 0,
    })
  })
  it("each row's stamp is the one every lane writes: quality, the run's bases and the wrapper", () => {
    const run = { ...out, planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210" }
    const stamp = { quality: "final", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210", jobId: "job-7" }
    expect(usecaseListFields("episode-trailer", run, "job-7").__listResultStamps).toEqual([stamp, stamp])
  })
  it("every row of a run that failed a format names it (the node shows it under that run's takes)", () => {
    expect(usecaseTakeFields("episode-trailer", { ...out, failedFormats: ["4:5"] }, "https://r2/b.mp4")).toMatchObject({ format: "1:1", failedFormats: ["4:5"] })
  })
  it("a review run's preview is one row, and no list", () => {
    const preview = { formats: [], videoUrl: "https://r2/p.mp4", quality: "proxy" }
    expect(usecaseListRows("episode-trailer", preview, "00000000-0000-4000-8000-000000000008", "t")).toEqual([expect.objectContaining({ url: "https://r2/p.mp4", quality: "proxy" })])
    expect(usecaseListFields("episode-trailer", preview)).toEqual({ __listResults: undefined, __listResultStamps: undefined, generatedVideoUrl: "https://r2/p.mp4", activeResultIndex: 0 })
  })
  it("any other node type: nothing", () => {
    expect(usecaseListRows("tighten-episode", out, "j", "t")).toEqual([])
    expect(usecaseListFields("tighten-episode", out)).toEqual({})
    expect(usecaseFailedDeliveriesField("tighten-episode", { ...out, failedFormats: ["4:5"] })).toEqual({})
  })
})

describe("a server lane merges each row's delivery by its file", () => {
  it("the row whose file is the URL gets its format; a file the run did not deliver gets nothing", () => {
    expect(usecaseListRowFields("episode-trailer", out, "https://r2/b.mp4")).toEqual({ format: "1:1" })
    expect(usecaseListRowFields("episode-trailer", out, "https://r2/other.mp4")).toBeUndefined()
    expect(usecaseListRowFields("tighten-episode", out, "https://r2/b.mp4")).toBeUndefined()
  })
  it("every delivery is a take of the run: each keeps the run's plan, transcript and settings, with its format (what every lane spreads on its take)", () => {
    const run = { ...out, json: { version: 1, segments: [] }, transcript: { version: 1, words: [] } }
    expect(usecaseTakeFields("episode-trailer", run, "https://r2/b.mp4")).toEqual({
      generatedJson: run.json,
      generatedTranscript: run.transcript,
      useCaseSettings: { formats: ["9:16", "1:1"] },
      format: "1:1",
    })
    // Tighten keeps its one rule: only the episode the output reports.
    expect(usecaseTakeFields("tighten-episode", run, "https://r2/b.mp4")).toBeUndefined()
  })
})

describe("the formats a run could not render", () => {
  it("named on a run that delivered; cleared on a clean run and on a failed one (its failure says what failed)", () => {
    expect(usecaseFailedDeliveriesField("episode-trailer", { ...out, failedFormats: ["4:5"] })).toEqual({ failedFormats: ["4:5"] })
    expect(usecaseFailedDeliveriesField("episode-trailer", out)).toEqual({ failedFormats: undefined })
    expect(usecaseFailedDeliveriesField("episode-trailer", { failedFormats: ["9:16", "1:1"] })).toEqual({ failedFormats: undefined })
  })
})

describe("every lane lands the list through the one run-result mapping", () => {
  it("a delivered run: the first delivery as the episode, the list and stamps, the formats that failed — never the active pick (the lane puts its take on show)", () => {
    const fields = usecaseRunResultFields("episode-trailer", { ...out, failedFormats: ["4:5"] }, {}, "job-7")!
    expect(fields).toMatchObject({
      generatedVideoUrl: "https://r2/a.mp4",
      __listResults: ["https://r2/a.mp4", "https://r2/b.mp4"],
      __listResultStamps: [{ quality: "final" }, { quality: "final" }],
      failedFormats: ["4:5"],
      useCaseJobId: "job-7",
    })
    expect("activeResultIndex" in fields).toBe(false)
  })
  it("a run that delivered nothing never clears the list an earlier run left", () => {
    const fields = usecaseRunResultFields("episode-trailer", { failedFormats: ["9:16"] }, {}, "job-8")!
    expect("__listResults" in fields).toBe(false)
    expect("generatedVideoUrl" in fields).toBe(false)
    expect(fields.failedFormats).toBeUndefined()
  })
})

describe("a Clip Pack's clips land as rows of one run", () => {
  const clips = {
    videoUrl: "https://r2/c0.mp4",
    clips: [
      { url: "https://r2/c0.mp4", quality: "final", clipKey: "k0", title: "The pivot", hook: "Why we changed course", planBasis: "p0", renderBasis: "r0" },
      { url: "https://r2/c1.mp4", quality: "final", clipKey: "k1", title: "The money", planBasis: "p1", renderBasis: "r1", captionsFailed: true },
    ],
    failedClips: 1,
    failedCaptions: 1,
    quality: "final",
    json: [{ version: 1 }, { version: 1 }],
    useCaseSettings: { count: 3 },
  }

  it("one row per clip, each with its clip key, title and hook, its own stamps, and whether its captions failed", () => {
    const rows = usecaseListRows("clip-pack", clips, "job-c", "t")
    expect(rows.map((r) => [r.url, r.clipKey, r.title, r.planBasis, r.renderBasis, r.quality, r.jobId])).toEqual([
      ["https://r2/c0.mp4", "k0", "The pivot", "p0", "r0", "final", "job-c"],
      ["https://r2/c1.mp4", "k1", "The money", "p1", "r1", "final", "job-c"],
    ])
    expect(rows[0]!.hook).toBe("Why we changed course")
    expect(rows[0]!.captionsFailed).toBeUndefined()
    expect(rows[1]!.captionsFailed).toBe(true)
  })

  it("writes each clip's key in the node's row stamps, with its own bases and the wrapper", () => {
    expect(usecaseListFields("clip-pack", clips, "job-c")).toEqual({
      __listResults: ["https://r2/c0.mp4", "https://r2/c1.mp4"],
      __listResultStamps: [
        { quality: "final", clipKey: "k0", planBasis: "p0", renderBasis: "r0", jobId: "job-c" },
        { quality: "final", clipKey: "k1", planBasis: "p1", renderBasis: "r1", jobId: "job-c" },
      ],
      generatedVideoUrl: "https://r2/c0.mp4",
      activeResultIndex: 0,
    })
  })

  it("a row's own take quality wins over the run's", () => {
    const mixed = { ...clips, quality: "final", clips: [{ ...clips.clips[0]!, quality: "proxy" }] }
    expect(usecaseListRows("clip-pack", mixed, "j", "t")[0]!.quality).toBe("proxy")
    expect((usecaseListFields("clip-pack", mixed).__listResultStamps as Array<Record<string, unknown>>)[0]!.quality).toBe("proxy")
  })

  it("every clip of a run that could not render one says how many — and the uncaptioned clip keeps its mark (what every lane spreads)", () => {
    expect(usecaseTakeFields("clip-pack", clips, "https://r2/c1.mp4")).toMatchObject({ clipKey: "k1", title: "The money", captionsFailed: true, failedClips: 1, generatedJson: clips.json })
    expect(usecaseTakeFields("clip-pack", clips, "https://r2/c0.mp4")).toMatchObject({ clipKey: "k0", failedClips: 1 })
    expect(usecaseTakeFields("clip-pack", clips, "https://r2/c0.mp4")!.captionsFailed).toBeUndefined()
    expect(usecaseListRowFields("clip-pack", clips, "https://r2/c1.mp4")).toEqual({ quality: "final", clipKey: "k1", title: "The money", planBasis: "p1", renderBasis: "r1", captionsFailed: true })
  })

  it("on the node: how many clips the run could not render, only on a run that delivered — and never a format field", () => {
    expect(usecaseFailedDeliveriesField("clip-pack", clips)).toEqual({ failedClips: 1 })
    expect(usecaseFailedDeliveriesField("clip-pack", { ...clips, failedClips: undefined })).toEqual({ failedClips: undefined })
    expect(usecaseFailedDeliveriesField("clip-pack", { failedClips: 3 })).toEqual({ failedClips: undefined })
    expect("failedFormats" in usecaseFailedDeliveriesField("clip-pack", clips)).toBe(false)
    expect("failedClips" in usecaseFailedDeliveriesField("episode-trailer", { ...out, failedClips: 2 })).toBe(false)
  })

  it("an audio recording's clips land as the node's audio, never its video", () => {
    const audio = { audioUrl: "https://r2/c0.m4a", clips: [{ url: "https://r2/c0.m4a", quality: "final", clipKey: "k0" }], quality: "final" }
    const list = usecaseListFields("clip-pack", audio)
    expect(list.generatedAudioUrl).toBe("https://r2/c0.m4a")
    expect("generatedVideoUrl" in list && list.generatedVideoUrl === undefined).toBe(true)
    const fields = usecaseRunResultFields("clip-pack", audio, {}, "job-a")!
    expect(fields).toMatchObject({ generatedAudioUrl: "https://r2/c0.m4a", __listResults: ["https://r2/c0.m4a"] })
    expect(fields.generatedVideoUrl).toBeUndefined()
    // Every row of an audio run is marked audio by the run, whatever its file is named.
    const bare = { audioUrl: "https://r2/a0", clips: [{ url: "https://r2/a0", clipKey: "k0" }, { url: "https://r2/a1", clipKey: "k1" }], quality: "final" }
    expect(usecaseListRows("clip-pack", bare, "j", "t").map((r) => r.medium)).toEqual(["audio", "audio"])
    expect(usecaseListRowFields("clip-pack", bare, "https://r2/a1")).toMatchObject({ medium: "audio" })
    expect(usecaseTakeMedium("https://r2/a1", { generatedResults: usecaseListRows("clip-pack", bare, "j", "t") })).toBe("audio")
    // A video run's rows carry no medium mark (Trailer's included).
    expect(usecaseListRows("clip-pack", clips, "j", "t")[0]!.medium).toBeUndefined()
  })

  it("each clip's still rides its row and its row stamp, like its file", () => {
    const still = { ...clips, clips: [{ ...clips.clips[0]!, thumbnailUrl: "https://r2/c0.png" }, clips.clips[1]!] }
    expect(usecaseListRows("clip-pack", still, "j", "t").map((r) => r.thumbnailUrl)).toEqual(["https://r2/c0.png", undefined])
    expect((usecaseListFields("clip-pack", still, "j").__listResultStamps as Array<Record<string, unknown>>).map((s) => s.thumbnailUrl)).toEqual(["https://r2/c0.png", undefined])
    expect(usecaseTakeFields("clip-pack", still, "https://r2/c0.mp4")).toMatchObject({ thumbnailUrl: "https://r2/c0.png" })
  })

  it("a review run lands each clip's preview as its own row", () => {
    const review = { videoUrl: "https://r2/p0.mp4", clips: [{ url: "https://r2/p0.mp4", quality: "proxy", clipKey: "k0" }, { url: "https://r2/p1.mp4", quality: "proxy", clipKey: "k1" }], quality: "proxy" }
    expect(usecaseListRows("clip-pack", review, "j", "t").map((r) => [r.url, r.quality])).toEqual([["https://r2/p0.mp4", "proxy"], ["https://r2/p1.mp4", "proxy"]])
  })
})
