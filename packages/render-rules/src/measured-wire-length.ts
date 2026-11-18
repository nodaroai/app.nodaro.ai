/**
 * What a step whose RUN measures the file it is given (Mask Composite, Video
 * Overlay, Trim Video, Loop Video, Combine Videos, Video SFX, Video Mask, Video
 * Depth, Pitch & Tempo, Dubbing, Topaz Video Upscale) will be given, in seconds,
 * before the run: the one reading the editor's quote, the server's workflow
 * estimate and the app listing share, so they quote the same figure on every
 * path, and never below what the run is charged.
 *
 * The walk, in order (from the wire's origin, through teleports and a wired
 * Settings input):
 *  1. A render: the render's own estimated length (`renderLengthSec`), as
 *     today — a planner that re-runs re-plans.
 *  2. A recording (an upload, a Video link, an audio upload): the length a run
 *     forwards from it ({@link recordingLengthSec}); for a step that bills
 *     the decoded audio by the second, its sound's decoded length
 *     (`decodedAudioLength`: an AAC recording one frame longer).
 *  3. A node that will NOT run in this run and holds a take: it hands that take
 *     on, so its recorded length — a generation's record read with the overhang
 *     it may leave off ({@link recordedTakeSec}). None recorded: unknown, except
 *     for a video generation (Generate Video, Image to Video, Text to Video,
 *     Video to Video): a run that follows its own length records it, so a take
 *     with none was made at its settings, and is read at its planned length
 *     (step 4) — the stored Duration of a fixed-length run.
 *  4. A node that will run, or holds no take (what reaches the step is then a
 *     fresh run at today's settings): its PLANNED length
 *     ({@link plannedVideoLengthSec}) — a generation at the length its model
 *     renders for its settings, an Extend Video at its source plus the seconds
 *     it adds, a Trim / Loop / Combine Videos / Video SFX / Pitch & Tempo by the
 *     shared rule, a step that keeps its input's length at that input, every
 *     other producer by its row of `VIDEO_LENGTH_RULES` (an audio step that
 *     re-encodes what it is given, by its row of `AUDIO_LENGTH_RULES`). Never a
 *     stored take.
 *  5. Anything else: unknown, which the step quotes at its cap.
 *
 * The graph is read as the run executes it, every Teleport pair bypassed
 * (`bypassTeleports`): a wired Settings input or a Mix Audio's voice that
 * reaches a node through a pair is read as the run reads it, whether the
 * caller passed the drawn wires (a node's pill) or the carried ones (a run
 * estimate).
 *
 * "Will run" is the priced run's node set less every frozen node
 * (`data.skipped`) and every type the run engine skips
 * (`ENGINE_SKIPPED_NODE_TYPES`, e.g. Manual Edit): the editor and the server
 * build their run sets differently (the editor's whole run keeps frozen nodes,
 * the server's keeps the skipped types), so they are removed once, at the top,
 * and that set is what every reading below gets, renders included.
 *
 * A length-deciding field (`duration`, `provider`) a run sets from a field
 * mapping or a `field-<key>` wire is read as the run reads it: a parameter
 * node's value (a Duration, a Provider) is written into the node's data; any
 * other source's value is not known before the run, so the node is read at
 * the most it can render whatever that value is (`openFields`: each model's
 * longest clip; every model the node may run).
 *
 * Every node that makes a clip in the run adds its step's slack to its planned
 * length ({@link MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC},
 * {@link VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC},
 * {@link VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC}), or the node's own measured
 * overshoot where its row declares a longer one (a Dubbing, an Audio
 * Isolation, a PixVerse V6 extension: `LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC`,
 * a quarter second, on every measuring step after it — but a Dubbing's and an
 * Audio Isolation's not on a step that measures the video stream, `reading`)
 * — a generation and every other
 * producer read by its length rule, a ceiling and a step whose length follows
 * its input (Lip Sync, Motion Transfer, …) included — added once, here, so a
 * new producer gets it by default. A row that only carries its inputs' lengths
 * (`carries`: a step that keeps its input's length, Trim / Loop / Combine
 * Videos, a mix, a merge) adds none: its inputs bring theirs, so a chain adds
 * the slack once per clip made, a Loop or a Combine Videos once per clip it
 * joins. What is not planned gets none: a take a node that does not run hands
 * on, an upload, a Library clip, a link, a render, a fixed Trim window.
 */
