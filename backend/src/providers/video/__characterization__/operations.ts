import { dirname } from "node:path"
import { AUDIO_FX_REVERB_PRESETS, type AudioFxPreset } from "@nodaro/shared"
import { applyAudioFx } from "../audio-fx.js"
import { mixAudio } from "../mix-audio.js"
import { mergeVideoAudio } from "../merge-video-audio.js"
import { assembleNarratedVideo } from "../assemble-narrated-video.js"
import { combineVideos } from "../combine-videos.js"
import { adjustVolume } from "../adjust-volume.js"
import { speedRamp } from "../speed-ramp.js"
import { fadeVideo } from "../fade-video.js"
import { resizeVideo } from "../resize-video.js"
import { socialMediaFormat } from "../social-media-format.js"
import { addCaptions } from "../add-captions.js"
import { combineAudio } from "../combine-audio.js"
import { extractAudio } from "../extract-audio.js"
import { extractAudioTrack } from "../extract-audio-track.js"
import { trimAudio } from "../trim-audio.js"
import { trimVideo } from "../trim-video.js"
import { loopVideo } from "../loop-video.js"
import { splitMedia } from "../split-media.js"
import { removeAudio } from "../remove-audio.js"
import { extractFrame } from "../extract-frame.js"
import { smartLoopCut } from "../smart-loop-cut.js"
import { fixtureUrl, type FixtureSet } from "./fixtures.js"
import type { Tolerances } from "./compare.js"

/**
 * The operation registry: every ffmpeg-backed operation rendered by the
 * characterization harness, invoked through its REAL exported production
 * function (URL wrapper and all — the suite's `downloadFile` mock resolves
 * fixture URLs to local files, so the whole pipeline short of the network
 * runs verbatim). Coverage follows the plan's tier order: Tier 1 audio DSP
 * (where the reverb incident lived) first, then video geometry, then
 * stream/container smoke ops.
 *
 * CLEANUP CONTRACT: these production functions deliberately leave their work
 * dir in place on success (the worker uploads the output, then cleans). The
 * harness honors that by collecting each op's `cleanupDirs` and removing
 * them after measurement — a harness that renders ~50 outputs per run and
 * never cleans up fills the disk of whatever runs it.
 */

export interface RenderedOutput {
  readonly label: string
  readonly path: string
  readonly kind: "audio" | "video" | "image"
}

export interface OperationResult {
  readonly outputs: readonly RenderedOutput[]
  readonly cleanupDirs: readonly string[]
}

export interface CharacterizedOperation {
  readonly name: string
  readonly tier: 1 | 2 | 3
  /** Per-op tolerance overrides — each MUST carry a comment saying why. */
  readonly tolerances?: Partial<Tolerances>
  readonly run: (f: FixtureSet) => Promise<OperationResult>
}

const single = (path: string, kind: RenderedOutput["kind"], cleanupDir?: string): OperationResult => ({
  outputs: [{ label: "out", path, kind }],
  cleanupDirs: [cleanupDir ?? dirname(path)],
})

/**
 * Every reverb preset — the presets are where the incident lived, so every
 * one is rendered. Derived from AUDIO_FX_REVERB_PRESETS (the same set the
 * production dispatch reads), never hand-listed: a preset added later is
 * covered automatically or the golden check fails, both of which are
 * correct. The IR generator is SEEDED (see buildReverbIr), so standard
 * tolerances apply; if seeding is ever removed these need ±1.5 dB energy and
 * envelope-shape-only assertions instead (see the plan's Trap 4).
 */
const reverbOps: CharacterizedOperation[] = [...AUDIO_FX_REVERB_PRESETS].sort().map((preset) => ({
  name: `audio-fx-reverb-${preset}`,
  tier: 1,
  run: async (f: FixtureSet) => {
    const { outputPath } = await applyAudioFx({
      audioUrl: fixtureUrl(f.toneWav),
      preset: preset as AudioFxPreset,
    })
    return single(outputPath, "audio")
  },
}))

