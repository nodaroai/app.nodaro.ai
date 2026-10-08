/**
 * How long the video a node passes on is, before anything has run — the length
 * rule of EVERY video producer, so a listing can price a length-priced step
 * (Trim, Loop, Combine Videos, Video SFX) on any chain of them and never quote
 * below what a run of that chain is charged (decided 2026-10-07).
 *
 * A rule is an UPPER BOUND on what the node delivers, read from the same
 * functions and catalogs its own run prices with (cited at each rule): a pass-
 * through step is its input's length, a generation its configured duration, an
 * extension its input plus the seconds it adds, an audio-driven step the audio's
 * length capped at the most its run accepts. What a rule cannot bound is
 * `"unknown"`, and says why in {@link UNBOUNDED_LENGTH_REASONS}: the listing then
 * lists a length-priced step at the run's own stand-in (Trim, Loop and Combine
 * Videos: the estimators' 8-second fallback; Video SFX: its 300-second row, the
 * most it accepts).
 *
 * The length a run of the NEXT step reads off a node is its recorded or
 * configured duration, else the estimators' fallback (`extractVideoDurationFromNode`
 * ?? `VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS`, input-resolver.ts), so a
 * length is never listed below that either ({@link floorLength}).
 *
 * The registry is keyed by node type and guarded: `video-output-length.test.ts`
 * fails when a member of `VIDEO_PRODUCER_TYPES` has no rule.
 */
import {
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_MAX_DURATION_SEC,
  AUDIO_PRODUCER_TYPES,
  CINEMATIC_MAX_DURATION_SEC,
  DYNAMIC_PRODUCER_TYPES,
  RENDER_NODE_TYPE_IDS,
  PRO3D_RENDER_LIMITS,
  VIDEO_PRODUCER_TYPES,
  VIDEO_UTIL_PRICING,
  buildMotionCreditModelIdentifier,
  clampCinematicDuration,
  estimateScriptDurationSec,
  extractVideoDurationFromNode,
  getLipSyncMaxAudioSeconds,
  ltxExtendDurationSec,
} from "@nodaro/shared"
import { utilityOutputLength } from "@nodaro/render-rules"
import { seedanceExtendDurationWindow, seedanceExtendGenerationModel } from "./seedance-extend-model.js"
import { generatedVideoLengthSec } from "./generated-video-length.js"
import { generateVideoProLengthSec } from "./generate-video-pro-length.js"

/** A length that does not depend on the episode, plus seconds per minute of it. */
export interface InputLength {
  readonly fixedSec: number
  readonly perEpisodeSec: number
}

/**
 * What a listing knows of a wire's video (or audio): its length; that it cannot
 * be bounded (`"unknown"`: a recording the user replaces that is not the
 * episode, or a step whose length no rule bounds); or nothing (`undefined`: no
 * wire, a cycle, or a node that is not media).
 */
export type WireLength = InputLength | "unknown" | undefined

/** The medium a wire carries, by the type of the node it leaves. */
export type WireKind = "video" | "audio" | "other"

/** One wire into a node, with the length of what it carries. */
export interface WireInput {
  /** The id of the node the wire leaves (a track setting is keyed by it). */
  readonly sourceId: string
  readonly handle: string | null | undefined
  readonly kind: WireKind
  readonly length: WireLength
}

export interface LengthNode {
  readonly id: string
  readonly type: string
  readonly data?: unknown
}

/** How a node's output length is decided. */
export interface OutputLengthRule {
  /**
   * `recording`: read off the recording itself (credits.ts: uploads and their
   * kin). `render`: the render's own estimate (`resolveApplyEdlEstimateLength`).
   * `rule`: {@link run}, from the node's data and its input wires' lengths.
   */
  readonly via: "recording" | "render" | "rule"
  readonly run?: (node: LengthNode, inputs: readonly WireInput[]) => WireLength
}

export const knownLength = (l: WireLength): InputLength | undefined => (typeof l === "object" ? l : undefined)

