/**
 * How long the video a node passes on is, before anything has run — the length
 * rule of every video producer, read by the published-app listing (backend
 * `lib/video-output-length.ts`, which composes the node units' rows in and
 * floors each length) and by the measured walk ({@link measuredWireLengthSec},
 * the run estimates of Mask Composite and Video Overlay, whose runs measure the
 * file they are given). One table, so the three cannot drift (decided
 * 2026-10-07 for the listing; shared with the run estimates since).
 *
 * A rule is an UPPER BOUND on what the node delivers, read from the same
 * functions and catalogs its own run prices with (cited at each rule): a pass-
 * through step is its input's length, a generation its configured duration, an
 * extension its input plus the seconds it adds, an audio-driven step the audio's
 * length capped at the most its run accepts. What a rule cannot bound is
 * `"unknown"`, and says why in {@link VIDEO_LENGTH_UNBOUNDED_REASONS}.
 *
 * The node units with the "length:unknown" capability are not rows here: the
 * backend composes them in from the unit descriptors. To the walk, a type with
 * no row reads unknown, as their rule does.
 */
import {
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_MAX_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  buildMotionCreditModelIdentifier,
  clampCinematicDuration,
  estimateScriptDurationSec,
  getLipSyncMaxAudioSeconds,
  grokExtendSeconds,
  lipSyncAudioRateOf,
  ltxExtendDurationSec,
} from "@nodaro/shared/credits"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, RENDER_NODE_TYPE_IDS, VIDEO_PRODUCER_TYPES, settingsProviderModels } from "@nodaro/shared/nodes"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { canonicalVideoProvider, DEFAULT_VIDEO_TO_VIDEO_PROVIDER, isGrokExtendProvider, isPixverseExtendProvider, isSeedanceVideoEditProvider, pricedOutputDurationSec, SEEDANCE_VIDEO_EDIT_SHAPE, SEEDANCE_VIDEO_EDIT_TASK_TYPE } from "@nodaro/shared/models"
import { PRO3D_RENDER_LIMITS } from "@nodaro/shared/scene3d"
import { maskCompositeLeadHandle } from "@nodaro/shared/media"
import { referenceModalityForHandle } from "@nodaro/shared/workflow"
import {
  GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC,
  generatedVideoRenderedSec,
  generateVideoProLengthSec,
  isTailRecipeProvider,
  pixverseExtendSeconds,
  referenceClipOutputSec,
  tailRecipeSeconds,
} from "./generated-video-length"
import { LENGTH_KEEPING_VIDEO_TYPES } from "./kept-length"
import { lengthFollowingBoundSec } from "./length-following-video"
import { EXTEND_VIDEO_DEFAULT_PROVIDER, LIP_SYNC_DEFAULT_PROVIDER } from "./node-default-models"
import { seedanceTaskTypeAsRun } from "./seedance-task-type-as-run"
import { USE_CASE_NODE_TYPES } from "./use-case-graph"
import { usecaseDescriptor, type UseCaseOutputLength } from "./use-case-registry"
import { utilityOutputLength, type InputLength } from "./utility-wire-length"

/**
 * What a listing knows of a wire's video (or audio): its length; that it cannot
 * be bounded (`"unknown"`: a recording the user replaces that is not the
 * episode, or a step whose length no rule bounds); or nothing (`undefined`: no
 * wire, a cycle, or a node that is not media).
 */
export type OutputWireLength = InputLength | "unknown" | undefined

/** The medium a wire carries, by the type of the node it leaves. */
export type OutputWireKind = "video" | "audio" | "other"

/** One wire into a node, with the length of what it carries. */
export interface OutputWireInput {
  /** The id of the node the wire leaves (a track setting is keyed by it). */
  readonly sourceId: string
  readonly handle: string | null | undefined
  readonly kind: OutputWireKind
  readonly length: OutputWireLength
}

export interface OutputLengthNode {
  readonly id: string
  readonly type: string
  readonly data?: unknown
}

