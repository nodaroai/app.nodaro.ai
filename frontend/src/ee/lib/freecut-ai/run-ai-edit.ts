/**
 * One Edit with AI run, end to end, in front of the person.
 *
 * It listens to the video (a transcription with word timings), reads the
 * request (the planner model), and then lets the agents work on the editor's
 * real timeline, one visible step at a time: the Cutter takes out filler words
 * and pauses, Captions writes along with the voice, Sound lays music under it.
 * Every step is one of the editor's own undo entries. The show is the pacing,
 * the named cursors and the playhead that follows them; the edits themselves
 * are instant.
 *
 * Paid work starts only when it will be used: the music starts once the video
 * has been heard, and a run that stops or fails cancels whatever it started
 * that has not finished. Everything it says goes out as dictionary keys
 * (`onEvent`), so the panel renders it in the person's language.
 */
import type { MessageKey } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n"
import {
  InsufficientCreditsError,
  cancelJob,
  generateAIWriterStream,
  getCurrentUserId,
  getJobStatusLean,
  sunoGenerateApi,
  transcribeApi,
} from "@/lib/api"
import {
  captionCues,
  fillerRanges,
  isFillerWord,
  mergeRanges,
  pauseRanges,
  planFromRequest,
  parseModelPlan,
  readTimelineView,
  timelineFrameOf,
  timelineSeconds,
  transcriptLanguage,
  wordsFromTranscript,
  type CaptionCue,
  type EditPlan,
  type EditStep,
  type SecondsRange,
  type TimedWord,
  type TimelineView,
} from "./edit-plan"
import { EditorLinkError, type EditorLink, type OpsResult, type PresenceCursor } from "./editor-link"
import { PLANNER_MODEL, plannerSystemPrompt } from "./planner-prompt"

export type AgentId = "lead" | "cutter" | "captions" | "sound"

export const AGENT_COLORS: Record<AgentId, string> = {
  lead: "#f08c3a",
  cutter: "#ff7a5c",
  captions: "#f2d64b",
  sound: "#f28ad0",
}

export type AgentState = "waiting" | "working" | "done" | "skipped" | "failed"

type Vars = Record<string, string | number>

export type RunEvent =
  | { readonly type: "plan"; readonly plan: EditPlan }
  /** An agent's state; `detail` is the provider's own words about a step that failed. */
  | { readonly type: "agent"; readonly agent: AgentId; readonly state: AgentState; readonly key: MessageKey; readonly vars?: Vars; readonly progress?: number; readonly detail?: string }
  | { readonly type: "feed"; readonly agent: AgentId; readonly key: MessageKey; readonly vars?: Vars }
  /** One undo entry this run made in the editor, with its label, in the order made. */
  | { readonly type: "recorded"; readonly label: string }
  | { readonly type: "done"; readonly summary: RunSummary }

export interface RunSummary {
  readonly fromSeconds: number
  readonly toSeconds: number
  readonly pausesCut: number
  readonly fillersCut: number
  readonly captions: number
  readonly music: boolean
}

export interface RunAiEditOptions {
  readonly request: string
  readonly videoUrl: string
  readonly link: EditorLink
  readonly signal: AbortSignal
  /** The agents' names and the steps' undo labels, in the person's language. */
  readonly names: Record<AgentId, string>
  readonly stepLabels: Record<EditStep, string>
  readonly onEvent: (event: RunEvent) => void
  /** How fast the show runs: 1 is the normal pace, 2 twice as fast. */
  readonly pace?: () => number
}

/** A run that stopped on purpose (the person pressed Stop or closed the editor). */
export class RunStopped extends Error {
  constructor() {
    super("Stopped")
    this.name = "RunStopped"
  }
}

/**
 * A run that could not go on, with what the panel tells the person. `detail` is
 * the provider's own words about a failed step, shown under the sentence.
 */
export class RunFailed extends Error {
  constructor(
    readonly key: MessageKey,
    readonly vars?: Vars,
    readonly detail?: string,
  ) {
    super(key)
    this.name = "RunFailed"
  }
}

class JobTimedOut extends Error {}

/** A job that failed for good: its sentence, with the provider's words when it had any. */
class JobFailed extends Error {
  constructor(
    message: string,
    readonly errorDetail?: string,
  ) {
    super(message)
    this.name = "JobFailed"
  }
}

