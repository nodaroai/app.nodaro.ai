import { describe, expect, it } from "vitest"
import { assembleFanOutResult } from "../../../workers/fan-out-result.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"

const output = (n: number) => ({
  deliveryMode: "separate_clips", videoUrl: `https://clips/${n}-1`,
  unassembledClips: [1, 2].map(segment => ({ segment, url: `https://clips/${n}-${segment}`, extra: "private" })),
  pro: { routeToken: "private" },
})

describe.each(["generate-video-pro", "edit-video-pro"])("%s delivered clips", type => {
  it("files only the ordered playable clips, including the second fan-out job's own clips", () => {
    const results = [1, 2].map((n, index) => {
      const projected = buildNodeOutputFromJobData(output(n), type, `job-${n}`)
      expect(JSON.stringify(projected)).not.toContain("private")
      expect(projected.unassembledClips).toEqual(output(n).unassembledClips.map(({ url, segment }) => ({ url, segment })))
      return { status: "fulfilled" as const, value: { index, result: { output: projected, jobId: `job-${n}` }, resultValue: projected.videoUrl! } }
    })
    const batch = assembleFanOutResult(results, 2, type)
    expect(batch.output).toMatchObject({ clipJobId: "job-1", listResults: ["https://clips/1-1", "https://clips/2-1"],
      listResultStamps: [{ clipJobId: "job-1" }, { clipJobId: "job-2", unassembledClips: results[1]!.value.result.output.unassembledClips }] })
    expect(buildNodeOutputFromJobData(output(1), "extend-video")).not.toHaveProperty("unassembledClips")
  })
})