const tier1: CharacterizedOperation[] = [
  ...reverbOps,
  {
    name: "audio-fx-telephone",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await applyAudioFx({ audioUrl: fixtureUrl(f.noiseWav), preset: "telephone" })
      return single(outputPath, "audio")
    },
  },
  {
    name: "audio-fx-megaphone",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await applyAudioFx({ audioUrl: fixtureUrl(f.noiseWav), preset: "megaphone" })
      return single(outputPath, "audio")
    },
  },
  {
    name: "audio-fx-echo",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await applyAudioFx({
        audioUrl: fixtureUrl(f.toneWav),
        preset: "echo",
        delayMs: 250,
        decay: 0.4,
      })
      return single(outputPath, "audio")
    },
  },
  {
    name: "audio-fx-custom-eq-echo",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await applyAudioFx({
        audioUrl: fixtureUrl(f.noiseWav),
        preset: "custom",
        eqLow: 6,
        eqHigh: -4,
        delayMs: 300,
        decay: 0.5,
      })
      return single(outputPath, "audio")
    },
  },
  {
    // Echo convolved against a unit impulse IS the echo chain's impulse
    // response — tap times land as envelope spikes, so a delay/decay
    // semantic change in `aecho` is directly visible.
    name: "audio-fx-echo-impulse",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await applyAudioFx({
        audioUrl: fixtureUrl(f.impulseWav),
        preset: "echo",
        delayMs: 400,
        decay: 0.6,
      })
      return single(outputPath, "audio")
    },
  },
  {
    name: "mix-audio-average",
    tier: 1,
    run: async (f) => {
      const outputPath = await mixAudio({
        audioUrls: [fixtureUrl(f.toneWav), fixtureUrl(f.noiseWav)],
      })
      return single(outputPath, "audio")
    },
  },
  {
    // amix normalize=0 SUMS — a semantics change here silently clips.
    name: "mix-audio-sum-limited",
    tier: 1,
    run: async (f) => {
      const outputPath = await mixAudio({
        audioUrls: [fixtureUrl(f.toneWav), fixtureUrl(f.noiseWav)],
        trackVolumes: [100, 50],
        sumTracks: true,
      })
      return single(outputPath, "audio")
    },
  },
  {
    // Mixed sample rates + channel counts (44.1 kHz stereo vs 48 kHz mono)
    // force libavfilter's AUTO-INSERTED resample/format conversion inside
    // amix — the `aresample` suspect class from the upgrade plan, exercised
    // exactly the way production mixes arbitrary user audio.
    name: "mix-audio-resample-downmix",
    tier: 1,
    run: async (f) => {
      const outputPath = await mixAudio({
        audioUrls: [fixtureUrl(f.toneStereo44kWav), fixtureUrl(f.toneWav)],
      })
      return single(outputPath, "audio")
    },
  },
  {
    name: "merge-video-audio-basic",
    tier: 1,
    run: async (f) => {
      const outputPath = await mergeVideoAudio({
        videoUrl: fixtureUrl(f.clipMp4),
        audioUrl: fixtureUrl(f.toneWav),
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "merge-video-audio-tracks-sum",
    tier: 1,
    run: async (f) => {
      const outputPath = await mergeVideoAudio({
        videoUrl: fixtureUrl(f.clipMp4),
        audioTracks: [
          { url: fixtureUrl(f.toneShortWav), startTime: 0, volume: 100 },
          { url: fixtureUrl(f.noiseWav), startTime: 1, volume: 50 },
        ],
        keepOriginalAudio: true,
        backgroundVolume: 60,
        sumTracks: true,
      })
      return single(outputPath, "video")
    },
  },
  {
    // Voice (1.2 s) shorter than clip (3 s) → planBlockFit "pad" plan.
    name: "assemble-narrated-pad",
    tier: 1,
    run: async (f) => {
      const outputPath = await assembleNarratedVideo({
        blocks: [{ videoUrl: fixtureUrl(f.clipMp4), audioUrl: fixtureUrl(f.toneShortWav) }],
      })
      return single(outputPath, "video")
    },
  },
  {
    // Voice (5 s) longer than clip (2 s) → "slow" plan: setpts slowdown capped
    // at maxSlowdown, tpad clone-hold for the remainder, atempo on clip audio.
    name: "assemble-narrated-slow",
    tier: 1,
    run: async (f) => {
      const outputPath = await assembleNarratedVideo({
        blocks: [{ videoUrl: fixtureUrl(f.clip2Mp4), audioUrl: fixtureUrl(f.toneWav) }],
        maxSlowdown: 1.5,
      })
      return single(outputPath, "video")
    },
  },
  {
    // Hard cut, audio kept → the concat -c copy fast path.
    name: "combine-videos-cut",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await combineVideos({
        videoUrls: [fixtureUrl(f.clipMp4), fixtureUrl(f.clip2Mp4)],
        transition: "cut",
        transitionDuration: 0,
        audioMode: "keep",
        trimStartFrames: 0,
        trimEndFrames: 0,
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "combine-videos-fade",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await combineVideos({
        videoUrls: [fixtureUrl(f.clipMp4), fixtureUrl(f.clip2Mp4)],
        transition: "fade",
        transitionDuration: 0.5,
        audioMode: "keep",
        trimStartFrames: 0,
        trimEndFrames: 0,
      })
      return single(outputPath, "video")
    },
  },
  {
    // Hard-cut video + audio crossfade → the anchored L-cut path (adelay +
    // atempo tail stretch + amix) muxed onto stream-copied concat video.
    name: "combine-videos-hardcut-audio-crossfade",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await combineVideos({
        videoUrls: [fixtureUrl(f.clipMp4), fixtureUrl(f.clip2Mp4)],
        transition: "cut",
        transitionDuration: 0,
        audioMode: "crossfade",
        audioCrossfadeDuration: 0.5,
        audioCrossfadeCurve: "equal-power",
        trimStartFrames: 0,
        trimEndFrames: 0,
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "combine-videos-dissolve-audio-crossfade",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await combineVideos({
        videoUrls: [fixtureUrl(f.clipMp4), fixtureUrl(f.clip2Mp4)],
        transition: "dissolve",
        transitionDuration: 0.5,
        audioMode: "crossfade",
        audioCrossfadeDuration: 0.4,
        trimStartFrames: 0,
        trimEndFrames: 0,
      })
      return single(outputPath, "video")
    },
  },
  {
    // Continuation pair (clip-head's tail overlaps clip-tail's start on the
    // same testsrc2 timeline) with smart cut REQUESTED — but the boundary
    // matcher is cloud-private (`engines.smartCut`, 2026-07-24) and never
    // registers in this repo's own processes, so what THIS repo ships — and
    // what this op pins — is the PUBLIC DEGRADE path: every boundary keeps
    // the fixed trims (0/0 here → plain normalized concat, the overlap
    // plays twice). The matched-cut behavior is characterized in the
    // private repo alongside the algorithm (smart-cut engine integration
    // test). Renamed from "combine-videos-smartcut" when the algorithm
    // moved private.
    name: "combine-videos-smartcut-degrade",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await combineVideos({
        videoUrls: [fixtureUrl(f.clipHeadMp4), fixtureUrl(f.clipTailMp4)],
        transition: "cut",
        transitionDuration: 0,
        audioMode: "keep",
        trimStartFrames: 0,
        trimEndFrames: 0,
        smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "adjust-volume-fades",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await adjustVolume({
        audioUrl: fixtureUrl(f.toneWav),
        volume: 60,
        fadeIn: 0.25,
        fadeOut: 0.5,
      })
      return single(outputPath, "audio")
    },
  },
  {
    name: "adjust-volume-loudnorm",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await adjustVolume({ audioUrl: fixtureUrl(f.noiseWav), normalize: true })
      return single(outputPath, "audio")
    },
  },
  {
    name: "adjust-volume-video-copy",
    tier: 1,
    run: async (f) => {
      const { outputPath } = await adjustVolume({ videoUrl: fixtureUrl(f.clipMp4), volume: 150 })
      return single(outputPath, "video")
    },
  },
  {
    name: "speed-ramp-atempo",
    tier: 1,
    run: async (f) => {
      const outputPath = await speedRamp({ videoUrl: fixtureUrl(f.clipMp4), speed: 1.5 })
      return single(outputPath, "video")
    },
  },
  {
    name: "speed-ramp-pitch-shift",
    tier: 1,
    run: async (f) => {
      const outputPath = await speedRamp({
        videoUrl: fixtureUrl(f.clipMp4),
        speed: 0.8,
        audioMode: "pitch-shift",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "speed-ramp-segments",
    tier: 1,
    run: async (f) => {
      const outputPath = await speedRamp({
        videoUrl: fixtureUrl(f.clipMp4),
        speed: 1,
        ramps: [
          { start: 0, end: 1, speed: 1 },
          { start: 1, end: 2, speed: 2 },
        ],
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "fade-video-black",
    tier: 1,
    run: async (f) => {
      const outputPath = await fadeVideo({
        videoUrl: fixtureUrl(f.clipMp4),
        fadeIn: true,
        fadeInDuration: 0.5,
        fadeOut: true,
        fadeOutDuration: 0.5,
        color: "black",
      })
      return single(outputPath, "video")
    },
  },
  {
    // Silent input exercises fade-video's no-audio fallback retry (-an path).
    name: "fade-video-white-silent",
    tier: 1,
    run: async (f) => {
      const outputPath = await fadeVideo({
        videoUrl: fixtureUrl(f.clipSilentMp4),
        fadeIn: false,
        fadeInDuration: 0,
        fadeOut: true,
        fadeOutDuration: 0.5,
        color: "white",
      })
      return single(outputPath, "video")
    },
  },
]

const tier2: CharacterizedOperation[] = [
  {
    name: "resize-video-crop-9x16",
    tier: 2,
    run: async (f) => {
      const outputPath = await resizeVideo({
        videoUrl: fixtureUrl(f.clipMp4),
        targetAspect: "9:16",
        method: "crop",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "resize-video-pad-1x1",
    tier: 2,
    run: async (f) => {
      const outputPath = await resizeVideo({
        videoUrl: fixtureUrl(f.clipPortraitMp4),
        targetAspect: "1:1",
        method: "pad",
        padColor: "#336699",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "resize-video-stretch-4x5",
    tier: 2,
    run: async (f) => {
      const outputPath = await resizeVideo({
        videoUrl: fixtureUrl(f.clipMp4),
        targetAspect: "4:5",
        method: "stretch",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "social-media-format-video",
    tier: 2,
    run: async (f) => {
      const outputPath = await socialMediaFormat({
        mediaUrl: fixtureUrl(f.clipMp4),
        mediaType: "video",
        width: 480,
        height: 480,
        method: "crop",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "social-media-format-image",
    tier: 2,
    run: async (f) => {
      const outputPath = await socialMediaFormat({
        mediaUrl: fixtureUrl(f.framePng),
        mediaType: "image",
        width: 500,
        height: 500,
        method: "pad",
        padColor: "#ff0000",
      })
      return single(outputPath, "image")
    },
  },
  {
    // drawtext with escaping-sensitive characters; font comes from fontconfig
    // (the production image installs fonts-dejavu-core/fonts-liberation).
    name: "add-captions-subtitle",
    tier: 2,
    run: async (f) => {
      const outputPath = await addCaptions({
        videoUrl: fixtureUrl(f.clipMp4),
        text: "Hello: it's a test",
        position: "bottom",
        fontSize: 24,
        color: "#FFFFFF",
        style: "subtitle",
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "add-captions-karaoke-box",
    tier: 2,
    run: async (f) => {
      const outputPath = await addCaptions({
        videoUrl: fixtureUrl(f.clipMp4),
        text: "Boxed caption",
        position: "top",
        fontSize: 32,
        color: "#FFDD00",
        style: "karaoke",
      })
      return single(outputPath, "video")
    },
  },
]

const tier3: CharacterizedOperation[] = [
  {
    name: "combine-audio-segments",
    tier: 3,
    run: async (f) => {
      const outputPath = await combineAudio({
        segments: [
          { url: fixtureUrl(f.toneWav), startTime: 0.2, endTime: 1.5 },
          { url: fixtureUrl(f.noiseWav), endTime: 1.0 },
        ],
      })
      return single(outputPath, "audio")
    },
  },
  {
    name: "extract-audio",
    tier: 3,
    run: async (f) => {
      const { audioPath } = await extractAudio({ videoUrl: fixtureUrl(f.clipMp4) })
      return single(audioPath, "audio")
    },
  },
  {
    name: "extract-audio-track",
    tier: 3,
    run: async (f) => {
      const { audioPath, workDir } = await extractAudioTrack(fixtureUrl(f.clipMp4))
      return { outputs: [{ label: "out", path: audioPath, kind: "audio" }], cleanupDirs: [workDir] }
    },
  },
  {
    name: "trim-audio-wav",
    tier: 3,
    run: async (f) => {
      const { audioPath } = await trimAudio({
        videoUrl: fixtureUrl(f.clipMp4),
        audioFormat: "wav",
        startTime: 0.5,
        endTime: 2,
      })
      return single(audioPath, "audio")
    },
  },
  {
    name: "trim-video-plain",
    tier: 3,
    run: async (f) => {
      const { videoPath } = await trimVideo({
        videoUrl: fixtureUrl(f.clipMp4),
        startTime: 0.5,
        endTime: 2.5,
      })
      return single(videoPath, "video")
    },
  },
  {
    // keepLastSeconds exercises the ffprobe-metadata trim path.
    name: "trim-video-keep-last",
    tier: 3,
    run: async (f) => {
      const { videoPath } = await trimVideo({
        videoUrl: fixtureUrl(f.clipMp4),
        startTime: 0,
        keepLastSeconds: 1,
      })
      return single(videoPath, "video")
    },
  },
  {
    // Stream-copy concat: output must be bit-equivalent per segment (no
    // re-encode), so duration/frames are the load-bearing metrics.
    name: "loop-video-repeat",
    tier: 3,
    run: async (f) => {
      const { outputPath } = await loopVideo({
        videoUrl: fixtureUrl(f.clip2Mp4),
        mode: "repeat",
        repeatCount: 2,
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "loop-video-duration",
    tier: 3,
    run: async (f) => {
      const { outputPath } = await loopVideo({
        videoUrl: fixtureUrl(f.clip2Mp4),
        mode: "duration",
        targetDuration: 5,
      })
      return single(outputPath, "video")
    },
  },
  {
    name: "split-media-audio-chunks",
    tier: 3,
    run: async (f) => {
      const { audioPaths } = await splitMedia({
        audioUrl: fixtureUrl(f.toneWav),
        chunkDuration: 2,
      })
      const paths = audioPaths ?? []
      return {
        outputs: paths.map((p, i) => ({ label: `chunk${i}`, path: p, kind: "audio" as const })),
        cleanupDirs: paths.length ? [dirname(paths[0])] : [],
      }
    },
  },
  {
    name: "remove-audio",
    tier: 3,
    run: async (f) => {
      const { videoPath } = await removeAudio({ videoUrl: fixtureUrl(f.clipMp4) })
      return single(videoPath, "video")
    },
  },
  {
    name: "extract-frame-first",
    tier: 3,
    run: async (f) => {
      const { imagePath } = await extractFrame({ videoUrl: fixtureUrl(f.clipMp4), mode: "first" })
      return single(imagePath, "image")
    },
  },
  {
    // "last" probes fps + frame count and seeks half a frame early — the
    // exact seek math this module exists for.
    name: "extract-frame-last",
    tier: 3,
    run: async (f) => {
      const { imagePath } = await extractFrame({ videoUrl: fixtureUrl(f.clipMp4), mode: "last" })
      return single(imagePath, "image")
    },
  },
  {
    // smartLoopCut is the render core behind loop-video's smart path AND
    // apply-smart-loop-cut (whose wrapper is R2-bound and excluded here).
    name: "smart-loop-cut-precise",
    tier: 3,
    run: async (f) => {
      const { videoPath } = await smartLoopCut({
        videoUrl: fixtureUrl(f.clipMp4),
        lookbackFrames: 8,
        quality: "precise",
      })
      return single(videoPath, "video")
    },
  },
]

export const OPERATIONS: readonly CharacterizedOperation[] = [...tier1, ...tier2, ...tier3]
