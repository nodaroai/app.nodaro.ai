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
 *     forwards from it ({@link recordingLengthSec}).
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
 *     other producer by its row of `VIDEO_LENGTH_RULES`. Never a stored take.
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
 * {@link VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC}) — a generation and every other
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
import { LENGTH_RECORDING_VIDEO_NODE_TYPES } from "./length-following-video"
import { bypassTeleports } from "./teleport-bypass"
import { forwardedVideoLengthSec, knownLength, LENGTH_PRICED_UTILITY_TYPES, utilityOutputLength, type InputLength } from "./utility-wire-length"
import { knownOutputLength, VIDEO_LENGTH_RULES, wireKindOf, type OutputWireInput } from "./video-output-length"

/**
 * The slack a Mask Composite quote adds to each clip a node makes in the run
 * (a PLANNED length): one frame plus an audio tail. Its run charges the
 * CONTAINER's length (ffprobe's format duration), which a made clip's audio track can carry past the
 * video (a 5 s clip measured 5.088 s), and its price rounds up past 0.05 s.
 */
export const MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC = 0.1

/**
 * The slack a Video Overlay quote adds to each clip a node makes in the run
 * (a PLANNED length): one 24 fps frame. Its run charges the VIDEO STREAM's
 * length, where a made clip runs about one frame past its nominal length (121 frames at 24 fps for
 * 5 s), so one clip stays inside the 0.05 s its price ignores and a Loop or a
 * Combine Videos of several still adds up past a boundary.
 */
export const VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC = 1 / 24

/**
 * The slack a Trim Video, Loop Video or Combine Videos quote adds to each clip
 * a node makes in the run (a PLANNED length): Mask Composite's, for the same
 * reason — their runs measure each clip's CONTAINER length before they reserve
 * (ffprobe's format duration, an audio tail included), and their price rounds
 * every started 5 seconds up with no grace at all, so one frame past a
 * boundary is a unit.
 */
export const VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC = MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC

/**
 * How far past a 5-second mark a clip given to Trim Video, Loop Video or
 * Combine Videos may run and still be priced as if it ended on the mark: a
 * made clip runs about a frame past its length (a 10 s generation measures
 * 10.042 s), and that frame is not charged. Taken off each clip's length — the
 * measured clip on a charge, the planned clip plus its slack on a quote, the
 * re-measured clip on the render's check — before the node's own formula
 * (`videoUtilityUnitsOf`), so it holds for every copy a Loop makes and every
 * clip a Combine Videos joins.
 */
export const VIDEO_UTILITY_PRICE_GRACE_SEC = 0.1

/** The steps whose quote reads the measured walk with a slack from {@link MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC}. */
export type MeasuredInputStepType = "video-sfx" | "video-mask" | "video-depth" | "pitch-tempo" | "dubbing" | "video-upscale" | "lip-sync"

/**
 * The slack a quote of each of these steps adds to each clip a node makes in
 * the run (a PLANNED length), by what its run measures before it reserves —
 * the one table the editor's quote, the server's estimate and the app listing
 * read:
 * - the CONTAINER (ffprobe's format duration, an audio tail included): Video
 *   SFX (`ceil` of it, no grace, against its 8 / 15 / 30 / 60 / 120 / 300 s
 *   rows), Video Mask and Video Depth (at most 0.05 s past a whole second is
 *   ignored, less than a frame plus a tail), Pitch & Tempo and Dubbing (every
 *   started minute, no grace), and a Lip Sync priced by the seconds of its
 *   audio (OmniHuman 2.0: `ceil` of them, at least its minimum, no grace) —
 *   Mask Composite's slack;
 * - the VIDEO STREAM: Topaz Video Upscale, whose hold counts the stream's
 *   frames at the target rate — Video Overlay's one frame.
 * None of them takes the 0.1 s price grace of Trim / Loop / Combine Videos
 * ({@link VIDEO_UTILITY_PRICE_GRACE_SEC}): their charges keep their own rules.
 */
export const MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC: Readonly<Record<MeasuredInputStepType, number>> = {
  "video-sfx": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "video-mask": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "video-depth": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "pitch-tempo": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "dubbing": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  "video-upscale": VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  "lip-sync": MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
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
   * has no length before its run. Only Lip Sync's quote asks for it (decided
   * 2026-11-13: its price before the run starts from the earlier take, the run
   * charges the audio it measures); every other step reads such a voice as
   * unknown. A voice with no take stays unknown. A length the caller knows
   * ({@link knownLengthSec}, the listing's script reading) comes first.
   */
  readonly voiceTakeAsMinimum?: boolean
}

/** The generated voices: Text to Speech and Text to Dialogue. */
export const GENERATED_VOICE_NODE_TYPES: ReadonlySet<string> = new Set(["text-to-speech", "text-to-dialogue"])

const positiveSec = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)
const fixed = (sec: number): InputLength => ({ fixedSec: sec, perEpisodeSec: 0 })
const isFrozen = (n: EstimateGraphNode): boolean => (n.data as { skipped?: unknown } | null | undefined)?.skipped === true

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
  const never = new Set(nodes.filter((n) => isFrozen(n) || ENGINE_SKIPPED_NODE_TYPES.has(n.type ?? "")).map((n) => n.id))
  const running: ReadonlySet<string> = never.size === 0 ? rerunIds : new Set([...rerunIds].filter((id) => !never.has(id)))
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
    if (RECORDING_SOURCE_TYPES.has(resolved.type ?? "")) return recordingLengthSec(resolved)
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
 * - every other producer: its row of `VIDEO_LENGTH_RULES`, read for a
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
  options: Pick<MeasuredWireLengthOptions, "generateVideoProCapSec" | "plannedClipSlackSec" | "openSourceIds"> = {},
): number | undefined {
  const type = origin.type ?? ""
  const into = edges.filter((e) => e.target === origin.id)
  if (LENGTH_PRICED_UTILITY_TYPES.has(type)) {
    const secs = into.map((e) => inputSec(e.source))
    if (type === "combine-videos" && secs.some((s) => s === undefined)) return undefined
    return knownLength(utilityOutputLength(origin, into, secs.map((s) => (s === undefined ? undefined : fixed(s)))))?.fixedSec
  }
  const slack = Math.max(0, options.plannedClipSlackSec ?? 0)
  const rule = VIDEO_LENGTH_RULES[type]
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
    const sec = knownOutputLength(rule.run({ id: origin.id, type, data: mapped.data }, inputs, ctx))?.fixedSec
    // A node that makes a clip: the slack, once. A carrier's inputs already brought theirs.
    return sec === undefined || rule.carries ? sec : sec + slack
  }
  if (rule) return undefined
  const kept = keptLengthWire(origin, nodes, edges)
  return kept ? inputSec(kept.source) : undefined
}