/** What a reading knows beyond a node and its wires. Absent: the listing's reading. */
export interface OutputLengthContext {
  /** The deployment's Generate Video Pro cap (the server's env; default {@link GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC}). */
  readonly generateVideoProCapSec?: number
  /**
   * The reading is of what a step that MEASURES its input will be given (the
   * measured walk): a generation reads the duration its run fills when none is
   * set, and a model whose output follows its reference clip reads up to the
   * clip (`generatedVideoRenderedSec`). The listing leaves both off: the steps
   * it prices by these lengths are charged the forwarded length instead.
   */
  readonly measured?: boolean
  /**
   * The length-deciding fields (`duration`, `provider`) a run sets from a
   * source whose value is not known before it runs — a field mapping or a
   * `field-<key>` wire from a node that is not a parameter node. The measured
   * walk names them; a generation then reads the most its run can render
   * whatever the value turns out to be. A parameter node's value (a Duration,
   * a Provider) is known: the walk writes it into the node's data instead.
   */
  readonly openFields?: ReadonlySet<string>
}

/** How a node's output length is decided. */
export interface OutputLengthRule {
  /**
   * `recording`: read off the recording itself (uploads and their kin).
   * `render`: the render's own estimate (`resolveApplyEdlEstimateLength`).
   * `rule`: {@link run}, from the node's data and its input wires' lengths.
   */
  readonly via: "recording" | "render" | "rule"
  readonly run?: (node: OutputLengthNode, inputs: readonly OutputWireInput[], ctx?: OutputLengthContext) => OutputWireLength
  /**
   * The row only passes its inputs' lengths on — whole, cut, joined, or the
   * longest of them — and makes no clip of its own (a step that keeps its
   * input's length, Trim / Loop / Combine Videos, a mix or a merge). The
   * measured walk adds a measuring step's slack to every OTHER node it reads
   * by its row (each makes a new clip that can run a frame past its planned
   * length); a carrier's inputs bring theirs. Absent: the node makes a clip.
   */
  readonly carries?: true
}

/** The length, when the wire has one. */
export const knownOutputLength = (l: OutputWireLength): InputLength | undefined => (typeof l === "object" ? l : undefined)

const fixed = (sec: number): InputLength => ({ fixedSec: Math.max(0, sec), perEpisodeSec: 0 })
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}
const dataOf = (node: OutputLengthNode): Record<string, unknown> => (node.data ?? {}) as Record<string, unknown>

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
const wireOf = (inputs: readonly OutputWireInput[], kind: OutputWireKind, handle?: string): OutputWireInput | undefined =>
  (handle ? inputs.find((i) => i.handle === handle) : undefined) ??
  inputs.find((i) => i.kind === kind && !(handle && i.handle && i.handle !== handle && MEDIUM_HANDLES.has(i.handle)))
/** The video wire's length; `"unknown"` for a wire the listing has no length for, or none. */
const videoIn = (inputs: readonly OutputWireInput[], handle = "video"): OutputWireLength => wireOf(inputs, "video", handle)?.length ?? "unknown"
const audioIn = (inputs: readonly OutputWireInput[], handle = "audio"): OutputWireLength => wireOf(inputs, "audio", handle)?.length

/**
 * A step that delivers its input's video, whole: its `video` wire's — except a
 * Mask Composite with a pixelate / blur fill, which has no foreground and
 * follows its `background-video` wire (`maskCompositeLeadHandle`, the rule
 * `keptLengthWire` follows too).
 */
const passVideoRun: NonNullable<OutputLengthRule["run"]> = (n, inputs) =>
  n.type === "mask-composite" && maskCompositeLeadHandle(dataOf(n)) === "background-video"
    ? (inputs.find((i) => i.handle === "background-video")?.length ?? "unknown")
    : videoIn(inputs)
const passVideo: OutputLengthRule = { via: "rule", carries: true, run: passVideoRun }

/**
 * The steps that keep their input's length but RE-RENDER the clip through a
 * provider (Face Swap, Video Retake, Video Upscale, SwitchX, Video Mask,
 * Video Depth): the same length
 * rule as {@link passVideo}, but each makes a new clip, which can run a frame
 * past its input — so it is no carrier, and the measured walk adds its slack.
 * A local pass-through (Resize, Fade, …) stays a carrier.
 */