/** A word as the feed names it: "um" for the transcript's "um,". */
const bareWord = (text: string) => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || text

/** A job whose status cannot be read (signed out): it may still run, so it stays open to be cancelled. */
class JobUnreadable extends Error {
  constructor() {
    super("unreadable")
    this.name = "JobUnreadable"
  }
}

/** The provider's words a failed step carries, for the panel to show under its sentence. */
const wordsOf = (error: unknown): string | undefined =>
  error instanceof JobFailed && error.errorDetail ? error.errorDetail : undefined

const JOB_POLL_MS = 1500
const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000
const MUSIC_TIMEOUT_MS = 6 * 60_000
/** Longer videos are refused for now: the show, the undo history and the cost all grow with length. */
export const MAX_VIDEO_MINUTES = 20
/** At most this many cut steps and caption steps, whatever the length: more ranges share a step. */
const MAX_CUT_STEPS = 12
const MAX_CAPTION_STEPS = 10

function checkStop(signal: AbortSignal) {
  if (signal.aborted) throw new RunStopped()
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunStopped())
    const onAbort = () => {
      clearTimeout(timer)
      reject(new RunStopped())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

const statusOf = (error: unknown) => (error as { status?: unknown } | null)?.status

/** A job's output once it completes. Throws when it fails, is gone, or takes too long. */
async function waitForJob(jobId: string, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
  const end = Date.now() + timeoutMs
  for (;;) {
    checkStop(signal)
    try {
      const job = await getJobStatusLean(jobId)
      if (job.status === "completed") return (job.output_data ?? {}) as Record<string, unknown>
      if (job.status === "failed" || job.status === "cancelled") throw new JobFailed(job.error_message ?? "failed", job.error_detail ?? undefined)
    } catch (error) {
      if (error instanceof JobFailed) throw error
      const status = statusOf(error)
      // A job this person cannot see, or one that is gone, will not come back.
      if (status === 403 || status === 404 || status === 410) throw new JobFailed(String(status))
      // Signed out: the job may still be running, so it stays open to be cancelled.
      if (status === 401) throw new JobUnreadable()
      // Anything else (the API restarting, the network) is waited out, up to the job's own deadline.
    }
    if (Date.now() > end) throw new JobTimedOut()
    await pause(JOB_POLL_MS, signal)
  }
}

/** What the panel says about an error from a route, a job or the editor. */
function keyOf(error: unknown): MessageKey {
  if (error instanceof RunFailed) return error.key
  if (error instanceof InsufficientCreditsError) return "freecutAi.noCredits"
  if (error instanceof JobTimedOut) return "freecutAi.tooSlow"
  if (error instanceof JobFailed) return "freecutAi.jobFailed"
  if (error instanceof JobUnreadable) return "freecutAi.signedOut"
  if (error instanceof EditorLinkError) return "freecutAi.editorNoAnswer"
  return "freecutAi.unexpected"
}

async function readPlan(request: string, userId: string, signal: AbortSignal): Promise<EditPlan> {
  try {
    const { generatedText } = await generateAIWriterStream({
      systemPrompt: plannerSystemPrompt(),
      userInput: request,
      temperature: 0.2,
      maxTokens: 400,
      userId,
      llmModel: PLANNER_MODEL,
      onToken: () => {},
      signal,
    })
    return parseModelPlan(generatedText) ?? planFromRequest(request)
  } catch (error) {
    if (signal.aborted) throw new RunStopped()
    // No credits for the planner means none for the transcription either: say so now.
    if (error instanceof InsufficientCreditsError) throw new RunFailed("freecutAi.noCredits")
    // The planner only reads the request: its words alone are a fair second reading.
    console.warn("[Edit with AI] the planner did not answer; reading the request directly", error)
    return planFromRequest(request)
  }
}

/** The first audio address a finished music job gives (Suno tracks are re-hosted on our storage). */
function trackUrlOf(output: Record<string, unknown>): string | null {
  const direct = [output.audioUrl, output.url, output.generatedAudioUrl].find((v) => typeof v === "string" && v.length > 0)
  if (typeof direct === "string") return direct
  const urls = output.audioUrls
  if (Array.isArray(urls)) return urls.find((u): u is string => typeof u === "string" && u.length > 0) ?? null
  return null
}

const fileNameOfUrl = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    return ""
  }
}

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
}