const fixed = (sec: number): InputLength => ({ fixedSec: Math.max(0, sec), perEpisodeSec: 0 })
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}
const dataOf = (node: LengthNode): Record<string, unknown> => (node.data ?? {}) as Record<string, unknown>

/** Component-wise larger of two lengths: never below either, at every episode length. */
function maxLen(a: InputLength, b: InputLength): InputLength {
  return { fixedSec: Math.max(a.fixedSec, b.fixedSec), perEpisodeSec: Math.max(a.perEpisodeSec, b.perEpisodeSec) }
}
const scaleLen = (l: InputLength, k: number): InputLength => ({ fixedSec: l.fixedSec * k, perEpisodeSec: l.perEpisodeSec * k })
const addSec = (l: InputLength, sec: number): InputLength => ({ fixedSec: l.fixedSec + sec, perEpisodeSec: l.perEpisodeSec })
/** At most `cap` seconds: a length that follows the episode may exceed it, so it lists at the cap. */
const capped = (l: InputLength, cap: number): InputLength => (l.perEpisodeSec > 0 ? fixed(cap) : fixed(Math.min(l.fixedSec, cap)))

/** The handles that name a medium on a node that has one per medium (Lip Sync: image, video, audio). */
const MEDIUM_HANDLES: ReadonlySet<string> = new Set(["video", "audio", "image"])

/**
 * The wire on `handle`, else the first wire carrying `kind`: a handle names the
 * medium where the node has one per medium; a shared `in` handle falls back to
 * the source's kind. The fallback never takes a wire that sits on ANOTHER
 * medium's handle: a dynamic step (Adjust Volume, Voice Changer Pro) is a
 * `"video"` wire by its type even when it carries audio, and on the `audio`
 * handle it is the audio, whatever its kind says.
 */
const wireOf = (inputs: readonly WireInput[], kind: WireKind, handle?: string): WireInput | undefined =>
  (handle ? inputs.find((i) => i.handle === handle) : undefined) ??
  inputs.find((i) => i.kind === kind && !(handle && i.handle && i.handle !== handle && MEDIUM_HANDLES.has(i.handle)))
/** The video wire's length; `"unknown"` for a wire the listing has no length for, or none. */
const videoIn = (inputs: readonly WireInput[], handle = "video"): WireLength => wireOf(inputs, "video", handle)?.length ?? "unknown"
const audioIn = (inputs: readonly WireInput[], handle = "audio"): WireLength => wireOf(inputs, "audio", handle)?.length
/** The first wire whose length the listing knows anything about (a recording the user replaces counts). */
const firstDefined = (inputs: readonly WireInput[]): WireLength => inputs.map((i) => i.length).find((l) => l !== undefined)

/** A step that delivers its input's video, whole. */
const passVideo: OutputLengthRule = { via: "rule", run: (_n, inputs) => videoIn(inputs) }
/** A dual-mode step (video in, video out; or audio in, audio out) that keeps whichever it is given. */
const passMedia: OutputLengthRule = { via: "rule", run: (_n, inputs) => (inputs.find((i) => i.kind === "video") ?? inputs.find((i) => i.kind === "audio"))?.length ?? "unknown" }

/** A run's own stitch seam: the plan pads a stitched clip by less than this (generate-video-pro-length.ts). */
const STITCH_SLACK_SEC = 1

