import { describe, it, expect } from "vitest"
import { csvFields, firstCsvRow } from "../ffprobe-csv.js"

describe("csvFields — the two ffprobe csv shapes a plain split misreads", () => {
  it("MPEG-TS repeats each selected stream under its program: the first row wins", () => {
    expect(csvFields("320x240\n\n320x240\n", "x")).toEqual(["320", "240"])
    expect(csvFields("30000/1001\n\n30000/1001\n")).toEqual(["30000/1001"])
  })
  it("a stream with side data (rotated MP4, MPEG-2 CPB) appends an empty section: trailing empties dropped", () => {
    expect(csvFields("30000/1001,\n")).toEqual(["30000/1001"])
    expect(csvFields("h264,yuv420p,\n")).toEqual(["h264", "yuv420p"])
    expect(csvFields("1920x1080x\n", "x")).toEqual(["1920", "1080"])
    expect(csvFields("30000/1001,\n\n30000/1001,\n")).toEqual(["30000/1001"]) // an MPEG-2 TS: both at once
  })
  it("a one-row answer is its fields; no row is no fields", () => {
    expect(csvFields("h264,yuv420p\n")).toEqual(["h264", "yuv420p"])
    expect(csvFields("\n  \n")).toEqual([])
    expect(firstCsvRow("\n1920x1080\n")).toBe("1920x1080")
  })
})