/** The audio container the first bytes name, or null. */
function sniffAudio(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => (bytes.length >= to ? String.fromCharCode(...bytes.subarray(from, to)) : "")
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav"
  if (ascii(0, 3) === "ID3") return "mp3"
  if (ascii(0, 4) === "OggS") return "ogg"
  if (ascii(0, 4) === "fLaC") return "flac"
  if (ascii(4, 8) === "ftyp") return "m4a"
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm"
  // A frame sync: layer bits 00 are AAC in ADTS, anything else an MPEG audio layer.
  if (bytes[0] === 0xff && bytes.length > 1 && (bytes[1]! & 0xe0) === 0xe0) return (bytes[1]! & 0x06) === 0 ? "aac" : "mp3"
  return null
}

/**
 * The name and type the music is imported under, as its bytes are. The bytes
 * decide first: a Suno track's address says ".wav" and its response says
 * audio/wav while the file is an MP3. Then the address, then the response's type.
 */
export function musicFileOf(buffer: ArrayBuffer, url: string, contentType: string | null): { readonly name: string; readonly type: string } {
  const sniffed = sniffAudio(new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength)))
  const ext = sniffed ?? /\.([a-z0-9]{2,5})$/i.exec(fileNameOfUrl(url))?.[1]?.toLowerCase()
  if (ext && AUDIO_TYPES[ext]) return { name: `ai-music.${ext}`, type: AUDIO_TYPES[ext] }
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (/^audio\/(x-)?wave?$/.test(type)) return { name: "ai-music.wav", type: "audio/wav" }
  const known = Object.entries(AUDIO_TYPES).find(([, t]) => t === type)
  return known ? { name: `ai-music.${known[0]}`, type: known[1] } : { name: "ai-music.mp3", type: "audio/mpeg" }
}

interface MediaView {
  readonly id: string
  readonly fileName?: string
  readonly duration?: number
}

/**
 * The media the person opened the editor on: the only video media on the
 * timeline, or, when there are several, the one named like the video's file.
 * Refused when it cannot be told apart: cuts timed from one file must never
 * land on another.
 */
export function openedVideoMedia(timeline: TimelineView, media: readonly MediaView[], videoUrl: string): MediaView | null {
  const ids = [...new Set(timeline.items.filter((i) => i.type === "video" && i.mediaId).map((i) => i.mediaId!))]
  if (ids.length === 0) return null
  const known = (id: string): MediaView => media.find((m) => m.id === id) ?? { id }
  if (ids.length === 1) return known(ids[0]!)
  const name = fileNameOfUrl(videoUrl)
  const named = ids.map(known).filter((m) => name && m.fileName === name)
  if (named.length === 1) return named[0]!
  throw new RunFailed("freecutAi.manyVideos")
}

/** Split a list into at most `steps` consecutive groups. */
function groupInto<T>(items: readonly T[], steps: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / steps))
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
}

interface Stage {
  timeline: TimelineView
  readonly mediaId: string
}

