import { describe, it, expect } from "vitest"
import { usecaseRecordingsProblem } from "@nodaro/render-rules"
import { translate } from "@/lib/i18n"
import { usecaseCameraNoteLines } from "@/lib/use-case-cameras-note"

const t = (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ""}`

describe("the camera note (decided 2026-10-17)", () => {
  it("one line per speaker with no clear camera; mapped speakers say nothing; no report says nothing", () => {
    expect(usecaseCameraNoteLines({ speakers: [{ speaker: "speaker_1", ordinal: 1, camera: null, marginDb: 0.4 }, { speaker: "speaker_0", ordinal: 2, camera: 2, marginDb: 7.5 }], syncNotes: [], mapNotes: [] }, t))
      .toEqual(['node.usecaseCameraUnclear{"n":1}'])
    expect(usecaseCameraNoteLines(undefined, t)).toEqual([])
  })
  it("a sync note becomes one line that says to check the offsets", () => {
    expect(usecaseCameraNoteLines({ speakers: [], syncNotes: ["x"], mapNotes: [] }, t)).toEqual(["node.usecaseCameraSyncWeak"])
    expect(usecaseCameraNoteLines({ speakers: [], syncNotes: ["x", "y"], mapNotes: ["z"] }, t)).toEqual(["node.usecaseCameraSyncWeak"])
  })
  it("a stored report it cannot read says nothing", () => {
    expect(usecaseCameraNoteLines("not a report" as never, t)).toEqual([])
  })
})

describe("the recordings refusals' copy", () => {
  it("English is the route's own sentence (one wording; the limits named once, in render-rules)", () => {
    const tooMany = usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video", "video"], masterAudio: false, cameras: undefined })!
    expect(tooMany.code).toBe("too_many_recordings")
    expect(translate("en", "apiErr.reason.tooManyRecordings")).toBe(tooMany.message)
    const twoAudio = usecaseRecordingsProblem({ kinds: ["audio", "audio"], masterAudio: false, cameras: undefined })!
    expect(translate("en", "apiErr.reason.recordingsTwoAudioOnly")).toBe(twoAudio.message)
  })
})