export const CLIP_REMAKING_KEPT_LENGTH_TYPES: ReadonlySet<string> = new Set(["face-swap", "video-retake", "video-upscale", "switchx", "video-mask", "video-depth"])
const remakeVideo: OutputLengthRule = { via: "rule", run: passVideoRun }
for (const t of CLIP_REMAKING_KEPT_LENGTH_TYPES) {
  if (!LENGTH_KEEPING_VIDEO_TYPES.has(t)) throw new Error(`CLIP_REMAKING_KEPT_LENGTH_TYPES: ${t} is not a step that keeps its input's length (LENGTH_KEEPING_VIDEO_TYPES)`)
}
/**
 * A dual-mode step (video in, video out; or audio in, audio out) that keeps
 * whichever it is given and makes a new file of it — a provider's voice or dub
 * (Voice Changer, Voice Changer Pro, Dubbing) or an ffmpeg re-render (Adjust
 * Volume): not a carrier, so the measured walk adds the step's slack once, as
 * for the steps that re-render a clip through a provider
 * (`CLIP_REMAKING_KEPT_LENGTH_TYPES`). Its file can run a little past its
 * input (Adjust Volume's loudness pass on an AAC input: a few milliseconds).
 */
const remakeMedia: OutputLengthRule = { via: "rule", run: (_n, inputs) => (inputs.find((i) => i.kind === "video") ?? inputs.find((i) => i.kind === "audio"))?.length ?? "unknown" }

/** A run's own stitch seam: the plan pads a stitched clip by less than this (generated-video-length.ts). */
const STITCH_SLACK_SEC = 1

/**
 * The Video to Video node's Seedance edit as a listing reads it for a step
 * CHARGED by the length it is handed (decided 2026-11-11): the edit runs at an
 * automatic length and records what it makes, at most its run's bound
 * (`lengthFollowingBoundSec`), so it is read at that bound and never below its
 * input's length. `undefined` for every other node (the backend's
 * `chargedVideoOutputLength` floors it). Unfloored here.
 */
export function seedanceEditChargedLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength | undefined {
  if (node.type !== "video-to-video") return undefined
  const data = dataOf(node)
  const provider = typeof data.provider === "string" && data.provider !== "" ? data.provider : DEFAULT_VIDEO_TO_VIDEO_PROVIDER
  if (!isSeedanceVideoEditProvider(provider)) return undefined
  const bound = lengthFollowingBoundSec({ provider, duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration })
  if (bound === undefined) return undefined
  return maxLen(knownOutputLength(videoIn(inputs)) ?? fixed(0), fixed(bound))
}

// ── The rules ──────────────────────────────────────────────────────────────

/**
 * A generation: the clip its run renders (`generatedVideoRenderedSec`). Read
 * for a measuring step, with the duration the run fills when none is set and
 * up to a reference clip the output follows.
 */
function generatedLength(node: OutputLengthNode, inputs: readonly OutputWireInput[], ctx?: OutputLengthContext): OutputWireLength {
  const clips = ctx?.measured
    ? inputs.filter((i) => referenceModalityForHandle(i.handle) === "video").map((i) => {
        const l = knownOutputLength(i.length)
        return l && l.perEpisodeSec === 0 ? l.fixedSec : undefined
      })
    : undefined
  const open = ctx?.openFields
  const sec = generatedVideoRenderedSec(
    node,
    ctx?.measured ? { runDefaultDuration: true, referenceClipSecs: clips, openDuration: open?.has("duration"), openProvider: open?.has("provider") } : {},
  )
  return sec === undefined ? "unknown" : fixed(sec)
}

/** The extension Extend Video adds, by provider: `ltxExtendDurationSec`, a tail recipe's seconds (`tailRecipeSeconds`, in the recipe's window), PixVerse V6's (`pixverseExtendSeconds`: its priced 1–15 s, joined onto the source) and Grok's (`grokExtendSeconds`: its 6 or 10 s, from the source's end). */
function extendLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const data = dataOf(node)
  const provider = canonicalVideoProvider((data.provider as string | undefined) ?? EXTEND_VIDEO_DEFAULT_PROVIDER)
  const input = knownOutputLength(videoIn(inputs))
  if (!input) return "unknown"
  if (provider === "ltx-2.3-pro") return addSec(input, ltxExtendDurationSec(data.duration))
  // What the worker generates (video-ai.ts) and the route queues: the same seconds.
  if (isTailRecipeProvider(provider)) return addSec(input, tailRecipeSeconds(provider, data.duration))
  if (isPixverseExtendProvider(provider)) return addSec(input, pixverseExtendSeconds(data.duration))
  if (isGrokExtendProvider(provider)) return addSec(input, grokExtendSeconds(data.duration))
  return "unknown"
}