/** Why a node's output cannot always be bounded, for the nodes that declare it. */
export const UNBOUNDED_LENGTH_REASONS: Readonly<Record<string, string>> = {
  "youtube-video": "a pasted link the user cannot replace and that carries no length: its length is the video's, which a run reads at download (a link the user replaces is the episode, per minute)",
  "extend-video": "VEO and Runway extend add a length the catalog does not declare",
  "suno-music-video": "the song's length: a Suno task id carries none",
  "speech-to-video": "its length is the audio's, and a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length before the run",
  "slideshow": "with an audio wired its length is the audio's, which a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length for before the run",
  "still-to-video": "its length is the audio's, and a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length before the run",
  "gif-to-video": "its length is the GIF's, which only the file says",
  "render-video": "its length is the upstream composition plan's, which the node does not carry",
  "manual-edit": "its length is the timeline the user cuts",
  "merge-video-audio": "it ends with its longest track, and an audio with no length before the run (a generated voice whose script comes from a source with no known length) may be longer than the video",
  "assemble-narrated-video": "each block lasts as long as its narration, which has no length before the run when its script is written at run time",
  "list": "fans out an unknown count of items",
  "sub-workflow": "its length is its inner workflow's",
  "reduce": "its length is its inputs' combined, an unknown count",
}

// ── The rules ──────────────────────────────────────────────────────────────

/** The extension Extend Video adds, by provider: `ltxExtendDurationSec` and the Seedance extend tier (`data.duration ?? 8`, snapped into the model's window: seedance-extend-model.ts). */
function extendLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const data = dataOf(node)
  const provider = (data.provider as string | undefined) ?? "veo-extend"
  const input = knownLength(videoIn(inputs))
  if (!input) return "unknown"
  if (provider === "ltx-2.3-pro") return addSec(input, ltxExtendDurationSec(data.duration))
  if (provider === "seedance-2-extend") {
    // What the worker generates: the duration (8 s unset) snapped into the model's window (video-ai.ts).
    const window = seedanceExtendDurationWindow(seedanceExtendGenerationModel())
    return addSec(input, Math.min(window.max, Math.max(window.min, Math.round(num(data.duration) ?? 8))))
  }
  return "unknown"
}

/** Lip Sync: the audio's length, capped at the most its provider takes (`getLipSyncMaxAudioSeconds`, trimmed server-side); a video-driven mode renders the video's. */
function lipSyncLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const cap = getLipSyncMaxAudioSeconds(((dataOf(node).provider as string | undefined) ?? "kling-avatar"))
  const audio = knownLength(audioIn(inputs))
  const audioBound = audio ? capped(audio, cap) : fixed(cap)
  const videoWire = wireOf(inputs, "video", "video")
  if (!videoWire) return audioBound
  const video = knownLength(videoWire.length)
  return video ? maxLen(audioBound, video) : "unknown"
}

/** AI Avatar: a text script's estimated reading (`estimateScriptDurationSec`, the run's own reserve; the ceiling when the script is wired in or has a `{Label}` in it), or an audio capped at the worker's trim. */
function aiAvatarLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const data = dataOf(node)
  if ((data.speechMode ?? "text") === "text") {
    const script = typeof data.script === "string" ? data.script : ""
    const open = inputs.some((i) => i.handle === "script") || /\{[^{}]+\}/.test(script)
    return fixed(open ? AI_AVATAR_MAX_DURATION_SEC : Math.min(AI_AVATAR_MAX_DURATION_SEC, estimateScriptDurationSec(script, num(data.voiceSpeed) || 1)))
  }
  const audio = knownLength(audioIn(inputs))
  return audio ? capped(audio, AI_AVATAR_MAX_AUDIO_SEC) : fixed(AI_AVATAR_MAX_AUDIO_SEC)
}

/**
 * The longest reference video Motion Transfer prices: the top tier of the credit
 * id its run reserves (`MOTION_DURATION_TIERS` is not part of the package's
 * public surface, so the id says it: `motion-transfer:30s`).
 */
export function motionTransferCeilingSec(): number {
  const top = /:(\d+)s$/.exec(buildMotionCreditModelIdentifier("kling", "720p", Number.MAX_SAFE_INTEGER))
  return top ? Number(top[1]) : Number.POSITIVE_INFINITY
}

/** Motion Transfer: the driving video's length, at most the longest tier its run prices. */
function motionTransferLength(_node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const ceiling = motionTransferCeilingSec()
  const video = knownLength(videoIn(inputs))
  return video ? capped(video, ceiling) : fixed(ceiling)
}

