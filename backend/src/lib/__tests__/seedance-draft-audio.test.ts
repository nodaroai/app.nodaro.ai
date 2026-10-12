import { describe, expect, it } from "vitest"
import {
  draftAudioMuxForSource,
  draftAudioMuxMergeArgs,
  draftAudioMuxOutputData,
  generateVideoAudioMergeRecipe,
  readDraftAudioMux,
  voiceTrackMuxRecipe,
} from "../seedance-draft-audio.js"

/**
 * Which audio mux a Seedance draft's 1080p finalize re-applies (decided
 * 2026-10-12): the one the draft got after rendering, read from the SOURCE job.
 */
describe("draft audio mux recipes", () => {
  it("the Generate Video audio merge: 100 % over 30 % of the clip's own audio, kept only when generated", () => {
    expect(generateVideoAudioMergeRecipe("https://a/vo.mp3", true)).toEqual({
      kind: "audio-track", audioUrl: "https://a/vo.mp3", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true,
    })
    expect(generateVideoAudioMergeRecipe("https://a/vo.mp3", undefined)).toMatchObject({ keepOriginalAudio: false })
  })

  it("a draft records its recipe, or null when nothing was muxed; other runs record nothing", () => {
    const mux = voiceTrackMuxRecipe("https://r2/track.mp3")
    expect(draftAudioMuxOutputData(true, "seedance-2-5", mux)).toEqual({ draftAudioMux: mux })
    expect(draftAudioMuxOutputData(true, "seedance-2-5", undefined)).toEqual({ draftAudioMux: null })
    expect(draftAudioMuxOutputData(undefined, "seedance-2-5", mux)).toEqual({})
    expect(draftAudioMuxOutputData(true, "kling-3.0", mux)).toEqual({})
  })

  it("reads only well-formed recipes back", () => {
    expect(readDraftAudioMux({ kind: "voice-track", audioUrl: "https://r2/t.mp3" })).toEqual({ kind: "voice-track", audioUrl: "https://r2/t.mp3" })
    expect(readDraftAudioMux({ kind: "voice-track" })).toBeUndefined()
    expect(readDraftAudioMux({ kind: "something" })).toBeUndefined()
    expect(readDraftAudioMux(null)).toBeUndefined()
  })
})

describe("draftAudioMuxForSource", () => {
  const stored = { videoUrl: "https://r2/draft.mp4" }

  it("uses the recorded recipe", () => {
    const mux = generateVideoAudioMergeRecipe("https://a/vo.mp3", false)
    expect(draftAudioMuxForSource({ audioUrl: "https://a/vo.mp3" }, { ...stored, draftAudioMux: mux })).toEqual(mux)
  })

  it("a recorded null means a plain draft: nothing is re-applied, whatever the request carried", () => {
    expect(draftAudioMuxForSource({ audioUrl: "https://a/backfilled.mp3" }, { ...stored, draftAudioMux: null })).toBeUndefined()
  })

  it("an older draft without the record that was voiced or audio-merged copies the stored draft's audio", () => {
    expect(draftAudioMuxForSource({}, { ...stored, voiceApplied: true })).toEqual({ kind: "copy-draft-audio", draftVideoUrl: stored.videoUrl })
    expect(draftAudioMuxForSource({ audioUrl: "https://a/vo.mp3" }, stored)).toEqual({ kind: "copy-draft-audio", draftVideoUrl: stored.videoUrl })
  })

  it("an older plain draft gets nothing", () => {
    expect(draftAudioMuxForSource({}, stored)).toBeUndefined()
    expect(draftAudioMuxForSource({}, { ...stored, voiceApplied: false })).toBeUndefined()
  })
})

describe("draftAudioMuxMergeArgs (ONE builder: the draft-time muxes and the finalize's re-apply)", () => {
  // Pinned with toStrictEqual: an extra `undefined` key or a moved default is drift.
  it("audio-track = the i2v handler's Generate Video audio merge, exactly", () => {
    expect(draftAudioMuxMergeArgs("https://v/clip.mp4", generateVideoAudioMergeRecipe("https://a/vo.mp3", undefined))).toStrictEqual({
      videoUrl: "https://v/clip.mp4",
      audioUrl: "https://a/vo.mp3",
      voiceoverVolume: 100,
      backgroundVolume: 30,
      keepOriginalAudio: false,
    })
    expect(draftAudioMuxMergeArgs("https://v/clip.mp4", generateVideoAudioMergeRecipe("https://a/vo.mp3", true))).toStrictEqual({
      videoUrl: "https://v/clip.mp4",
      audioUrl: "https://a/vo.mp3",
      voiceoverVolume: 100,
      backgroundVolume: 30,
      keepOriginalAudio: true,
    })
  })

  it("voice-track = the voiced lane's mergeVoiceTrackToR2, exactly", () => {
    expect(draftAudioMuxMergeArgs("https://v/clip.mp4", voiceTrackMuxRecipe("https://r2/track.mp3"))).toStrictEqual({
      videoUrl: "https://v/clip.mp4",
      audioTracks: [{ url: "https://r2/track.mp3", startTime: 0, volume: 100, sourceType: "audio" }],
      keepOriginalAudio: false,
    })
  })

  it("copy-draft-audio = the stored draft's audio stream replacing the 1080p take's", () => {
    expect(draftAudioMuxMergeArgs("https://v/hd.mp4", { kind: "copy-draft-audio", draftVideoUrl: "https://r2/draft.mp4" })).toStrictEqual({
      videoUrl: "https://v/hd.mp4",
      audioTracks: [{ url: "https://r2/draft.mp4", startTime: 0, volume: 100, sourceType: "video" }],
      keepOriginalAudio: false,
    })
  })
})