/**
 * Lip Sync: the audio's length, capped at the most its provider takes
 * (`getLipSyncMaxAudioSeconds`, trimmed server-side — refused past it on a
 * per-second-rate model) and, on a per-second-rate model, at least its minimum
 * (shorter audio is padded with silence to it: OmniHuman 2.0 renders 4 s); a
 * video-driven mode renders the video's.
 */
function lipSyncLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const provider = (dataOf(node).provider as string | undefined) ?? LIP_SYNC_DEFAULT_PROVIDER
  const cap = getLipSyncMaxAudioSeconds(provider)
  const floor = lipSyncAudioRateOf(provider)?.minSeconds ?? 0
  const audio = knownOutputLength(audioIn(inputs))
  const audioBound = audio ? maxLen(capped(audio, cap), fixed(floor)) : fixed(cap)
  const videoWire = wireOf(inputs, "video", "video")
  if (!videoWire) return audioBound
  const video = knownOutputLength(videoWire.length)
  return video ? maxLen(audioBound, video) : "unknown"
}

/** AI Avatar: a text script's estimated reading (`estimateScriptDurationSec`, the run's own reserve; the ceiling when the script is wired in or has a `{Label}` in it), or an audio capped at the worker's trim. */
function aiAvatarLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const data = dataOf(node)
  if ((data.speechMode ?? "text") === "text") {
    const script = typeof data.script === "string" ? data.script : ""
    const open = inputs.some((i) => i.handle === "script") || /\{[^{}]+\}/.test(script)
    return fixed(open ? AI_AVATAR_MAX_DURATION_SEC : Math.min(AI_AVATAR_MAX_DURATION_SEC, estimateScriptDurationSec(script, num(data.voiceSpeed) || 1)))
  }
  const audio = knownOutputLength(audioIn(inputs))
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
function motionTransferLength(_node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const ceiling = motionTransferCeilingSec()
  const video = knownOutputLength(videoIn(inputs))
  return video ? capped(video, ceiling) : fixed(ceiling)
}

/**
 * Video to Video: its input's length, or the 5 or 10 seconds the node is set
 * to render when longer. Read for a measuring step, a Seedance edit model
 * (`isSeedanceVideoEditProvider`) runs an Auto edit of its source clip
 * (`SEEDANCE_VIDEO_EDIT_SHAPE`) — the very edit a Generate Video with that
 * clip on a reference handle runs — so it is bounded by the same rule
 * (`referenceClipOutputSec`): the source rounded up plus a second, at most the
 * model's longest clip; an unknown source at the most the model takes.
 */
function videoToVideoLength(node: OutputLengthNode, inputs: readonly OutputWireInput[], ctx?: OutputLengthContext): OutputWireLength {
  const data = dataOf(node)
  const input = knownOutputLength(videoIn(inputs))
  const provider = data.provider as string | undefined
  if (ctx?.measured && isSeedanceVideoEditProvider(provider)) {
    const clip = input && input.perEpisodeSec === 0 ? input.fixedSec : undefined
    const auto = SEEDANCE_VIDEO_EDIT_SHAPE.duration
    // The lane declares the edit it runs, kept as the run resolves it (a clip the edit cannot take goes out undeclared).
    const run = seedanceTaskTypeAsRun({ provider, duration: auto, data: { referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE }, referenceVideoSec: [clip] })
    const edit = fixed(referenceClipOutputSec(provider, pricedOutputDurationSec(provider, run.duration), run.duration, [clip], run.taskType))
    return input ? maxLen(input, edit) : edit
  }
  if (!input) return "unknown"
  const set = Math.max(0, num(data.v2vDuration) ?? 0, num(data.videoEditDuration) ?? 0)
  return maxLen(input, fixed(set))
}