/** Video to Video: its input's length, or the 5 or 10 seconds the node is set to render when longer. */
function videoToVideoLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const data = dataOf(node)
  const input = knownLength(videoIn(inputs))
  if (!input) return "unknown"
  const set = Math.max(0, num(data.v2vDuration) ?? 0, num(data.videoEditDuration) ?? 0)
  return maxLen(input, fixed(set))
}

/** Speed Ramp: its input over the constant speed; with ramps, the input plus what each slowed segment adds. */
function speedRampLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const data = dataOf(node)
  const input = knownLength(videoIn(inputs))
  if (!input) return "unknown"
  const ramps = Array.isArray(data.ramps) ? (data.ramps as ReadonlyArray<Record<string, unknown>>) : []
  if (ramps.length > 0) {
    const added = ramps.reduce((sum, r) => {
      const start = num(r.start) ?? 0
      const end = num(r.end) ?? start
      const speed = Math.max(0.05, num(r.speed) ?? 1)
      return speed < 1 ? sum + Math.max(0, end - start) * (1 / speed - 1) : sum
    }, 0)
    return addSec(input, added)
  }
  const speed = Math.min(100, Math.max(0.05, num(data.speed) ?? 1))
  return scaleLen(input, 1 / speed)
}

/** Merge Video Audio: the video, or the end of the longest audio track (its start plus its length) when later. */
function mergeVideoAudioLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const trackSettings = (dataOf(node).trackSettings as Record<string, Record<string, unknown> | undefined> | undefined) ?? {}
  const media = inputs.filter((i) => i.kind !== "other")
  // Two wires typed "video" mean one of them is an audio that left a dynamic step (the wire's type
  // cannot say which): bound by every wire at its own start offset, whichever is the video.
  const ambiguous = media.filter((i) => i.kind === "video").length > 1
  const video = ambiguous ? undefined : wireOf(inputs, "video")
  const videoLength = ambiguous ? fixed(0) : knownLength(video?.length)
  if (!videoLength) return "unknown"
  const tracks = media.filter((i) => i !== video)
  let out = videoLength
  for (const track of tracks) {
    const l = knownLength(track.length)
    if (!l) return "unknown"
    out = maxLen(out, addSec(l, Math.max(0, num(trackSettings[track.sourceId]?.startTime) ?? 0)))
  }
  return out
}

/** Assemble Narrated Video: each block lasts its clip or its narration, whichever is longer, paired in wire order. */
function assembleNarratedLength(_node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const videos = inputs.filter((i) => i.handle === "video" || (i.handle !== "audio" && i.kind === "video"))
  const audios = inputs.filter((i) => i.handle === "audio" || (i.handle !== "video" && i.kind === "audio"))
  if (videos.length === 0) return "unknown"
  let total: InputLength = fixed(0)
  for (let i = 0; i < videos.length; i++) {
    const v = knownLength(videos[i]!.length)
    const a = audios[i] ? knownLength(audios[i]!.length) : undefined
    if (!v || (audios[i] && !a)) return "unknown"
    const block = a ? maxLen(v, a) : v
    total = { fixedSec: total.fixedSec + block.fixedSec, perEpisodeSec: total.perEpisodeSec + block.perEpisodeSec }
  }
  return total
}

/** The most images a Slideshow takes (routes/slideshow.ts: `imageUrls ... .max(100)`). */
export const SLIDESHOW_MAX_IMAGES = 100

/** Slideshow: the audio's length when one is wired (the audio IS the total); else its images, at most 100, at their longest slot. */
function slideshowLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const data = dataOf(node)
  const audioWire = wireOf(inputs, "audio", "audio")
  if (audioWire) return knownLength(audioWire.length) ?? "unknown"
  const pins = Array.isArray(data.imageDurations) ? (data.imageDurations as unknown[]).map(num).filter((n): n is number => n !== undefined) : []
  const perImage = Math.max(num(data.perImageDuration) ?? 3, ...pins)
  return fixed(SLIDESHOW_MAX_IMAGES * perImage)
}