import { isRenderNodeType, NODE_MAPPABLE_FIELDS, settingsSourceForField, withWiredSettings } from "@nodaro/shared/nodes"
import { CONTAINER_OVERHANG_SEC } from "@nodaro/shared/video"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { getParameterValue, PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import { ENGINE_SKIPPED_NODE_TYPES } from "./engine-skipped-types"
import {
  mediaLengthSecOf,
  renderLengthSec,
  resolveApplyEdlEstimateLength,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate"
import { keptLengthWire, LENGTH_KEEPING_VIDEO_TYPES } from "./kept-length"
import { recordingDecodeOverhangSec } from "./recorded-audio-decode"
import { LENGTH_RECORDING_VIDEO_NODE_TYPES } from "./length-following-video"
import { bypassTeleports } from "./teleport-bypass"
import { forwardedVideoLengthSec, knownLength, LENGTH_PRICED_UTILITY_TYPES, utilityOutputLength, type InputLength } from "./utility-wire-length"
import { knownOutputLength, lengthRuleOf, wireKindOf, type MeasuredFileReading, type OutputLengthNode, type OutputLengthRule, type OutputWireInput } from "./video-output-length"
import { MADE_CLIP_OVERSHOOT_SEC } from "./made-clip-overshoot"

/**
 * The slack a Mask Composite quote adds to each clip a node makes in the run
 * (a PLANNED length): how far a made clip's CONTAINER can run past it
 * ({@link MADE_CLIP_OVERSHOOT_SEC}, 0.15 s: a clip was measured up to 0.104 s
 * past it, its audio track carried past the video). Its run charges the
 * container's length (ffprobe's format duration), and its price forgives the
 * same 0.05 s past a whole second on the quote and on the charge
 * (`pricedClipSeconds`), so the slack alone must cover the whole overshoot.
 * Video Mask and Video Depth price the same way and read it too
 * ({@link MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC}).
 */
export const MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC = MADE_CLIP_OVERSHOOT_SEC.container

/**
 * The slack the steps whose quote reads a length exactly, and whose hold and
 * charge forgive `CLIP_PRICE_GRACE_SEC` (0.05 s) past a mark, add to each clip
 * a node makes in the run: Video SFX's rows, Pitch & Tempo's and Dubbing's
 * minutes, Lip Sync's tiers and OmniHuman 2.0's seconds. A tenth of a second:
 * with the 0.05 s their charge forgives, a clip up to 0.15 s past its planned
 * length ({@link MADE_CLIP_OVERSHOOT_SEC}) is charged no more than its quote.
 */
export const EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC = 0.1

/**
 * The slack a Video Overlay quote adds to each clip a node makes in the run
 * (a PLANNED length): one 24 fps frame. Its run charges the VIDEO STREAM's
 * length, where a made clip runs about one frame past its nominal length (121 frames at 24 fps for
 * 5 s), so one clip stays inside the 0.05 s its price ignores and a Loop or a
 * Combine Videos of several still adds up past a boundary.
 */
export const VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC = 1 / 24

/** What a Video Overlay's run measures of its base: the video stream (the reading it passes the measured walk). */
export const VIDEO_OVERLAY_READING: MeasuredFileReading = "video-stream"

/**
 * How far past a 5-second mark a clip given to Trim Video, Loop Video or
 * Combine Videos may run and still be priced as if it ended on the mark: a
 * made clip runs a little past its length (a 10 s generation measures 10.042 s;
 * a made clip's container, up to 0.104 s), and that is not charged. Taken off
 * each clip's length — the measured clip on a charge, the planned clip plus its
 * slack on a quote, the re-measured clip on the render's check — before the
 * node's own formula (`videoUtilityUnitsOf`), so it holds for every copy a Loop
 * makes and every clip a Combine Videos joins.
 */
export const VIDEO_UTILITY_PRICE_GRACE_SEC = 0.15

/**
 * The slack a Trim Video, Loop Video or Combine Videos quote adds to each clip
 * a node makes in the run (a PLANNED length): its runs measure each clip
 * before they reserve ({@link VIDEO_UTILITY_READING}), and a made clip's
 * container was measured up to 0.104 s past the length it was asked for (a
 * Seedance 2 Mini clip). The grace itself
 * ({@link VIDEO_UTILITY_PRICE_GRACE_SEC}), declared once so the two cannot
 * part: a quote for a planned length is the units of that length, and a clip
 * that runs up to this far past it is charged no more.
 */
export const VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC = VIDEO_UTILITY_PRICE_GRACE_SEC

/** The video-utility steps that measure their clips before they reserve. */
export type VideoUtilityStepType = "trim-video" | "loop-video" | "combine-videos"

/**
 * What each of Trim Video, Loop Video and Combine Videos' runs measures of the
 * clips it is given — the length its worker cuts or joins by, the charge
 * before a run and the render's check read the same: Trim and Loop the
 * CONTAINER (an audio tail included), Combine Videos each clip's VIDEO STREAM
 * (where it joins). The reading each passes the measured walk: a Dubbing's or
 * an Audio Isolation's file runs further past its input in its sound only (a
 * dub keeps its input's picture exactly), so after one a Combine Videos keeps
 * its own slack, and Trim and Loop read the quarter second.
 */
export const VIDEO_UTILITY_READING: Readonly<Record<VideoUtilityStepType, MeasuredFileReading>> = {
  "trim-video": "container",
  "loop-video": "container",
  "combine-videos": "video-stream",
}

/** The steps whose quote reads the measured walk with a slack from {@link MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC}. */
export type MeasuredInputStepType = "video-sfx" | "video-mask" | "video-depth" | "pitch-tempo" | "dubbing" | "video-upscale" | "lip-sync" | "motion-transfer"

/**
 * The slack a quote of each of these steps adds to each clip a node makes in
 * the run (a PLANNED length), by what its run measures before it reserves and
 * what its price forgives past a mark — the one table the editor's quote, the
 * server's estimate and the app listing read:
 * - the CONTAINER (ffprobe's format duration, an audio tail included), the
 *   quote and the charge forgiving the same 0.05 s past a whole second: Video
 *   Mask, Video Depth and Motion Transfer's driving video — Mask Composite's slack, the whole 0.15 s a made
 *   clip's container can run past its planned length;
 * - the CONTAINER, the quote reading the length exactly and the hold and the
 *   charge forgiving 0.05 s: Video SFX (its 8 / 15 / 30 / 60 / 120 / 300 s
 *   rows), Pitch & Tempo and Dubbing (every started minute), and Lip Sync (a
 *   length tier, or OmniHuman 2.0's started seconds, at least its minimum) —
 *   {@link EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC}, a tenth of a second;
 * - the VIDEO STREAM: Video Upscale, whose run (Topaz's hold counts the
 *   stream's frames, Nodaro Video Upscale bills its seconds) reads it — Video
 *   Overlay's one frame.
 * Each step's slack and graces are declared together in
 * `MEASURING_STEP_ALLOWANCES`, which the overshoot guard holds to the made
 * clip's overshoot. None of them takes the 0.15 s price grace of Trim / Loop /
 * Combine Videos ({@link VIDEO_UTILITY_PRICE_GRACE_SEC}).
 */
export const MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC: Readonly<Record<MeasuredInputStepType, number>> = {
  "video-sfx": EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC,
  "video-mask": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "video-depth": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "pitch-tempo": EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC,
  "dubbing": EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC,
  "video-upscale": VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  "lip-sync": EXACT_QUOTE_PLANNED_CLIP_SLACK_SEC,
  "motion-transfer": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
}

/**
 * What each of these steps' run measures of the file it is given — the
 * reading it passes the measured walk, beside its slack: the video stream for
 * Video Upscale (Topaz's hold counts the stream's frames; Nodaro Video Upscale
 * bills the stream's seconds, the container only when no stream length can be
 * read), the container for the rest. A file whose sound alone runs past its
 * planned length (a Dubbing's) adds its overshoot only on a container reading.
 */
export const MEASURED_INPUT_READING: Readonly<Record<MeasuredInputStepType, MeasuredFileReading>> = {
  "video-sfx": "container",
  "video-mask": "container",
  "video-depth": "container",
  "pitch-tempo": "container",
  "dubbing": "container",
  "video-upscale": "video-stream",
  "lip-sync": "container",
  "motion-transfer": "container",
}

/** The recording node types: the uploads an app exposes and the Video URL (YouTube or any link) node. */
export const RECORDING_SOURCE_TYPES: ReadonlySet<string> = new Set(["upload-video", "upload-audio", "reference-audio", "youtube-video"])

/** The audio recordings, which record their length only on `metadata.durationSeconds` (never on a result). */
const AUDIO_RECORDING_TYPES: ReadonlySet<string> = new Set(["upload-audio", "reference-audio"])

/**
 * A recording's length as a run estimate reads it: the length a run forwards
 * from it (`forwardedVideoLengthSec` — an upload's result, only while it is
 * the node's file), and for an audio recording the length its upload or
 * extraction recorded (`mediaLengthSecOf`: `metadata.durationSeconds`, trusted
 * only while stamped to the node's current media), as the editor reads it.
 */
export function recordingLengthSec(origin: { readonly type?: string | null; readonly data?: unknown }): number | undefined {
  const forwarded = forwardedVideoLengthSec(origin)
  if (forwarded !== undefined || !AUDIO_RECORDING_TYPES.has(origin.type ?? "")) return forwarded
  return mediaLengthSecOf(origin.data as Record<string, unknown> | undefined)
}

/** What the measured walk reads that it cannot know on its own. */
export interface MeasuredWireLengthOptions {
  /** How an Edit Plan's saved output is read (the editor passes its cached reader). */
  readonly planOutputOf?: EditPlanOutputReader
  /** The deployment's Generate Video Pro cap: the server passes its env's, the editor its fallback. */
  readonly generateVideoProCapSec?: number
  /** Seconds added to the planned length of each node that makes a clip in the run: the measuring step's own slack (the two constants above). */
  readonly plannedClipSlackSec?: number
  /**
   * What the measuring step's run measures of the file (`container`, the
   * default, or `video-stream`: Video Overlay, Video Upscale —
   * {@link VIDEO_OVERLAY_READING}, {@link MEASURED_INPUT_READING}). A node's
   * own overshoot is read on it: a Dubbing's runs in its sound only.
   */
  readonly reading?: MeasuredFileReading
  /**
   * Nodes whose value the run's user sets with no bound known beforehand (a
   * published app's free-text or unbounded-number input, which a listing
   * cannot enumerate): a length-deciding field mapped from one is open, even
   * when it is a parameter node whose saved value is the creator's sample.
   */
  readonly openSourceIds?: ReadonlySet<string>
  /**
   * The length of a node the caller can read and the walk cannot plan — the
   * app listing's reading of a generated voice from its script (Text to
   * Speech, Text to Dialogue) — or `undefined` to plan the node as usual. Asked
   * only of a node the walk would plan (never a render, a recording or a take).
   */
  readonly knownLengthSec?: (origin: EstimateGraphNode) => number | undefined
  /**
   * Read only a length the graph KNOWS — a recording's (an upload, a measured
   * Library clip) or the length recorded with a take a node hands on (a
   * render's recorded cut included) — and leave every length the walk would
   * plan or estimate (a node that runs, a render's estimate) undefined. A step that refuses a clip past a limit refuses before
   * a run only on such a length: a planned one is an upper bound, never proof.
   */
  readonly knownOnly?: boolean
  /**
   * Read a generated voice that runs in the run ({@link GENERATED_VOICE_NODE_TYPES})
   * at the length of the take it holds — a MINIMUM: the voice is made again and
   * has no length before its run. Lip Sync's quote asks for it (decided
   * 2026-11-13: its price before the run starts from the earlier take, the run
   * charges the audio it measures), and so do Transcribe and Add Captions on
   * Nemotron (decided 2026-11-14, `NEMOTRON_WIRE_READ_OPTIONS`); every other
   * step reads such a voice as unknown. A voice with no take stays unknown. A length the caller knows
   * ({@link knownLengthSec}, the listing's script reading) comes first.
   */
  readonly voiceTakeAsMinimum?: boolean
  /**
   * Read a recording (an upload, a Video link, an audio upload) at the length
   * its sound DECODES to, as the step's charge reads it: an AAC recording up to
   * one AAC frame past the container length its upload recorded
   * (`recordingDecodeOverhangSec`), less the 0.05 s the charge forgives
   * (`CLIP_PRICE_GRACE_SEC`) — so only a frame longer than that (a rate under
   * about 20 kHz, or a rate not recorded) adds — carried through the steps
   * after it. Only a step that bills every started second of the
   * decoded audio with no grace asks for it (Lip Sync on a per-second-rate
   * model priced by its audio's length — `LIP_SYNC_AUDIO_WIRE_READ_OPTIONS`); every other step
   * reads the recorded length.
   */
  readonly decodedAudioLength?: boolean
}

/**
 * What a Lip Sync's quote reads its `audio` wire with, on every estimate (the
 * editor's, the server's run estimate, the app listing) and every model priced
 * by its audio's length: a voice made again in the run at the take it holds, a
 * minimum (decided 2026-11-13); and a recording at its decoded length (decided
 * 2026-11-14: an AAC recording one frame, 1024 / its sample rate, past its
 * record, less the 0.05 s each hold forgives — the per-second rate's grace and
 * the length tiers' edge are the same `CLIP_PRICE_GRACE_SEC`). The holds read
 * the decoded length: a 15.000 s M4A at 16 kHz decodes to 15.064 s, past the
 * 15 s tier's edge.
 */
export const LIP_SYNC_AUDIO_WIRE_READ_OPTIONS: Readonly<Pick<MeasuredWireLengthOptions, "voiceTakeAsMinimum" | "decodedAudioLength">> = { voiceTakeAsMinimum: true, decodedAudioLength: true }

/**
 * How Transcribe and Add Captions on Nemotron 3.5 Transcribe read the media on
 * their wire, on every estimate (decided 2026-11-14: one reading on both
 * sides): the measured walk with no slack — their hold forgives a second past
 * a minute (`nemotronHeldMinutes`), more than a made file runs past its
 * planned length — and a voice made again in the run at the take it holds, a
 * documented minimum (Lip Sync's rule; the run charges the minutes it
 * measures). What the walk cannot size stays unknown: the 60-minute price.
 */
export const NEMOTRON_WIRE_READ_OPTIONS: Readonly<Pick<MeasuredWireLengthOptions, "plannedClipSlackSec" | "voiceTakeAsMinimum">> = { plannedClipSlackSec: 0, voiceTakeAsMinimum: true }

/** The generated voices: Text to Speech and Text to Dialogue. */
export const GENERATED_VOICE_NODE_TYPES: ReadonlySet<string> = new Set(["text-to-speech", "text-to-dialogue"])

const positiveSec = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)
const fixed = (sec: number): InputLength => ({ fixedSec: sec, perEpisodeSec: 0 })
const isFrozen = (n: EstimateGraphNode): boolean => (n.data as { skipped?: unknown } | null | undefined)?.skipped === true

/** The nodes of a priced run that will actually run: `rerunIds` less every frozen node and every node the engine skips. */
export function runningNodeIdsOf(nodes: readonly EstimateGraphNode[], rerunIds: ReadonlySet<string>): ReadonlySet<string> {
  const never = new Set(nodes.filter((n) => isFrozen(n) || ENGINE_SKIPPED_NODE_TYPES.has(n.type ?? "")).map((n) => n.id))
  return never.size === 0 ? rerunIds : new Set([...rerunIds].filter((id) => !never.has(id)))
}

/** The fields whose value decides how long a node's clip is, among those a run may map (`NODE_MAPPABLE_FIELDS`). */
export const LENGTH_DECIDING_MAPPABLE_FIELDS: readonly string[] = ["duration", "provider"]

/**
 * A node's length-deciding fields as its run resolves their mappings
 * (`resolveFieldMappings`: a `field-<key>` wire, else the Settings input —
 * already read by `withWiredSettings` —, else `data.fieldMappings.<key>`): a
 * parameter node's value written into its data (`getParameterValue`, as the
 * run reads it); any other source named in `open` (its value is known only at
 * run time). A source that is not in the graph leaves the stored value, as the
 * run does. A source in `openSourceIds` (a value the run's user types) is open
 * whatever its type.
 */
export function mappedLengthFields(
  origin: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  openSourceIds?: ReadonlySet<string>,
): { readonly node: EstimateGraphNode; readonly open: ReadonlySet<string> } {
  const type = origin.type ?? ""
  const fields = (NODE_MAPPABLE_FIELDS[type] ?? []).filter((f) => LENGTH_DECIDING_MAPPABLE_FIELDS.includes(f))
  if (fields.length === 0) return { node: origin, open: new Set() }
  const stored = (origin.data ?? {}) as Record<string, unknown>
  const mappings = (stored.fieldMappings ?? {}) as Record<string, { sourceNodeId?: unknown } | undefined>
  const typeOf = (id: string) => nodes.find((n) => n.id === id)?.type
  const data: Record<string, unknown> = { ...stored }
  const open = new Set<string>()
  for (const field of fields) {
    const wire = edges.find((e) => e.target === origin.id && e.targetHandle === `field-${field}`)
    if (!wire && settingsSourceForField(origin.id, type, field, edges, typeOf)) continue
    const mapped = mappings[field]?.sourceNodeId
    const sourceId = wire?.source ?? (typeof mapped === "string" && mapped !== "" ? mapped : undefined)
    if (sourceId === undefined) continue
    const source = resolveGraphOrigin(nodes.find((n) => n.id === sourceId), nodes, edges)
    if (!source) continue
    if (PARAMETER_NODE_TYPES.has(source.type ?? "") && !openSourceIds?.has(source.id)) {
      const value = getParameterValue((source.data ?? {}) as Record<string, unknown>, source.type ?? "")
      if (value != null) data[field] = value
      continue
    }
    open.add(field)
  }
  return { node: { ...origin, data }, open }
}

/**
 * The length of the file a take is, as a step that measures that file reads
 * it, from the length recorded with it. A video generation's run that follows
 * its own length (an automatic length, a Seedance Edit / Extend) records its
 * video's length with a container overhang of up to `CONTAINER_OVERHANG_SEC`
 * (a quarter second) past a whole second left off, and at most its run's
 * bound: such a record is a whole number of seconds, and the file can run up to
 * that allowance past it. So a whole-second length on a generation's take is
 * read with the allowance added back — never below the file a measuring step
 * is charged by. Any other length is the file's own.
 */
export function recordedTakeSec(type: string | null | undefined, duration: unknown): number | undefined {
  const sec = positiveSec(duration)
  if (sec === undefined || !LENGTH_RECORDING_VIDEO_NODE_TYPES.has(type ?? "") || !Number.isInteger(sec)) return sec
  return sec + CONTAINER_OVERHANG_SEC
}

/**
 * The take a node holds: its active result row (`generatedResults[activeResultIndex ?? 0]`)
 * when that row has a `url`.
 *
 * By default the url must be non-empty: the measured walk reads a take as the
 * FILE a step measures, and a row with no file is planned instead. With
 * `anyUrl`, any string url counts (an empty one included), as a Seedance 2.5
 * HD finalize estimate asks only whether the node already holds a result row
 * (`seedanceFinalizeDraftQuote`, which read it so before it shared this helper).
 */
export function activeTake(data: unknown, options: { readonly anyUrl?: boolean } = {}): { readonly duration?: unknown } | undefined {
  const d = (data ?? {}) as Record<string, unknown>
  const rows = Array.isArray(d.generatedResults) ? (d.generatedResults as ReadonlyArray<Record<string, unknown> | null | undefined>) : []
  const index = typeof d.activeResultIndex === "number" ? d.activeResultIndex : 0
  const row = rows[index]
  if (!row || typeof row !== "object" || typeof row.url !== "string") return undefined
  return options.anyUrl || row.url.trim() !== "" ? row : undefined
}

/**
 * The length, in seconds, of what the wire from `sourceId` hands a step whose
 * run measures it — never below what that run measures for the source — or
 * `undefined` when it is not known (the step's cap). See the module note.
 *
 * @param rerunIds the nodes the priced run executes (empty for a single node's own price); frozen ones are removed here.
 */
export function measuredWireLengthSec(
  sourceId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  drawnEdges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  options: MeasuredWireLengthOptions = {},
): number | undefined {
  const edges = bypassTeleports(nodes, drawnEdges)
  const running = runningNodeIdsOf(nodes, rerunIds)
  const walk = (id: string | undefined, seen: ReadonlySet<string>): number | undefined => {
    const resolved = resolveGraphOrigin(nodes.find((n) => n.id === id), nodes, edges)
    if (!resolved || seen.has(resolved.id)) return undefined
    if (isRenderNodeType(resolved.type)) {
      // Known: a render that does not run again hands on its cut, and the length recorded with it — its EDL's
      // length, not a measurement. A render's file measures at or past its cut, so a refusal read on the record
      // never refuses a clip the run, which measures the file, would accept.
      if (options.knownOnly) return running.has(resolved.id) ? undefined : positiveSec(activeTake(resolved.data)?.duration)
      return renderLengthSec(resolveApplyEdlEstimateLength(resolved, nodes, edges, running, options.planOutputOf))
    }
    if (RECORDING_SOURCE_TYPES.has(resolved.type ?? "")) {
      const recorded = recordingLengthSec(resolved)
      // Its sound's decoded length, when the step asks: an AAC recording plays up to a frame past its record, less
      // the hair the step's charge forgives (`CLIP_PRICE_GRACE_SEC`), so a frame the charge already forgives adds nothing.
      return recorded === undefined || !options.decodedAudioLength ? recorded : recorded + Math.max(0, recordingDecodeOverhangSec(resolved) - CLIP_PRICE_GRACE_SEC)
    }
    // A node that will not run hands on its take: the length recorded with it.
    if (!running.has(resolved.id)) {
      const take = activeTake(resolved.data)
      const recorded = take ? recordedTakeSec(resolved.type, take.duration) : undefined
      // A video generation's take with no recorded length: its planned length, below. Any other take with none: unknown.
      if (take && (recorded !== undefined || !LENGTH_RECORDING_VIDEO_NODE_TYPES.has(resolved.type ?? ""))) return recorded
    }
    // Only the graph's known lengths: anything below is planned or estimated.
    if (options.knownOnly) return undefined
    const walked = new Set(seen).add(resolved.id)
    const origin = withWiredSettings(resolved, nodes, edges)
    const known = options.knownLengthSec?.(origin)
    if (known !== undefined) return known
    const planned = plannedVideoLengthSec(origin, (source) => walk(source, walked), nodes, edges, options)
    if (planned !== undefined || !options.voiceTakeAsMinimum || !GENERATED_VOICE_NODE_TYPES.has(origin.type ?? "")) return planned
    // A generated voice made again in this run: the take it holds, a minimum (see the option).
    return positiveSec(activeTake(origin.data)?.duration) ?? mediaLengthSecOf(origin.data as Record<string, unknown> | undefined)
  }
  return walk(sourceId, new Set())
}

/**
 * The slack the measured walk adds to the clip one node makes in the run: the
 * measuring step's own (`stepSlackSec`), or the node's measured overshoot on
 * what that step measures (`reading`) when its row declares a longer one
 * (`plannedOvershootSec`: a Dubbing or an Audio Isolation on the container, a
 * PixVerse V6 extension on either — `LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC`).
 *
 * The zero-slack rule: a step that reads with no slack at all adds none here
 * either. That is Nemotron only — Transcribe and Add Captions on Nemotron 3.5
 * (`NEMOTRON_WIRE_READ_OPTIONS`), whose hold and charge forgive a second past
 * a minute, more than any producer's overshoot. Every other measuring step
 * reads with a slack above 0; a new step that reads with none must forgive at
 * least the longest overshoot itself (the overshoot guard test holds both).
 */
function madeClipSlackSec(stepSlackSec: number, rule: OutputLengthRule | undefined, node: OutputLengthNode, reading: MeasuredFileReading): number {
  if (stepSlackSec <= 0) return 0
  return Math.max(stepSlackSec, rule?.plannedOvershootSec?.(node, reading) ?? 0)
}

/**
 * The PLANNED length, in seconds, of the video one node hands on when it runs
 * at its settings, from the lengths of what its wires bring (`inputSec`, the
 * measured walk), or `undefined` when no rule bounds it:
 * - Trim, Loop, Combine Videos, Video SFX, Pitch & Tempo: `utilityOutputLength`
 *   — except that a Combine Videos with a clip of unknown length is unknown
 *   (its run joins the whole clip; the 8-second stand-in the forwarded charge
 *   reads would quote below it);
 * - a step that keeps its input's length (`LENGTH_KEEPING_VIDEO_TYPES`): the
 *   wire `keptLengthWire` follows, plus the slack when it re-renders the clip
 *   through a provider (its row is no carrier);
 * - every other producer: its row of `VIDEO_LENGTH_RULES` (or, for an audio
 *   step, `AUDIO_LENGTH_RULES`; one lookup, `lengthRuleOf`), read for a
 *   measuring step (a generation with the duration its run fills when none is
 *   set and up to a reference clip its output follows; its mapped length
 *   fields as the run resolves them, `mappedLengthFields`), never floored at
 *   a stored take, plus the slack unless the row only `carries` its inputs';
 * - a step outside the table that keeps one input's length (a Mix Audio that
 *   ends with its voice): that input's.
 *
 * @param origin the node, already through teleports and a wired Settings input.
 */
export function plannedVideoLengthSec(
  origin: EstimateGraphNode,
  inputSec: (sourceId: string) => number | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  options: Pick<MeasuredWireLengthOptions, "generateVideoProCapSec" | "plannedClipSlackSec" | "openSourceIds" | "reading"> = {},
): number | undefined {
  const type = origin.type ?? ""
  const into = edges.filter((e) => e.target === origin.id)
  if (LENGTH_PRICED_UTILITY_TYPES.has(type)) {
    const secs = into.map((e) => inputSec(e.source))
    if (type === "combine-videos" && secs.some((s) => s === undefined)) return undefined
    return knownLength(utilityOutputLength(origin, into, secs.map((s) => (s === undefined ? undefined : fixed(s)))))?.fixedSec
  }
  const stepSlack = Math.max(0, options.plannedClipSlackSec ?? 0)
  const rule = lengthRuleOf(type)
  const reading = options.reading ?? "container"
  const slack = madeClipSlackSec(stepSlack, rule, { id: origin.id, type, data: origin.data }, reading)
  if (LENGTH_KEEPING_VIDEO_TYPES.has(type)) {
    const wire = keptLengthWire(origin, nodes, edges)
    const sec = wire ? inputSec(wire.source) : undefined
    // A provider step that re-renders the clip (no `carries` on its row) makes a new one: the slack, once.
    return sec === undefined || rule?.carries ? sec : sec + slack
  }
  if (rule?.via === "rule" && rule.run) {
    const inputs = into.map((e): OutputWireInput => {
      const kind = wireKindOf(resolveGraphOrigin(nodes.find((n) => n.id === e.source), nodes, edges)?.type)
      const sec = inputSec(e.source)
      // A media wire with no known length cannot be bounded; a wire that is not media carries none.
      return { sourceId: e.source, handle: e.targetHandle, kind, length: sec !== undefined ? fixed(sec) : kind === "other" ? undefined : "unknown" }
    })
    const { node: mapped, open } = mappedLengthFields(origin, nodes, edges, options.openSourceIds)
    const ctx = { measured: true, generateVideoProCapSec: options.generateVideoProCapSec, openFields: open }
    const node = { id: origin.id, type, data: mapped.data }
    const sec = knownOutputLength(rule.run(node, inputs, ctx))?.fixedSec
    // A node that makes a clip: the slack, once (its own overshoot when that is longer, read as its run resolves it). A carrier's inputs already brought theirs.
    return sec === undefined || rule.carries ? sec : sec + madeClipSlackSec(stepSlack, rule, node, reading)
  }
  if (rule) return undefined
  const kept = keptLengthWire(origin, nodes, edges)
  return kept ? inputSec(kept.source) : undefined
}