/**
 * Pitch & Tempo: a video passes through whole (tempo is fixed at 1× for video);
 * audio is stretched by 1 / tempo, so at most twice its input (tempo ≥ 0.5) and
 * never counted shorter than its input — the bound holds whichever tempo a
 * field mapping delivers at run time (providers/video/pitch-tempo.ts).
 */
function pitchTempoLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const video = inputs.find((i) => i.kind === "video")
  if (video) return video.length ?? "unknown"
  const audio = inputs.find((i) => i.kind === "audio")?.length
  const input = knownOutputLength(audio)
  if (!input) return audio ?? "unknown"
  const tempo = num(dataOf(node).tempo)
  const stretch = tempo !== undefined && tempo > 0 ? 1 / Math.min(1, Math.max(0.5, tempo)) : 1
  return { fixedSec: input.fixedSec * stretch, perEpisodeSec: input.perEpisodeSec * stretch }
}

/** Speed Ramp: its input over the constant speed; with ramps, the input plus what each slowed segment adds. */
function speedRampLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const data = dataOf(node)
  const input = knownOutputLength(videoIn(inputs))
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
function mergeVideoAudioLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const trackSettings = (dataOf(node).trackSettings as Record<string, Record<string, unknown> | undefined> | undefined) ?? {}
  const media = inputs.filter((i) => i.kind !== "other")
  // Two wires typed "video" mean one of them is an audio that left a dynamic step (the wire's type
  // cannot say which): bound by every wire at its own start offset, whichever is the video.
  const ambiguous = media.filter((i) => i.kind === "video").length > 1
  const video = ambiguous ? undefined : wireOf(inputs, "video")
  const videoLength = ambiguous ? fixed(0) : knownOutputLength(video?.length)
  if (!videoLength) return "unknown"
  const tracks = media.filter((i) => i !== video)
  let out = videoLength
  for (const track of tracks) {
    const l = knownOutputLength(track.length)
    if (!l) return "unknown"
    out = maxLen(out, addSec(l, Math.max(0, num(trackSettings[track.sourceId]?.startTime) ?? 0)))
  }
  return out
}

/** Assemble Narrated Video: each block lasts its clip or its narration, whichever is longer, paired in wire order. */
function assembleNarratedLength(_node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const videos = inputs.filter((i) => i.handle === "video" || (i.handle !== "audio" && i.kind === "video"))
  const audios = inputs.filter((i) => i.handle === "audio" || (i.handle !== "video" && i.kind === "audio"))
  if (videos.length === 0) return "unknown"
  let total: InputLength = fixed(0)
  for (let i = 0; i < videos.length; i++) {
    const v = knownOutputLength(videos[i]!.length)
    const a = audios[i] ? knownOutputLength(audios[i]!.length) : undefined
    if (!v || (audios[i] && !a)) return "unknown"
    const block = a ? maxLen(v, a) : v
    total = { fixedSec: total.fixedSec + block.fixedSec, perEpisodeSec: total.perEpisodeSec + block.perEpisodeSec }
  }
  return total
}

/** The most images a Slideshow takes (routes/slideshow.ts: `imageUrls ... .max(100)`). */
export const SLIDESHOW_MAX_IMAGES = 100

/** Slideshow: the audio's length when one is wired (the audio IS the total); else its images, at most 100, at their longest slot. */
function slideshowLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const data = dataOf(node)
  const audioWire = wireOf(inputs, "audio", "audio")
  if (audioWire) return knownOutputLength(audioWire.length) ?? "unknown"
  const pins = Array.isArray(data.imageDurations) ? (data.imageDurations as unknown[]).map(num).filter((n): n is number => n !== undefined) : []
  const perImage = Math.max(num(data.perImageDuration) ?? 3, ...pins)
  return fixed(SLIDESHOW_MAX_IMAGES * perImage)
}

/**
 * The longest clip any video model in `MODEL_CATALOG` declares (its `durations`, in
 * seconds), read from the catalog at run time: a model with a longer clip raises it.
 */
