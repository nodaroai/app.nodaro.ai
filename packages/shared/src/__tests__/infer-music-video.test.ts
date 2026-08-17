import { describe, it, expect } from "vitest"
import { inferMusicVideo, videoAnalysisResultSchema, VIDEO_ANALYSIS_TIMES_OF_DAY, VIDEO_ANALYSIS_STORY_JUMPS } from "../video-analysis"

/**
 * The inference decides whether a recast takes the original soundtrack AS-IS
 * (no stem separation). Server (recast route mode derivation) and client
 * (prep pricing + the generate-time mode-mismatch guard) both call THIS
 * function, so its exact boundary behaviour is contract, not detail.
 */

const music = (content: string) => ({ mode: "music" as const, content })
const scene = (audio: Array<{ mode: string; content: string }>) => ({ audio })
const vocalScenes = (n: number) => Array.from({ length: n }, () => scene([music("upbeat pop track with sung lyrics")]))

describe("inferMusicVideo", () => {
  it("true when ≥80% of ≥4 scenes carry music and vocals are evidenced", () => {
    expect(inferMusicVideo({ scenes: vocalScenes(5) })).toBe(true)
    // 4 of 5 with music (80% exactly), one vocal layer
    expect(inferMusicVideo({ scenes: [...vocalScenes(4), scene([])] })).toBe(true)
  })

  it("quoted lyric text inside a music layer is vocal evidence on its own", () => {
    const scenes = Array.from({ length: 4 }, () => scene([music('gentle track, "la la la, choosing you tonight"')]))
    expect(inferMusicVideo({ scenes })).toBe(true)
  })

  it("false below the coverage bar, the scene floor, or with no vocal evidence", () => {
    expect(inferMusicVideo({ scenes: [...vocalScenes(3), scene([]), scene([])] })).toBe(false) // 60%
    expect(inferMusicVideo({ scenes: vocalScenes(3) })).toBe(false) // < 4 scenes
    const instrumentalOnly = Array.from({ length: 5 }, () => scene([music("sweeping orchestral score")]))
    expect(inferMusicVideo({ scenes: instrumentalOnly })).toBe(false)
  })

  it("negated vocals ('instrumental', 'no vocals') are not evidence; sfx/speech layers never are", () => {
    const negated = Array.from({ length: 5 }, () => scene([music("instrumental version of the song, no vocals")]))
    expect(inferMusicVideo({ scenes: negated })).toBe(false)
    const speechy = Array.from({ length: 5 }, () => scene([{ mode: "speech", content: "she sings later" }, music("soft bed")]))
    expect(inferMusicVideo({ scenes: speechy })).toBe(false)
  })

  it("bare 'song'/'music' descriptions are NOT vocal evidence (instrumental beds are described as songs)", () => {
    const bare = Array.from({ length: 5 }, () => scene([music("upbeat pop song under the action")]))
    expect(inferMusicVideo({ scenes: bare })).toBe(false)
  })

  it("throw-proof on malformed or absent input", () => {
    expect(inferMusicVideo(undefined)).toBe(false)
    expect(inferMusicVideo(null)).toBe(false)
    expect(inferMusicVideo({})).toBe(false)
    expect(inferMusicVideo({ scenes: [{}, { audio: [{}] }, {}, {}] } as never)).toBe(false)
  })
})

describe("chronicle-time fields (2.6.0)", () => {
  const base = {
    startSec: 0, endSec: 2, label: "l", shotType: "Wide", camera: "static",
    visual: "a scene", audio: [], sceneNumber: 1, visualResolved: "a scene", slotRefs: [],
  }
  const result = (sceneOver: Record<string, unknown>) => ({
    meta: { durationSec: 2, width: 10, height: 10, aspectRatio: "1:1" },
    slots: [],
    scenes: [{ ...base, ...sceneOver }],
  })

  it("are optional (pre-2.6.0 analyses parse unchanged) and enum-validated when present", () => {
    expect(videoAnalysisResultSchema.safeParse(result({})).success).toBe(true)
    expect(videoAnalysisResultSchema.safeParse(result({ timeOfDay: "dusk", storyJump: "years-later" })).success).toBe(true)
    expect(videoAnalysisResultSchema.safeParse(result({ timeOfDay: "noon" })).success).toBe(false)
    expect(videoAnalysisResultSchema.safeParse(result({ storyJump: "later" })).success).toBe(false)
  })

  it("the enums stay congruence-safe for the window decode grammar (no ints, no maxItems)", () => {
    expect(VIDEO_ANALYSIS_TIMES_OF_DAY).toContain("ambiguous")
    expect(VIDEO_ANALYSIS_STORY_JUMPS).toContain("years-later")
  })
})
