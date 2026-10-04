import { describe, it, expect } from "vitest"
import { edlValidityOf } from "../edl-validity"

// The EDL validity badge's verdict: a value is checked the way every server
// ingress checks it — parsed if a string, normalized, then validated; a clips
// plan (a bare Edl[]) as the clip set it is.

const seg = (id: string, inMs: number, outMs: number, video = "v") => ({ id, inMs, outMs, video })
const edlOf = (...segments: Array<Record<string, unknown>>) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments,
})

describe("edlValidityOf", () => {
  it("holds no verdict when there is no EDL: nothing, an empty field, a chapters plan", () => {
    expect(edlValidityOf(undefined)).toBeNull()
    expect(edlValidityOf(null)).toBeNull()
    expect(edlValidityOf("   ")).toBeNull()
    expect(edlValidityOf({ version: 1, chapters: [{ startMs: 0, title: "Intro" }] })).toBeNull()
    expect(edlValidityOf(42)).toBeNull()
  })

  it("a well-formed tighten EDL is valid", () => {
    expect(edlValidityOf(edlOf(seg("s0", 0, 5000), seg("s1", 8000, 12_000)))).toEqual({ kind: "edl", ok: true, issues: [], warnings: [] })
  })

  it("a segment naming a source the EDL does not have is an issue", () => {
    const v = edlValidityOf(edlOf(seg("s0", 0, 5000, "ghost")))
    expect(v?.ok).toBe(false)
    expect(v?.issues.join("\n")).toMatch(/ghost/)
  })

  it("a JSON string is parsed like every server ingress parses it", () => {
    expect(edlValidityOf(JSON.stringify(edlOf(seg("s0", 0, 5000))))?.ok).toBe(true)
  })

  it("a string that is not JSON is reported as such, with nothing else to check", () => {
    expect(edlValidityOf("{not json")).toEqual({ kind: "edl", ok: false, issues: [], warnings: [], unparseable: true })
  })

  it("a clips plan is checked per clip, and an issue names its clip", () => {
    const good = edlOf(seg("seg-0", 0, 5000))
    const bad = edlOf(seg("seg-0", 0, 5000, "ghost"))
    expect(edlValidityOf([good, good])).toMatchObject({ kind: "clips", ok: true })
    const v = edlValidityOf([good, bad])
    expect(v).toMatchObject({ kind: "clips", ok: false })
    expect(v?.issues.every((m) => m.startsWith("clip[1]: "))).toBe(true)
  })

  it("an empty clips plan is an issue, not a pass", () => {
    expect(edlValidityOf([])).toMatchObject({ kind: "clips", ok: false })
  })
})

// Review of #1789: Camera Switch, run once per clip, holds its batch as one JSON
// STRING per clip ("" for a clip whose run failed). Every valid batch read as
// "segments is empty" twice over.
describe("edlValidityOf — a clip list held as JSON strings", () => {
  const clip = (inMs: number, outMs: number) => JSON.stringify(edlOf(seg("seg-0", inMs, outMs)))

  it("a valid string batch is valid", () => {
    expect(edlValidityOf([clip(0, 5000), clip(9000, 12_000)])).toEqual({ kind: "clips", ok: true, issues: [], warnings: [] })
  })

  it("a blank item is a failed clip the engines skip: skipped here, and later clips keep their position", () => {
    const v = edlValidityOf([clip(0, 5000), "", JSON.stringify(edlOf(seg("seg-0", 0, 5000, "ghost")))])
    expect(v?.ok).toBe(false)
    expect(v?.issues.length).toBeGreaterThan(0)
    expect(v?.issues.every((m) => m.startsWith("clip[2]: "))).toBe(true)
    expect(v?.issues.join("\n")).not.toMatch(/segments is empty/)
  })

  it("an item that is not JSON is named, not read as an empty EDL", () => {
    expect(edlValidityOf([clip(0, 5000), "{oops"])?.issues).toEqual(["clip[1]: not valid JSON"])
  })

  it("only failed clips: nothing to render", () => {
    expect(edlValidityOf(["", ""])).toEqual({ kind: "clips", ok: false, issues: ["clipset has no clips"], warnings: [] })
  })
})