/** 3D Render Pro: the render's own duration ceiling (`PRO3D_RENDER_LIMITS`). */
function pro3dRenderLength(): WireLength {
  return fixed(PRO3D_RENDER_LIMITS.maxDurationSeconds)
}

/** Split into Chunks: no chunk is longer than the chunk length, nor than its input. */
function splitMediaLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const chunk = num(dataOf(node).chunkDuration)
  const input = knownLength((inputs.find((i) => i.kind === "video") ?? inputs.find((i) => i.kind === "audio"))?.length)
  if (input) return chunk ? capped(input, chunk) : input
  return chunk ? fixed(chunk) : "unknown"
}

/**
 * Trim, Loop, Combine Videos and Video SFX pass on the length `@nodaro/render-rules`
 * says (`utilityOutputLength`): the one rule the run estimates and the editor read
 * too, so the three cannot drift. Only the wire vocabulary differs: a wire the
 * listing cannot bound is `"unknown"` here, `"replaced-unknown"` there.
 */
function utilityLength(node: LengthNode, inputs: readonly WireInput[]): WireLength {
  const out = utilityOutputLength(
    node,
    inputs.map((i) => ({ targetHandle: i.handle })),
    inputs.map((i) => (i.length === "unknown" ? "replaced-unknown" : i.length)),
  )
  return out === "replaced-unknown" ? "unknown" : out
}

/**
 * The length rule of every node that delivers a video. Every member of
 * `VIDEO_PRODUCER_TYPES` is a key (guarded), plus the dual-mode steps that can
 * deliver one.
 */
export const VIDEO_OUTPUT_LENGTH_RULES: Readonly<Record<string, OutputLengthRule>> = {
  // Recordings and renders: read off the file / the render's own estimate (credits.ts).
  "upload-video": { via: "recording" },
  "youtube-video": { via: "recording" },
  ...Object.fromEntries(RENDER_NODE_TYPE_IDS.map((type) => [type, { via: "render" } as OutputLengthRule])),

  // Generations: the configured duration, by the rule the run prices it by (generated-video-length.ts).
  "generate-video": { via: "rule", run: (n) => fixed(generatedVideoLengthSec(n) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS) },
  "image-to-video": { via: "rule", run: (n) => fixed(generatedVideoLengthSec(n) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS) },
  "text-to-video": { via: "rule", run: (n) => fixed(generatedVideoLengthSec(n) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS) },
  "generate-video-pro": {
    via: "rule",
    run: (n) => {
      const data = dataOf(n)
      return fixed(generateVideoProLengthSec((data.provider as string | undefined) ?? "seedance-2", num(data.duration)))
    },
  },
  "cinematic-avatar": {
    via: "rule",
    run: (n) => {
      const data = dataOf(n)
      return fixed(data.autoDuration === true ? CINEMATIC_MAX_DURATION_SEC : clampCinematicDuration(num(data.duration)))
    },
  },
  "pro-3d-render": { via: "rule", run: pro3dRenderLength },

  // The four length-priced steps: each passes a length on (the same functions as the listing's own chains).
  "trim-video": { via: "rule", run: utilityLength },
  "loop-video": { via: "rule", run: utilityLength },
  "combine-videos": { via: "rule", run: utilityLength },
  "video-sfx": { via: "rule", run: utilityLength },

  // Steps that keep their input's length.
  "add-captions": passVideo,
  "resize-video": passVideo,
  "social-media-format": passVideo,
  "fade-video": passVideo,
  "transcode-video": passVideo,
  "remove-audio": passVideo,
  "video-overlay": passVideo,
  "switchx": passVideo,
  "video-upscale": passVideo,
  "face-swap": passVideo,
  "video-retake": passVideo,
  "adjust-volume": passMedia,
  "voice-changer": passMedia,
  "voice-changer-pro": passMedia,
  "dubbing": passMedia,
  // The replaced span is regenerated from segments the plan pads by a seam (STITCH_SLACK_SEC).
  "edit-video-pro": { via: "rule", run: (_n, inputs) => { const l = knownLength(videoIn(inputs)); return l ? addSec(l, STITCH_SLACK_SEC) : "unknown" } },

  // Steps with their own length rule.
  "video-to-video": { via: "rule", run: videoToVideoLength },
  "motion-transfer": { via: "rule", run: motionTransferLength },
  "extend-video": { via: "rule", run: extendLength },
  "lip-sync": { via: "rule", run: lipSyncLength },
  "ai-avatar": { via: "rule", run: aiAvatarLength },
  "speed-ramp": { via: "rule", run: speedRampLength },
  "merge-video-audio": { via: "rule", run: mergeVideoAudioLength },
  "assemble-narrated-video": { via: "rule", run: assembleNarratedLength },
  "slideshow": { via: "rule", run: slideshowLength },
  "split-media": { via: "rule", run: splitMediaLength },

  // Audio-driven steps whose audio has no length before the run (UNBOUNDED_LENGTH_REASONS).
  "speech-to-video": { via: "rule", run: (_n, inputs) => knownLength(audioIn(inputs)) ?? "unknown" },
  "still-to-video": { via: "rule", run: (_n, inputs) => knownLength(audioIn(inputs)) ?? "unknown" },
  "suno-music-video": { via: "rule", run: () => "unknown" },

  // Nodes no rule can bound (UNBOUNDED_LENGTH_REASONS).
  "gif-to-video": { via: "rule", run: () => "unknown" },
  "render-video": { via: "rule", run: () => "unknown" },
  "manual-edit": { via: "rule", run: () => "unknown" },
  "list": { via: "rule", run: () => "unknown" },
  "sub-workflow": { via: "rule", run: () => "unknown" },
  "reduce": { via: "rule", run: () => "unknown" },
}

