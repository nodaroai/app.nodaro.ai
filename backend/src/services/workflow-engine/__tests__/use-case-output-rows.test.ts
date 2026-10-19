/**
 * A list-result use-case node's rows (Trailer's formats) rebuilt from its
 * wrapper's job row name that job, like the rows a live run hands on: a
 * Render final or a Continue of a rebuilt take needs a real run to name.
 */
import { describe, expect, it } from "vitest"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import { usecaseJobOutput } from "../use-case-output.js"

const ROW = {
  videoUrl: "https://r2/t-916.mp4",
  formats: [{ format: "9:16", url: "https://r2/t-916.mp4" }, { format: "1:1", url: "https://r2/t-11.mp4" }],
  failedFormats: ["4:5"],
  quality: "final",
  planBasis: "0123456789abcdef",
  renderBasis: "fedcba9876543210",
}
const stamp = { quality: "final", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210" }

describe("rows rebuilt from a Trailer's job row", () => {
  it("name the job they were rebuilt from, with the run's stamps and each format", () => {
    const out = buildNodeOutputFromJobData(ROW, "episode-trailer", "job-w")
    expect(out.listResults).toEqual(["https://r2/t-916.mp4", "https://r2/t-11.mp4"])
    expect(out.listResultStamps).toEqual([{ ...stamp, jobId: "job-w" }, { ...stamp, jobId: "job-w" }])
    expect(out.formats).toEqual(ROW.formats)
    expect(out.failedFormats).toEqual(["4:5"])
  })

  it("a caller that does not know the job leaves the rows unnamed (never a wrong job)", () => {
    expect(usecaseJobOutput(ROW).listResultStamps).toEqual([stamp, stamp])
  })
})