const secondsText = (seconds: number) => formatNumber(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export async function runAiEdit(opts: RunAiEditOptions): Promise<RunSummary> {
  const { link, signal, names, stepLabels, onEvent } = opts
  const pace = () => Math.max(0.25, opts.pace?.() ?? 1)
  const beat = (ms: number) => pause(ms / pace(), signal)
  const cursors = new Map<AgentId, PresenceCursor>()
  const show = (highlights: Parameters<EditorLink["presence"]>[1] = []) => link.presence([...cursors.values()], highlights)
  const cursor = (agent: AgentId, place: Omit<PresenceCursor, "id" | "name" | "color">) => {
    cursors.set(agent, { id: agent, name: names[agent], color: AGENT_COLORS[agent], ...place })
  }
  const agent = (id: AgentId, state: AgentState, key: MessageKey, vars?: Vars, progress?: number, detail?: string) =>
    onEvent({ type: "agent", agent: id, state, key, vars, progress, ...(detail ? { detail } : {}) })
  const feed = (id: AgentId, key: MessageKey, vars?: Vars) => onEvent({ type: "feed", agent: id, key, vars })

  // Jobs this run started that are still open: cancelled if the run ends early.
  const openJobs = new Set<string>()
  // Set once the run is over: a job whose id arrives later is cancelled at once.
  let ended = false
  const startJob = async (start: () => Promise<{ jobId: string }>) => {
    const { jobId } = await start()
    if (ended) {
      void cancelJob(jobId).catch(() => undefined)
      throw new RunStopped()
    }
    openJobs.add(jobId)
    return jobId
  }
  // A job that finished, or failed for good, is closed; one left by a stop or a timeout stays open to be cancelled.
  const finishJob = async (jobId: string, timeoutMs: number) => {
    try {
      const output = await waitForJob(jobId, signal, timeoutMs)
      openJobs.delete(jobId)
      return output
    } catch (error) {
      if (error instanceof JobFailed) openJobs.delete(jobId)
      throw error
    }
  }

  // An editor request that failed: three in a row means the editor is no longer ours.
  let refusedInARow = 0
  const apply = async (label: string, ops: ReadonlyArray<Record<string, unknown>>, stage: Stage): Promise<OpsResult | null> => {
    checkStop(signal)
    const result = await link.applyOps(label, ops)
    if (!result.ok) {
      refusedInARow += 1
      console.warn("[Edit with AI] the editor refused a step", result.error)
      if (refusedInARow >= 3) throw new RunFailed("freecutAi.editorChanged")
      return null
    }
    refusedInARow = 0
    const next = readTimelineView(result.timeline)
    if (next) stage.timeline = next
    if (result.recorded !== false) onEvent({ type: "recorded", label })
    return result
  }

  try {
    const userId = await getCurrentUserId()
    if (!userId) throw new RunFailed("freecutAi.signedOut")
    const report = (await link.getTimeline()) as { media?: unknown } | null
    const first = readTimelineView(report)
    if (!first) throw new RunFailed("freecutAi.noVideo")
    const media = (Array.isArray(report?.media) ? report!.media : []) as MediaView[]
    const opened = openedVideoMedia(first, media, opts.videoUrl)
    if (!opened) throw new RunFailed("freecutAi.noVideo")
    const clip = first.items.find((i) => i.mediaId === opened.id)
    const mediaSeconds = opened.duration ?? (clip?.sourceEnd !== undefined ? clip.sourceEnd / (clip.sourceFps ?? first.fps) : timelineSeconds(first))
    if (mediaSeconds > MAX_VIDEO_MINUTES * 60) throw new RunFailed("freecutAi.tooLong", { minutes: MAX_VIDEO_MINUTES })

    const stage: Stage = { timeline: first, mediaId: opened.id }
    const fromSeconds = timelineSeconds(first)
    const summary = { pausesCut: 0, fillersCut: 0, captions: 0, music: false }

    // ── listening and reading the request, side by side ──
    cursor("lead", { preview: { x: 0.5, y: 0.42 } })
    show()
    agent("lead", "working", "freecutAi.listening")
    const transcription = startJob(() => transcribeApi(opts.videoUrl, "elevenlabs-stt", undefined, userId, false, false, true))
    transcription.catch(() => undefined)
    const plan = await readPlan(opts.request, userId, signal)
    checkStop(signal)
    onEvent({ type: "plan", plan })
    for (const id of ["cutter", "captions", "sound"] as const) agent(id, "waiting", "freecutAi.waiting")

    let words: TimedWord[]
    let language: string | null
    try {
      const transcript = (await finishJob(await transcription, TRANSCRIBE_TIMEOUT_MS)).json
      words = wordsFromTranscript(transcript)
      language = transcriptLanguage(transcript)
    } catch (error) {
      if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
      const key: MessageKey = error instanceof InsufficientCreditsError ? "freecutAi.noCredits" : error instanceof JobUnreadable ? "freecutAi.signedOut" : "freecutAi.listenFailed"
      throw new RunFailed(key, undefined, wordsOf(error))
    }
    feed("lead", words.length > 0 ? "freecutAi.heardWords" : "freecutAi.noSpeech", { n: words.length })

    // The music is paid for only once the video has been heard; it is laid down last.
    const music =
      plan.steps.includes("music") && plan.musicStyle
        ? startJob(() => sunoGenerateApi({ prompt: plan.musicStyle!, instrumental: true, customMode: false, userId })).then((id) => finishJob(id, MUSIC_TIMEOUT_MS))
        : null
    music?.catch(() => undefined)
    agent("lead", "done", "freecutAi.planned")
    cursors.delete("lead")
    show()

    // ── the Cutter: filler words, and the pauses around them ──
    const cutFillers = plan.steps.includes("fillers")
    const cutPauses = plan.steps.includes("pauses")
    // Filler sounds are the video's own language's: "um" is a word in Portuguese.
    const spoken = cutFillers ? words.filter((w) => !isFillerWord(w, language)) : words
    const fillers = cutFillers ? fillerRanges(words, language) : []
    // With the fillers gone, the silence around each one is one pause.
    const ranges = mergeRanges([...fillers, ...(cutPauses ? pauseRanges(spoken, mediaSeconds) : [])])
    const fillerIn = (r: SecondsRange) => fillers.filter((f) => f.start >= r.start - 0.05 && f.end <= r.end + 0.05)
    if (!cutFillers && !cutPauses) {
      agent("cutter", "skipped", "freecutAi.notAsked")
    } else if (words.length === 0 || ranges.length === 0) {
      agent("cutter", "done", words.length === 0 ? "freecutAi.noSpeech" : "freecutAi.nothingToCut")
    } else {
      const steps = groupInto(ranges, MAX_CUT_STEPS)
      agent("cutter", "working", "freecutAi.cutting", { done: 0, total: ranges.length }, 0)
      let done = 0
      let refused = 0
      for (const step of steps) {
        const firstRange = step[0]!
        const at = timelineFrameOf(stage.timeline, stage.mediaId, (firstRange.start + firstRange.end) / 2)
        const from = timelineFrameOf(stage.timeline, stage.mediaId, firstRange.start)
        const to = timelineFrameOf(stage.timeline, stage.mediaId, Math.max(firstRange.start, firstRange.end - 0.01))
        if (at) {
          // The cursor stands where the cut starts, beside the playhead, which the editor keeps in view.
          cursor("cutter", { frame: (from ?? at).frame, trackId: at.trackId })
          link.playback("seek", Math.max(0, (from ?? at).frame - 2))
          show(from && to ? [{ id: "cut", color: AGENT_COLORS.cutter, trackId: at.trackId, from: from.frame, to: Math.max(from.frame + 1, to.frame) }] : [])
          await beat(520)
        }
        const label = cutPauses ? stepLabels.pauses : stepLabels.fillers
        const result = await apply(label, [{ op: "removeSourceRanges", mediaId: stage.mediaId, ranges: step }], stage)
        if (result) {
          for (const r of step) {
            const removed = fillerIn(r)
            summary.fillersCut += removed.length
            if (removed.length === 0 || r.end - r.start - removed.reduce((n, f) => n + f.end - f.start, 0) > 0.3) summary.pausesCut += 1
            if (removed.length > 0) feed("cutter", "freecutAi.cutFiller", { word: removed.map((f) => bareWord(f.word)).join(" ") })
            else feed("cutter", "freecutAi.cutPause", { seconds: secondsText(r.end - r.start) })
          }
        } else {
          refused += step.length
          feed("cutter", "freecutAi.opFailed")
        }
        done += step.length
        agent("cutter", "working", "freecutAi.cutting", { done, total: ranges.length }, done / ranges.length)
        await beat(260)
      }
      const removedSeconds = fromSeconds - timelineSeconds(stage.timeline)
      if (refused === ranges.length) agent("cutter", "failed", "freecutAi.opFailed", undefined, 1)
      else agent("cutter", "done", "freecutAi.cutDone", { seconds: secondsText(Math.max(0, removedSeconds)) }, 1)
    }
    cursors.delete("cutter")
    show()

    // ── Captions: written along with the voice ──
    if (!plan.steps.includes("captions")) {
      agent("captions", "skipped", "freecutAi.notAsked")
    } else if (words.length === 0) {
      agent("captions", "skipped", "freecutAi.noSpeech")
    } else {
      const cues = captionCues(spoken)
      const steps = groupInto<CaptionCue>(cues, MAX_CAPTION_STEPS)
      agent("captions", "working", "freecutAi.captioning", { done: 0, total: cues.length }, 0)
      let done = 0
      for (const step of steps) {
        const at = timelineFrameOf(stage.timeline, stage.mediaId, step[0]!.start)
        if (at) {
          cursor("captions", { frame: at.frame, trackId: at.trackId })
          link.playback("seek", at.frame)
          show()
        }
        const result = await apply(stepLabels.captions, [{ op: "addTranscriptCaptions", mediaId: stage.mediaId, cues: step }], stage)
        if (result) {
          summary.captions += step.length
          feed("captions", "freecutAi.captioned", { text: step.map((c) => c.text).join(" ") })
        } else {
          feed("captions", "freecutAi.opFailed")
        }
        done += step.length
        agent("captions", "working", "freecutAi.captioning", { done, total: cues.length }, done / cues.length)
        await beat(380)
      }
      if (summary.captions > 0) agent("captions", "done", "freecutAi.captionsDone", { n: summary.captions }, 1)
      else agent("captions", "failed", "freecutAi.captionsFailed", undefined, 1)
    }
    cursors.delete("captions")
    show()

    // ── Sound: the music, under the voice ──
    if (!music) {
      agent("sound", "skipped", "freecutAi.notAsked")
    } else {
      agent("sound", "working", "freecutAi.composing")
      cursor("sound", { preview: { x: 0.82, y: 0.82 } })
      show()
      try {
        const url = trackUrlOf(await music)
        if (!url) throw new JobFailed("no track")
        const response = await fetch(url, { signal })
        if (!response.ok) throw new JobFailed(`download ${response.status}`)
        const buffer = await response.arrayBuffer()
        checkStop(signal)
        const ref = `ai-music-${Date.now().toString(36)}`
        // Read before the import: the buffer is handed over to the editor.
        const file = musicFileOf(buffer, url, response.headers.get("content-type"))
        link.importFile(ref, file.name, file.type, buffer)
        const placed = await apply(
          stepLabels.music,
          [{ op: "placeAudio", ref, from: 0, durationInFrames: stage.timeline.durationInFrames, volumeDb: -16, fadeOutSeconds: 1.5, newTrack: true }],
          stage,
        )
        if (!placed) throw new JobFailed("placement refused")
        summary.music = true
        const id = (placed.results?.[0] as { id?: unknown } | undefined)?.id
        if (typeof id === "string") {
          cursor("sound", { item: id })
          show()
          await beat(700)
        }
        agent("sound", "done", "freecutAi.musicDone")
        feed("sound", "freecutAi.musicDone")
      } catch (error) {
        if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
        console.warn("[Edit with AI] music", error)
        agent("sound", "failed", error instanceof InsufficientCreditsError ? "freecutAi.musicNoCredits" : "freecutAi.musicFailed", undefined, undefined, wordsOf(error))
      }
    }

    cursors.clear()
    show()
    link.playback("seek", 0)
    const result: RunSummary = { fromSeconds, toSeconds: timelineSeconds(stage.timeline), ...summary }
    onEvent({ type: "done", summary: result })
    return result
  } catch (error) {
    if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
    if (!(error instanceof RunFailed)) console.warn("[Edit with AI] the run stopped", error)
    throw error instanceof RunFailed ? error : new RunFailed(keyOf(error), undefined, wordsOf(error))
  } finally {
    // Paid work nobody will use is cancelled; nothing of the show stays drawn.
    ended = true
    for (const jobId of openJobs) void cancelJob(jobId).catch(() => undefined)
    try {
      link.presence([], [])
    } catch {
      // The editor has closed.
    }
  }
}

/**
 * Undo the undo entries a run made, newest first (`recorded`, in the order
 * they were made). The editor undoes an entry only when it is a request with
 * that label, so an edit the person made by hand on top stops it there.
 * Answers how many it reverted.
 */
export async function undoAiEdit(link: EditorLink, recorded: readonly string[]): Promise<number> {
  let reverted = 0
  for (const label of [...recorded].reverse()) {
    if (!(await link.undoEdit(label)).undone) break
    reverted += 1
  }
  return reverted
}