/** The steps that deliver their input's video whole (pinned by the listing's chain guard). */
export const PASS_THROUGH_VIDEO_TYPES: readonly string[] = Object.entries(VIDEO_OUTPUT_LENGTH_RULES)
  .filter(([, rule]) => rule === passVideo)
  .map(([type]) => type)

/** The nodes whose length is a listing's to decide, beyond `VIDEO_PRODUCER_TYPES`: the dual-mode and dynamic steps that can deliver a video. */
export const DYNAMIC_VIDEO_OUTPUT_TYPES: readonly string[] = [
  "adjust-volume",
  "voice-changer",
  "voice-changer-pro",
  "dubbing",
  "split-media",
  ...RENDER_NODE_TYPE_IDS,
  "list",
  "sub-workflow",
  "reduce",
]

/** The longest a generated voice is listed at: past it the listing stops following the script. */
export const GENERATED_VOICE_MAX_SEC = 300

/**
 * Characters a second a logographic or syllabic script is spoken at (Chinese,
 * Japanese, Korean): the slow end of their real range (about 4 to 6), so a
 * listing is biased high, as the Latin rate is. Decided 2026-10-07.
 */
export const SLOW_SCRIPT_CHARS_PER_SEC = 4
/** The Latin rate `estimateScriptDurationSec` reads: 12 characters a second at normal speed. */
const LATIN_CHARS_PER_SEC = 12
/** The slowest a Text to Speech node speaks (its speed slider's floor): what an unreadable or mapped speed is listed at. */
export const SLOWEST_VOICE_SPEED = 0.7

/** Han, kana and Hangul: the scripts spoken slower than {@link SLOW_SCRIPT_CHARS_PER_SEC}'s Latin rate allows for. */
const SLOW_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

/** How many characters of `text` are in a slow script. */
export function slowScriptChars(text: string): number {
  return text.match(SLOW_SCRIPT)?.length ?? 0
}

/**
 * What a speech estimate (`speechEstimateChars`) says of a generated voice's
 * script: its character count, whether that is the literal text the run sends,
 * and the model's per-request cap (what an unreadable text is counted at). With
 * the traits that change how long it takes to speak: the node's speed (1 when
 * unset) and how many of the characters are in a slow script.
 */