export function longestCatalogVideoSec(): number {
  let longest = 0
  for (const model of Object.values(MODEL_CATALOG)) {
    if (model.kind !== "video") continue
    for (const sec of model.durations ?? []) if (Number.isFinite(sec) && sec > longest) longest = sec
  }
  return longest
}

/**
 * UGC Clip: one clip, rendered by a catalog video model at the length its ticket sets,
 * which a listing cannot read: at most {@link longestCatalogVideoSec}.
 */
function ugcClipLength(): OutputWireLength {
  return fixed(longestCatalogVideoSec())
}

/**
 * A use-case node's output length (its spec's `outputLength`, use-case-specs.ts):
 *  - `fixed`: the fixed length, after the input it names when that input is
 *    wired;
 *  - `clock`: the recording the run is clocked to — the Master audio wire's
 *    length when one is wired, else the longest `media` wire's (component-wise,
 *    so it never under-quotes the whole-recording edit).
 * An input whose length the listing does not know leaves the delivery unknown
 * (unknown in, unknown out); a clock with no recording wired is unknown.
 */
export function usecaseLength(len: UseCaseOutputLength, inputs: readonly OutputWireInput[]): OutputWireLength {
  if (len.kind === "clock") {
    const master = inputs.filter((i) => i.handle === "masterAudio")
    const needed = master.length > 0 ? master : inputs.filter((i) => i.handle === "media")
    const lengths = needed.map((i) => knownOutputLength(i.length))
    if (lengths.length === 0 || lengths.some((l) => l === undefined)) return "unknown"
    return (lengths as InputLength[]).reduce(maxLen)
  }
  const base = fixed(len.fixedSec)
  const before = len.after ? inputs.find((i) => i.handle === len.after) : undefined
  if (!before) return base
  const beforeLength = knownOutputLength(before.length)
  return beforeLength ? { fixedSec: base.fixedSec + beforeLength.fixedSec, perEpisodeSec: beforeLength.perEpisodeSec } : "unknown"
}

/** The rule of every use-case node whose spec declares an `outputLength` (no type id: read off the descriptors). */
function usecaseLengthRules(): Record<string, OutputLengthRule> {
  return Object.fromEntries(USE_CASE_NODE_TYPES.flatMap((t) => {
    const len = usecaseDescriptor(t).outputLength
    // A render of what it is given: it carries its recording's length (or its own fixed cut), no clip of a model's.
    return len ? [[t, { via: "rule", carries: true, run: (_n: OutputLengthNode, inputs: readonly OutputWireInput[]) => usecaseLength(len, inputs) } satisfies OutputLengthRule]] : []
  }))
}

/** Split into Chunks: no chunk is longer than the chunk length, nor than its input. */
function splitMediaLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const chunk = num(dataOf(node).chunkDuration)
  const input = knownOutputLength((inputs.find((i) => i.kind === "video") ?? inputs.find((i) => i.kind === "audio"))?.length)
  if (input) return chunk ? capped(input, chunk) : input
  return chunk ? fixed(chunk) : "unknown"
}

/**
 * Trim, Loop, Combine Videos and Video SFX pass on the length
 * `utilityOutputLength` says: the one rule the run estimates and the editor
 * read too, so they cannot drift. Only the wire vocabulary differs: a wire the
 * listing cannot bound is `"unknown"` here, `"replaced-unknown"` there.
 */
function utilityLength(node: OutputLengthNode, inputs: readonly OutputWireInput[]): OutputWireLength {
  const out = utilityOutputLength(
    node,
    inputs.map((i) => ({ targetHandle: i.handle })),
    inputs.map((i) => (i.length === "unknown" ? "replaced-unknown" : i.length)),
  )
  return out === "replaced-unknown" ? "unknown" : out
}

/** Hand-written rows ∪ the use-case rows, refusing a type in both (a type lives in one place). */
function composeRows(rows: Record<string, OutputLengthRule>, usecases: Record<string, OutputLengthRule>): Record<string, OutputLengthRule> {
  const clash = Object.keys(usecases).filter((t) => Object.hasOwn(rows, t))
  if (clash.length > 0) throw new Error(`VIDEO_LENGTH_RULES: ${clash.join(", ")} has a hand-written rule and a use-case spec's outputLength — a type lives in exactly one place`)
  return { ...rows, ...usecases }
}

