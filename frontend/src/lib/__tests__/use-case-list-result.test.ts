import { describe, it, expect } from "vitest"
import { usecaseFailedDeliveriesField, usecaseListFields, usecaseListRowFields, usecaseListRows } from "@/lib/use-case-list-result"
import { usecaseRunResultFields, usecaseTakeFields } from "@/lib/use-case-run-result"

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