export interface SpokenScript {
  readonly chars: number
  readonly exact: boolean
  readonly cap: number
  /** The voice's speed, 0.7 to 1.2; absent = 1. */
  readonly speed?: number
  /** Of `chars`, those in a slow script (counted from a literal text only). */
  readonly slowChars?: number
  /**
   * `chars` is an upper bound on a script an LLM writes at run time (the tokens
   * its node can write x 8 characters, `llmScriptChars`), not the literal text:
   * the listing follows it even when it reaches the model's cap.
   */
  readonly bounded?: boolean
}

/**
 * How long a generated voice (Text to Speech, Text to Dialogue) is listed at
 * (decided 2026-10-07): the seconds its script takes to read, at most
 * {@link GENERATED_VOICE_MAX_SEC}. The rate is `estimateScriptDurationSec`'s
 * (12 characters a second at normal speed, biased high: the AI Avatar reserve's
 * own), the one characters-to-seconds rule the platform has, at the node's own
 * speed (a slower voice runs longer: an unreadable speed is the slider's floor,
 * 0.7), with each character of a slow script (Chinese, Japanese, Korean) counted
 * at {@link SLOW_SCRIPT_CHARS_PER_SEC}. A script is counted when it is the literal
 * text the run sends, or when an exposed input's character limit bounds it below
 * the model's cap. A script written at run time by anything else (a wired text)
 * is counted at the cap, which is no bound: `undefined`, so the step after it is
 * listed as it was before any voice rule (Lip Sync at its provider's cap, Merge
 * Video Audio and the length-priced steps at their own stand-ins). A script an
 * LLM node writes is the exception (decided 2026-10-07): it is bounded at what
 * that node can write, `maxTokens` x 8 characters (`bounded`), read at the same
 * rate and the same 300-second ceiling.
 */
export function generatedVoiceLength(script: SpokenScript): InputLength | undefined {
  if (!script.exact && !script.bounded && script.chars >= script.cap) return undefined
  const chars = Math.max(0, script.chars)
  const slow = Math.min(chars, Math.max(0, script.slowChars ?? 0))
  // A slow character takes as long as (12 / 4) Latin ones: one count the shared estimate reads.
  const equivalent = chars - slow + Math.ceil(slow * (LATIN_CHARS_PER_SEC / SLOW_SCRIPT_CHARS_PER_SEC))
  return fixed(Math.min(GENERATED_VOICE_MAX_SEC, estimateScriptDurationSec("x".repeat(equivalent), script.speed ?? 1)))
}

/** The medium a wire carries, from the type of the node it leaves. */
export function wireKindOf(type: string | undefined): WireKind {
  if (!type) return "other"
  if (VIDEO_PRODUCER_TYPES.has(type) || DYNAMIC_PRODUCER_TYPES.has(type)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(type)) return "audio"
  return "other"
}

/**
 * A fixed length is never listed below the length a run reads off this node
 * (`extractVideoDurationFromNode`, else the estimators' fallback): that is what
 * the step after it is charged at. A length that follows the episode is left
 * to its per-minute figure.
 */
export function floorLength(length: WireLength, data: unknown): WireLength {
  if (typeof length !== "object" || length.perEpisodeSec > 0) return length
  const read = extractVideoDurationFromNode(data as Record<string, unknown> | undefined) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  return length.fixedSec >= read ? length : fixed(read)
}

/**
 * The length a node delivers: its rule (above), floored. `undefined` when the
 * node has no rule or reads its length off a recording or a render, which the
 * caller decides.
 */
export function videoOutputLength(node: LengthNode, inputs: readonly WireInput[]): WireLength | "no-rule" {
  const rule = VIDEO_OUTPUT_LENGTH_RULES[node.type]
  if (!rule || rule.via !== "rule" || !rule.run) return "no-rule"
  return floorLength(rule.run(node, inputs), node.data)
}