/**
 * The length rule of every node that delivers a video, but the node units with
 * the "length:unknown" capability (the backend's `VIDEO_OUTPUT_LENGTH_RULES`
 * composes those in, and its guard holds every member of `VIDEO_PRODUCER_TYPES`
 * to a row): the hand-written rules ∪ the use-case nodes whose spec declares an
 * `outputLength` ({@link usecaseLength}); a unit with a "length:pass-video" /
 * "length:exact-video" capability arrives through `LENGTH_KEEPING_VIDEO_TYPES`.
 */
export const VIDEO_LENGTH_RULES: Readonly<Record<string, OutputLengthRule>> = composeRows({
  // Recordings and renders: read off the file / the render's own estimate.
  "upload-video": { via: "recording" },
  "youtube-video": { via: "recording" },
  ...Object.fromEntries(RENDER_NODE_TYPE_IDS.map((type) => [type, { via: "render" } as OutputLengthRule])),

  // Generations: the configured duration, by the rule the run prices it by (generated-video-length.ts).
  "generate-video": { via: "rule", run: generatedLength },
  "image-to-video": { via: "rule", run: generatedLength },
  "text-to-video": { via: "rule", run: generatedLength },
  "generate-video-pro": {
    via: "rule",
    run: (n, _inputs, ctx) => {
      const data = dataOf(n)
      const cap = ctx?.generateVideoProCapSec ?? GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC
      // An open model: every model the node may run; an open duration: the most a run may ask for (measured walk only).
      const providers = ctx?.openFields?.has("provider") ? settingsProviderModels("generate-video-pro") : [(data.provider as string | undefined) ?? "seedance-2"]
      const duration = ctx?.openFields?.has("duration") ? cap : num(data.duration)
      return providers.length === 0 ? "unknown" : fixed(Math.max(...providers.map((p) => generateVideoProLengthSec(p, duration, cap))))
    },
  },
  "cinematic-avatar": {
    via: "rule",
    run: (n) => {
      const data = dataOf(n)
      return fixed(data.autoDuration === true ? CINEMATIC_MAX_DURATION_SEC : clampCinematicDuration(num(data.duration)))
    },
  },
  // 3D Render Pro: the render's own duration ceiling (`PRO3D_RENDER_LIMITS`).
  "pro-3d-render": { via: "rule", run: () => fixed(PRO3D_RENDER_LIMITS.maxDurationSeconds) },
  // One UGC clip: at most the longest clip any catalog video model declares.
  "ugc-clip": { via: "rule", run: ugcClipLength },
  // UGC Finish hands on the same clips, finished (a trim only shortens them): at most one clip's length each.
  "ugc-finish-clips": { via: "rule", run: ugcClipLength },

  // The four length-priced steps: each passes a length on (the same functions as the listing's own chains).
  "trim-video": { via: "rule", carries: true, run: utilityLength },
  "loop-video": { via: "rule", carries: true, run: utilityLength },
  "combine-videos": { via: "rule", carries: true, run: utilityLength },
  "video-sfx": { via: "rule", carries: true, run: utilityLength },

  // Steps that keep their input's length: the one set the run walks follow too (kept-length.ts).
  ...Object.fromEntries([...LENGTH_KEEPING_VIDEO_TYPES].map((type) => [type, CLIP_REMAKING_KEPT_LENGTH_TYPES.has(type) ? remakeVideo : passVideo])),
  "adjust-volume": remakeMedia,
  "pitch-tempo": { via: "rule", carries: true, run: pitchTempoLength },
  "voice-changer": remakeMedia,
  "voice-changer-pro": remakeMedia,
  "dubbing": remakeMedia,
  // The replaced span is regenerated from segments the plan pads by a seam (STITCH_SLACK_SEC).
  "edit-video-pro": { via: "rule", run: (_n, inputs) => { const l = knownOutputLength(videoIn(inputs)); return l ? addSec(l, STITCH_SLACK_SEC) : "unknown" } },

  // Steps with their own length rule.
  "video-to-video": { via: "rule", run: videoToVideoLength },
  "motion-transfer": { via: "rule", run: motionTransferLength },
  "extend-video": { via: "rule", run: extendLength },
  "lip-sync": { via: "rule", run: lipSyncLength },
  "ai-avatar": { via: "rule", run: aiAvatarLength },
  "speed-ramp": { via: "rule", run: speedRampLength },
  "merge-video-audio": { via: "rule", carries: true, run: mergeVideoAudioLength },
  "assemble-narrated-video": { via: "rule", carries: true, run: assembleNarratedLength },
  "slideshow": { via: "rule", run: slideshowLength },
  "split-media": { via: "rule", carries: true, run: splitMediaLength },

  // Audio-driven steps whose audio has no length before the run (VIDEO_LENGTH_UNBOUNDED_REASONS).
  "speech-to-video": { via: "rule", run: (_n, inputs) => knownOutputLength(audioIn(inputs)) ?? "unknown" },
  "still-to-video": { via: "rule", run: (_n, inputs) => knownOutputLength(audioIn(inputs)) ?? "unknown" },
  "suno-music-video": { via: "rule", run: () => "unknown" },

  // Nodes no rule can bound (VIDEO_LENGTH_UNBOUNDED_REASONS).
  "render-video": { via: "rule", run: () => "unknown" },
  "manual-edit": { via: "rule", run: () => "unknown" },
  "list": { via: "rule", run: () => "unknown" },
  "sub-workflow": { via: "rule", run: () => "unknown" },
  "reduce": { via: "rule", run: () => "unknown" },
}, usecaseLengthRules())

