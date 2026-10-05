import { describe, it, expect } from "vitest"
import { edlValidityOf, EXPECTED_ONE_EDL, type ApplyEdlRenderContext } from "../edl-validity"

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

// The Apply EDL panel judges what the node RENDERS, with Apply EDL's own render
// rule (decided 2026-10-04: the badge is split by surface) — always one EDL per
// run, the node's settings and wired sources applied as the server applies them.
describe("edlValidityOf — judged as a render, with the render rule", () => {
  const one = edlOf(seg("s0", 0, 5000))
  const ctx = (over: Partial<ApplyEdlRenderContext> = {}): { render: ApplyEdlRenderContext } => ({
    render: { clipList: false, output: "video", crossfadeMs: 0, sources: [], ...over },
  })

  it("a renderable EDL passes, with no warnings: what the rule does not refuse renders", () => {
    expect(edlValidityOf(one, ctx())).toEqual({ kind: "edl", ok: true, issues: [], warnings: [] })
  })

  it("refuses what the structural check passes: a layout, an unknown role, a region", () => {
    const twoCams = {
      ...edlOf(seg("s0", 0, 3000), {
        id: "s1", inMs: 3000, outMs: 6000, video: "v",
        layout: { mode: "side-by-side", slots: [{ source: "v" }, { source: "w" }] },
      }),
      sources: [
        { id: "v", url: "https://cdn/v.mp4", kind: "video" },
        { id: "w", url: "https://cdn/w.mp4", kind: "video" },
      ],
    }
    expect(edlValidityOf(twoCams)?.ok).toBe(true) // well-formed
    expect(edlValidityOf(twoCams, ctx())?.issues.join("\n")).toMatch(/layout mode "side-by-side"/)

    const misspelled = { ...one, sources: [...one.sources, { id: "m", url: "https://cdn/m.wav", kind: "audio", role: "master_audio" }] }
    expect(edlValidityOf(misspelled)?.ok).toBe(true) // only a warning structurally
    expect(edlValidityOf(misspelled, ctx())?.issues.join("\n")).toMatch(/unknown role "master_audio"/)

    const cropped = edlOf({ ...seg("s0", 0, 5000), region: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    expect(edlValidityOf(cropped)?.ok).toBe(true)
    expect(edlValidityOf(cropped, ctx())?.ok).toBe(false)
  })

  it("reads the node's output: a segment with no picture fails a video render, not an audio one", () => {
    const noPicture = {
      ...edlOf(seg("s0", 0, 4000), { id: "s1", inMs: 4000, outMs: 6000 }),
      sources: [
        { id: "v", url: "https://cdn/v.mp4", kind: "video" },
        { id: "m", url: "https://cdn/m.wav", kind: "audio", role: "master-audio" },
      ],
    }
    expect(edlValidityOf(noPicture, ctx({ output: "video" }))?.issues.join("\n")).toMatch(/segment\[1\] "s1" has no video source/)
    expect(edlValidityOf(noPicture, ctx({ output: "audio" }))?.ok).toBe(true)
  })

  it("reads the node's default crossfade: it can bring an edit under the 180-minute cap", () => {
    const MIN = 60_000
    const justOver = edlOf(seg("a", 0, 60 * MIN), seg("b", 60 * MIN, 120 * MIN), seg("c", 120 * MIN, 180 * MIN + 2000))
    expect(edlValidityOf(justOver, ctx({ crossfadeMs: 0 }))?.issues).toEqual([
      "the edit renders 180.1 minutes of output — over the 180-minute limit for one render; split it into parts of at most 180 minutes",
    ])
    expect(edlValidityOf(justOver, ctx({ crossfadeMs: 1000 }))?.ok).toBe(true)
  })

  it("reads the wired sources: an empty url a Sources wire fills renders", () => {
    const unresolved = { ...one, sources: [{ id: "v", url: "", kind: "video" }] }
    expect(edlValidityOf(unresolved)?.ok).toBe(false) // structurally: url is empty
    expect(edlValidityOf(unresolved, ctx())?.ok).toBe(false)
    expect(edlValidityOf(unresolved, ctx({ sources: ["https://cdn/upload.mp4"] }))).toEqual({ kind: "edl", ok: true, issues: [], warnings: [] })
  })

  it("an inline list is one invalid EDL (it renders as a single EDL and fails)", () => {
    expect(edlValidityOf([one], ctx())).toEqual({ kind: "edl", ok: false, issues: [EXPECTED_ONE_EDL], warnings: [] })
    expect(edlValidityOf(JSON.stringify([one]), ctx())?.ok).toBe(false)
  })

  it("a plan's list is a clip list: every clip a run could render is checked, by the render rule", () => {
    const cropped = edlOf({ ...seg("s0", 0, 5000), region: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    expect(edlValidityOf([one, one], ctx({ clipList: true }))).toMatchObject({ kind: "clips", ok: true })
    const v = edlValidityOf([one, "", JSON.stringify(cropped)], ctx({ clipList: true }))
    expect(v?.kind).toBe("clips")
    expect(v?.issues).toHaveLength(1)
    expect(v?.issues[0]).toMatch(/^clip\[2\]: segment\[0\] "s0": region crops are not renderable here/)
  })

  it("a wired object that is not an EDL — a chapters plan — is an invalid EDL, not 'no EDL'", () => {
    const chapters = { version: 1, chapters: [{ startMs: 0, title: "Intro" }] }
    expect(edlValidityOf(chapters)).toBeNull() // as a plan: holds no EDL
    expect(edlValidityOf(chapters, ctx({ clipList: true }))).toEqual({ kind: "edl", ok: false, issues: ["segments is empty"], warnings: [] })
  })

  it("nothing to render is still nothing; text that is not JSON says so", () => {
    expect(edlValidityOf(undefined, ctx())).toBeNull()
    expect(edlValidityOf("  ", ctx())).toBeNull()
    expect(edlValidityOf("{not json", ctx())).toMatchObject({ ok: false, unparseable: true })
  })
})

