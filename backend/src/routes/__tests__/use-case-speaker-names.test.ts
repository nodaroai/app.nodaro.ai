// @test-units-by-name reads the bodies and descriptors of the use-case types it names (tighten-episode, speaker-layout, clip-pack, episode-trailer, episode-chapters)
/**
 * The speakers' names a request gives (decided 2026-11-17): the run route
 * keeps them on the wrapper's input (`input_data.speakerNames`), cleaned, and
 * the run itself never sees them — they are reported back on the job's
 * `speakers[].name`. Tighten Episode and Speaker Layout take them.
 */
import { m, makeApp, post } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect, beforeAll } from "vitest"
import { usecaseDescriptor } from "@nodaro/render-rules"
import { USE_CASE_BODIES } from "@/lib/use-case/bodies.js"
import { USE_CASE_SPEAKER_NAMES_MAX } from "@/lib/use-case/body-shapes.js"
import { usecaseKeptSpeakerNames } from "@/lib/use-case/wrapper-output-speakers.js"

const inputOf = () => (m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data

describe("POST /v1/tighten-episode with speakerNames", () => {
  // The route is a cold import of several seconds on a loaded runner: loaded
  // here under a budget of its own, so no test spends its 5 s timeout on it
  // (a test that times out leaves its call running into the next one).
  beforeAll(async () => {
    await makeApp()
  }, 60_000)

  it("keeps the names on the job, trimmed, a blank one dropped", async () => {
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], speakerNames: { speaker_0: "  Dana ", speaker_1: "Avi", speaker_2: "  " } })
    expect(res.statusCode).toBe(202)
    expect(inputOf().speakerNames).toEqual({ speaker_0: "Dana", speaker_1: "Avi" })
  })
  it("the run never reads them: no setting key names them, and the settings a run is built from are the same without them", () => {
    for (const type of ["tighten-episode", "speaker-layout"] as const) {
      const d = usecaseDescriptor(type)
      expect(d.settingKeys, type).not.toContain("speakerNames")
      const body = { mediaUrls: ["https://r2/ep.mp4"] }
      expect(d.resolveSettings({ ...body, speakerNames: { speaker_0: "Dana" } }, "video"), type).toEqual(d.resolveSettings(body, "video"))
    }
  })
  it("no names, or only blank ones: nothing kept", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(inputOf()).not.toHaveProperty("speakerNames")
    m.insertJob.mockClear()
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], speakerNames: { speaker_0: " " } })
    expect(inputOf()).not.toHaveProperty("speakerNames")
  })
  it("refused before anything is written: a name over 80 characters, an empty label, too many speakers", async () => {
    for (const speakerNames of [
      { speaker_0: "x".repeat(81) },
      { "": "Dana" },
      Object.fromEntries(Array.from({ length: USE_CASE_SPEAKER_NAMES_MAX + 1 }, (_, i) => [`speaker_${i}`, `S${i}`])),
      ["Dana"],
    ]) {
      const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], speakerNames })
      expect(res.statusCode, JSON.stringify(speakerNames).slice(0, 40)).toBe(400)
    }
    expect(m.insertJob).not.toHaveBeenCalled()
  })
})

describe("the bodies that take speakerNames", () => {
  it("Tighten Episode and Speaker Layout; the other use-case types are unchanged", () => {
    const names = { speaker_0: "Dana" }
    for (const type of ["tighten-episode", "speaker-layout"] as const) {
      expect(USE_CASE_BODIES[type].shape, type).toHaveProperty("speakerNames")
      expect(USE_CASE_BODIES[type].safeParse({ mediaUrls: ["https://r2/ep.mp4"], speakerNames: names }).success, type).toBe(true)
    }
    for (const type of ["clip-pack", "episode-trailer", "episode-chapters"] as const) {
      expect(USE_CASE_BODIES[type].shape, type).not.toHaveProperty("speakerNames")
    }
  })
  it("a continuation keeps what its run kept: the same cleaning, nothing when none", () => {
    expect(usecaseKeptSpeakerNames({ speaker_0: " Dana ", speaker_1: "" })).toEqual({ speakerNames: { speaker_0: "Dana" } })
    expect(usecaseKeptSpeakerNames(undefined)).toEqual({})
    expect(usecaseKeptSpeakerNames("Dana")).toEqual({})
  })
})