/** Why a hand-written row cannot always bound its node's output (the backend adds the "length:unknown" units' own reasons). */
export const VIDEO_LENGTH_UNBOUNDED_REASONS: Readonly<Record<string, string>> = {
  "youtube-video": "a pasted link the user cannot replace and that carries no length: its length is the video's, which a run reads at download (a link the user replaces is the episode, per minute)",
  "extend-video": "VEO and Runway extend add a length the catalog does not declare",
  "suno-music-video": "the song's length: a Suno task id carries none",
  "speech-to-video": "its length is the audio's, and a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length before the run",
  "slideshow": "with an audio wired its length is the audio's, which a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length for before the run",
  "still-to-video": "its length is the audio's, and a wired-in audio, or a generated voice whose script comes from a source with no known length, has no length before the run",
  "render-video": "its length is the upstream composition plan's, which the node does not carry",
  "manual-edit": "its length is the timeline the user cuts",
  "merge-video-audio": "it ends with its longest track, and an audio with no length before the run (a generated voice whose script comes from a source with no known length) may be longer than the video",
  "assemble-narrated-video": "each block lasts as long as its narration, which has no length before the run when its script is written at run time",
  "list": "fans out an unknown count of items",
  "sub-workflow": "its length is its inner workflow's",
  "reduce": "its length is its inputs' combined, an unknown count",
}

/** The steps that deliver their input's video whole (pinned by the listing's chain guard). */
export const PASS_THROUGH_VIDEO_TYPES: readonly string[] = Object.entries(VIDEO_LENGTH_RULES)
  .filter(([, rule]) => rule.run === passVideoRun)
  .map(([type]) => type)

/** The nodes whose length is a listing's to decide, beyond `VIDEO_PRODUCER_TYPES`: the dual-mode and dynamic steps that can deliver a video. */
export const DYNAMIC_VIDEO_OUTPUT_TYPES: readonly string[] = [
  "adjust-volume",
  "pitch-tempo",
  "voice-changer",
  "voice-changer-pro",
  "dubbing",
  "split-media",
  ...RENDER_NODE_TYPE_IDS,
  "list",
  "sub-workflow",
  "reduce",
]

/** The medium a wire carries, from the type of the node it leaves. */
export function wireKindOf(type: string | null | undefined): OutputWireKind {
  if (!type) return "other"
  if (VIDEO_PRODUCER_TYPES.has(type) || DYNAMIC_PRODUCER_TYPES.has(type)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(type)) return "audio"
  return "other"
}
