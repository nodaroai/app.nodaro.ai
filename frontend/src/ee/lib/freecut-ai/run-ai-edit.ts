/**
 * One Edit with AI run, end to end, in front of the person.
 *
 * The request is read first: a request made of the cards' own words at once,
 * one in the person's own words by the planner. Nothing paid starts before the
 * plan has a step the person wants, and a plan that costs more than the price
 * shown is asked about first. Then the video is listened to (once per video,
 * only when a step reads the words) and every slow job starts together: the
 * music, the b-roll images, the picture change, face tracking, the planning of
 * mistakes, clips, a trailer and chapters.
 *
 * The agents then take their turns on the editor's real timeline while the
 * others' cursors show their work in progress: the Director, the Cutter (the
 * pauses and the ums first, shown one by one, then the mistakes), Color beside
 * it, Captions, the Framer's phone version, the zooms, B-roll, Picture, Sound,
 * and the Assistant's clips, trailer and chapters. Each turn ends by playing a
 * moment of its result; the run ends with the original and the edit side by
 * side. One ability failing never stops the others: its card says why.
 */
import type { MessageKey } from "@/lib/i18n"
import { InsufficientCreditsError, getCurrentUserId, llmStructuredApi } from "@/lib/api"
import { ABILITY_NAME, ABILITY_OF, listensFor, type AgentId } from "./abilities"
import type { PhoneFraming } from "./crop-path"
import { readTimelineView, timelineSeconds, type EditPlan, type EditStep, type MediaView, type SecondsRange, type TimelineView } from "./edit-plan"
import { EditorLinkError, type EditorLink } from "./editor-link"
import { PAID_STEPS } from "./panel-model"
import { PLANNER_EFFORT, PLANNER_MODEL, PLANNER_SCHEMA, plannerSystemPrompt } from "./planner-prompt"
import { cardOnlyPlan, parseModelPlan, planFromRequest, type CardPhrase } from "./request-reading"
import { brollCount, makeShots, placeShots, type Shot } from "./run/broll"
import { placeTitles, titleCount } from "./run/titles"
import { DEFAULT_TITLE_LOOK, type TitleLook } from "./title-style"
import { anglesOf, runCameras } from "./run/cameras"
import { CAPTIONS_LABEL, runCaptions } from "./run/captions"
import { RunContext } from "./run/context"
import { creativePass, type CreativeChoices } from "./run/creative"
import { joinCuts, mistakeRanges, runCuts, speechCuts, type CutRange } from "./run/cut"
import { JobUnreadable, keyOf, untilStopped, wordsOf } from "./run/jobs"
import { listen } from "./run/listen"
import { runColor, runZoom } from "./run/look"
import { buildChapters, buildClips, buildTrailer, plansTrailer, startPlan, TRAILER_SECONDS, type MadeOutcome } from "./run/make"
import { composeMusic, placeMusic, refitMusic } from "./run/music"
import { captionsOnSeam, clearEarlierLayout, faceTracks, runLayout } from "./run/layout"
import { applyPhone, framingOf, TRACK_MS } from "./run/phone"
import { PICTURE_MAX_SHOTS, PICTURE_MS, PictureLate, pictureSpans, placePicture, playheadSecond, spanLabel, startPicture } from "./run/picture"
import { EMPTY_SUMMARY, RunDeclined, RunFailed, RunStopped, type ExtraCharge, type HeardVideo, type RunEvent, type RunSummary, type Vars } from "./run/types"

export { AGENT_COLORS, RunDeclined, RunFailed, RunStopped } from "./run/types"
export type { AgentId, AgentState, DeclinedReason, ExtraCharge, HeardVideo, MadeResult, RunEvent, RunSummary } from "./run/types"
export { LISTEN_PROVIDER } from "./run/listen"
export { musicFileOf } from "./run/music"

/** Longer videos are refused for now. */
export const MAX_VIDEO_MINUTES = 180

/** What a run remembers of a video from the runs before it. */
export interface VideoState {
  readonly heard?: HeardVideo
  /** Steps done on this video that are not done again (an ability with no "again"). */
  readonly done?: readonly EditStep[]
  readonly framing?: PhoneFraming | null
  readonly colorEffects?: ReadonlyArray<{ readonly itemId: string; readonly effectId: string }>
}

export interface RunAiEditOptions extends VideoState {
  readonly request: string
  readonly videoUrl: string
  /** The video's file name as the editor shows it, when the host knows it. */
  readonly videoName?: string
  /** The steps the person was shown a price for: a plan that adds a paid part is asked about first. */
  readonly quoted?: readonly EditStep[]
  /** How many shots in a row a picture change is made on, from the playhead (one when not said). */
  readonly pictureShots?: number
  /** How many pictures to lay on the words, when the person chose a number. */
  readonly brollCount?: number
  /** How many texts to lay on the screen, when the person chose a number, and their look. */
  readonly titleCount?: number
  readonly titleLook?: TitleLook
  readonly link: EditorLink
  readonly signal: AbortSignal
  /** The editor's abilities (`FREECUT_READY.capabilities`). */
  readonly capabilities: readonly string[]
  readonly names: Record<AgentId, string>
  readonly stepLabels: Record<EditStep, string>
  /** A sentence in the person's language. */
  readonly say: (key: MessageKey, vars?: Vars) => string
  /** The cards' phrases in every language: a request made only of them starts at once. */
  readonly phrases: readonly CardPhrase[]
  /** The address of another video the panel knows, by the name the editor shows (another camera). */
  readonly urlOfName?: (fileName: string) => string | undefined
  readonly onEvent: (event: RunEvent) => void
  /** How fast the show runs: 1 is the normal pace; `SKIP_PACE` lands everything at once. */
  readonly pace?: () => number
  readonly confirmPartial?: (plan: EditPlan, extra: ExtraCharge) => Promise<boolean>
}

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

const fileNameOfUrl = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    return ""
  }
}

/**
 * The media to edit: the one the host named (`videoName`), else the only video
 * on the timeline, else the one named like the video's file, else (several
 * cameras) the first video of the edit. Refused when it cannot be told apart.
 */
export function openedVideoMedia(timeline: TimelineView, media: readonly MediaView[], videoUrl: string, videoName?: string, allowOthers = false): MediaView | null {
  const ids = [...new Set(timeline.items.filter((i) => i.type === "video" && i.mediaId).map((i) => i.mediaId!))]
  if (ids.length === 0) return null
  const known = (id: string): MediaView => media.find((m) => m.id === id) ?? { id }
  const onTimeline = ids.map(known)
  if (videoName) {
    const named = onTimeline.filter((m) => sameName(m.fileName, videoName))
    if (named.length === 1) return named[0]!
    if (onTimeline.length === 1 && !onTimeline[0]!.fileName) return onTimeline[0]!
    throw new RunFailed(named.length > 1 ? "freecutAi.manyVideos" : "freecutAi.videoGone")
  }
  if (onTimeline.length === 1) return onTimeline[0]!
  const named = onTimeline.filter((m) => sameName(m.fileName, fileNameOfUrl(videoUrl)))
  if (named.length === 1) return named[0]!
  if (allowOthers) {
    const first = timeline.items.filter((i) => i.type === "video" && i.mediaId).sort((a, b) => a.from - b.from)[0]
    if (first?.mediaId) return known(first.mediaId)
  }
  throw new RunFailed("freecutAi.manyVideos")
}

/** The planner's reading of a request in the person's own words; the words alone when it cannot answer. */
async function readPlan(request: string, signal: AbortSignal): Promise<EditPlan> {
  try {
    const { output } = await llmStructuredApi({
      system: plannerSystemPrompt(),
      input: request,
      jsonSchema: PLANNER_SCHEMA,
      schemaName: "edit_plan",
      llmModel: PLANNER_MODEL,
      reasoningEffort: PLANNER_EFFORT,
      signal,
    })
    const plan = parseModelPlan(output)
    if (plan) return plan
    console.warn("[Edit with AI] the planner's answer was not a plan; reading the request directly")
  } catch (error) {
    if (signal.aborted) throw new RunStopped()
    if (error instanceof InsufficientCreditsError) throw new RunFailed("freecutAi.noCredits")
    console.warn("[Edit with AI] the planner did not answer; reading the request directly", error)
  }
  const read = planFromRequest(request)
  if (read.steps.length === 0) throw new RunFailed("freecutAi.unreadable")
  return read
}

/** The steps that are paid beyond listening: the parts a price line names. */
const PAID: ReadonlySet<EditStep> = new Set<EditStep>(PAID_STEPS)
/** Failures that end the whole run, whichever ability met them. */
const FATAL_KEYS: ReadonlySet<string> = new Set<string>(["freecutAi.videoGone", "freecutAi.noVideo", "freecutAi.tabStuck"])

/** A promise that never rejects (its failure is read when its turn comes); `null` for a step not asked. */
const quiet = <T,>(p: Promise<T> | null): Promise<T> | null => {
  p?.catch(() => undefined)
  return p
}

export async function runAiEdit(opts: RunAiEditOptions): Promise<RunSummary> {
  const { link, signal, onEvent } = opts
  const userId = await getCurrentUserId()
  if (!userId) throw new RunFailed("freecutAi.signedOut")

  // The opened video, as the editor holds it now: refused before anything is read or paid for.
  const readStage = async () => {
    const view = readTimelineView(await link.getTimeline())
    if (!view) throw new RunFailed("freecutAi.noVideo")
    const video = openedVideoMedia(view, view.media ?? [], opts.videoUrl, opts.videoName, true)
    if (!video) throw new RunFailed("freecutAi.noVideo")
    const clip = view.items.find((i) => i.mediaId === video.id)
    const seconds = video.duration ?? (clip?.sourceEnd !== undefined ? clip.sourceEnd / (clip.sourceFps ?? view.fps) : timelineSeconds(view))
    if (seconds > MAX_VIDEO_MINUTES * 60) throw new RunFailed("freecutAi.tooLong", { minutes: MAX_VIDEO_MINUTES })
    return { timeline: view, mediaId: video.id, mediaSeconds: seconds }
  }
  const first = await readStage()
  const ctx = new RunContext(
    { link, signal, capabilities: opts.capabilities, names: opts.names, stepLabels: opts.stepLabels, onEvent, pace: opts.pace ?? (() => 1), userId, say: opts.say },
    first,
  )
  /** The background tickers that show the agents waiting on their jobs. */
  const tickers = new Set<ReturnType<typeof setInterval>>()

  try {
    // ── reading the request: nothing paid starts before the plan has a step ──
    onEvent({ type: "phase", phase: "reading" })
    ctx.show.at("lead", { preview: { x: 0.5, y: 0.42 } }, { note: opts.say("freecutAi.note.reading") })
    const read = cardOnlyPlan(opts.request, opts.phrases) ?? (await readPlan(opts.request, signal))
    if (signal.aborted) throw new RunStopped()
    const once = (step: EditStep) => !ABILITY_OF[step]?.again && !!opts.done?.includes(step)
    // Steps this editor cannot do yet, and Switch cameras without a second camera, are said plainly.
    const missing = read.steps.filter((step) => ABILITY_OF[step]?.needs === "edit-ops-2" && !ctx.has("edit-ops-2"))
    const angles = read.steps.includes("cameras") ? anglesOf(ctx, opts.urlOfName ?? (() => undefined)) : []
    const noCameras = read.steps.includes("cameras") && angles.length === 0
    const plan: EditPlan = {
      ...read,
      steps: read.steps.filter((step) => !once(step) && !missing.includes(step) && !(step === "cameras" && noCameras)),
      cannot: [
        ...read.cannot,
        ...missing.map((step) => opts.say("freecutAi.needsEditorUpdate", { name: opts.say(ABILITY_NAME[step]) })),
        ...(noCameras ? [opts.say("freecutAi.camerasNone")] : []),
      ],
    }
    onEvent({ type: "plan", plan })
    if (plan.steps.length === 0) throw new RunDeclined(plan, read.steps.length > 0 && read.steps.every(once) ? "done" : undefined)
    const quoted = opts.quoted ?? plan.steps
    const extra: ExtraCharge = {
      listen: !opts.heard && listensFor(plan.steps) && !listensFor(quoted),
      steps: plan.steps.filter((step) => PAID.has(step) && !quoted.includes(step)),
    }
    if ((plan.cannot.length > 0 || extra.listen || extra.steps.length > 0) && opts.confirmPartial) {
      if (!(await untilStopped(opts.confirmPartial(plan, extra), signal))) throw new RunDeclined(plan)
      ctx.timeline = (await readStage()).timeline
    }
    if (signal.aborted) throw new RunStopped()
    ctx.show.clear("lead")

    const steps = new Set(plan.steps)
    const fromSeconds = timelineSeconds(ctx.timeline)
    const summary: { -readonly [K in keyof typeof EMPTY_SUMMARY]: (typeof EMPTY_SUMMARY)[K] } = { ...EMPTY_SUMMARY }
    for (const step of plan.steps) ctx.step(step, "waiting", "freecutAi.waiting")

    /** One ability (or the steps one pass does together), on its own: a failure is its cards', never the run's. */
    const attempt = async (step: EditStep | readonly EditStep[], work: () => Promise<void>) => {
      try {
        await work()
      } catch (error) {
        if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
        if (error instanceof JobUnreadable) throw new RunFailed("freecutAi.signedOut")
        if (error instanceof EditorLinkError) throw error
        // The video gone, or the editor left on another tab: nothing more can land where it should.
        if (error instanceof RunFailed && FATAL_KEYS.has(error.key)) throw error
        console.warn(`[Edit with AI] ${String(step)}`, error)
        for (const s of typeof step === "string" ? [step] : step) {
          ctx.step(s, "failed", error instanceof InsufficientCreditsError ? "freecutAi.noCreditsStep" : keyOf(error), undefined, 1, wordsOf(error))
        }
      }
    }
    const refused = (step: EditStep, reason: string | undefined) => ctx.step(step, "failed", "freecutAi.editorRefused", undefined, 1, reason)
    const count = (step: EditStep, n: number, one: MessageKey, many: MessageKey, vars: Vars = {}) => ctx.step(step, "done", n === 1 ? one : many, { n, ...vars }, 1)
    const feeNote = (step: EditStep, out: MadeOutcome) => (out.feeFailed ? ctx.feed("lead", "freecutAi.feeFailed", { reason: out.feeFailed }) : undefined)
    /** While an agent waits for its job, its cursor shows the work at its own place. */
    const waitingShow = (agent: AgentId, target: string, startedAt: number, expectMs: number, note: (p: number) => string, until: Promise<unknown>) => {
      const id = setInterval(() => {
        const p = Math.min(0.95, (Date.now() - startedAt) / expectMs)
        ctx.show.progress(agent, target, p, note(p))
      }, 1500)
      tickers.add(id)
      until.then(
        () => (clearInterval(id), tickers.delete(id)),
        () => (clearInterval(id), tickers.delete(id)),
      )
    }

    // ── listening: once per video, and only for a step that reads the words ──
    let heard = opts.heard
    if (!heard && listensFor(plan.steps)) {
      onEvent({ type: "phase", phase: "listening" })
      ctx.working("lead", true)
      try {
        heard = await listen(ctx, opts.videoUrl)
      } catch (error) {
        if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
        const key: MessageKey = error instanceof InsufficientCreditsError ? "freecutAi.noCredits" : error instanceof JobUnreadable ? "freecutAi.signedOut" : "freecutAi.listenFailed"
        throw new RunFailed(key, undefined, wordsOf(error))
      }
      onEvent({ type: "heard", heard })
      ctx.feed("lead", heard.words.length > 0 ? "freecutAi.heardWords" : "freecutAi.noSpeech", { n: heard.words.length })
      ctx.working("lead", false)
    }
    onEvent({ type: "phase", phase: "working" })
    const words = heard?.words ?? []
    for (const step of plan.steps) {
      if (ABILITY_OF[step]?.listens && words.length === 0) {
        ctx.step(step, "skipped", "freecutAi.noSpeech")
        steps.delete(step)
      }
    }
    const listened = heard && words.length > 0 ? heard : undefined

    // ── every slow job starts now ──
    const fillersGoneAtStart = steps.has("fillers") || !!opts.done?.includes("fillers")
    const speech = listened ? speechCuts(words, listened.language, ctx.mediaSeconds, { pauses: steps.has("pauses"), fillers: steps.has("fillers"), fillersGone: fillersGoneAtStart }) : []
    const creative: Promise<CreativeChoices | null> = (steps.has("broll") || steps.has("titles") || steps.has("zoom") || (steps.has("trailer") && !plansTrailer())) && listened
      ? creativePass(ctx, words, {
          broll: steps.has("broll"),
          brollCount: brollCount(ctx.mediaSeconds, opts.brollCount),
          titles: steps.has("titles"),
          titleCount: titleCount(ctx.mediaSeconds, opts.titleCount),
          zoom: steps.has("zoom"),
          musicStyle: steps.has("music") && plan.params.musicStyle === null,
          trailer: steps.has("trailer") && !plansTrailer(),
          request: opts.request,
        }).catch((error: unknown) => {
          if (signal.aborted) throw new RunStopped()
          console.warn("[Edit with AI] creative pass", error)
          return null
        })
      : Promise.resolve(null)
    const musicStarted = Date.now()
    const music = quiet(steps.has("music") ? (async () => composeMusic(ctx, plan.params.musicStyle ?? (await creative)?.musicStyle ?? "upbeat modern background music, light percussion, positive, instrumental"))() : null)
    const mistakes = quiet(steps.has("mistakes") && listened ? mistakeRanges(ctx, listened, opts.videoUrl) : null)
    // One look at the faces serves the phone version, the speaker layout and the clips.
    const faces = quiet(steps.has("layout") || steps.has("phone") || (steps.has("clips") && !opts.framing) ? faceTracks(ctx, opts.videoUrl, listened) : null)
    const tracking = quiet(faces ? faces.then((set) => framingOf(ctx, set, listened)) : null)
    const trackingStarted = Date.now()
    const portrait = steps.has("phone") || ctx.canvas.height > ctx.canvas.width
    const shots: Promise<ReadonlyArray<Promise<Shot>>> | null = steps.has("broll") ? creative.then((c) => makeShots(ctx, c?.broll ?? [], portrait)) : null
    const spans: SecondsRange[] =
      steps.has("picture") && plan.params.picture ? pictureSpans(ctx.mediaSeconds, speech, playheadSecond(ctx.timeline, ctx.mediaId, ctx.timeline.currentFrame), Math.min(PICTURE_MAX_SHOTS, Math.max(1, opts.pictureShots ?? 1))) : []
    const span: SecondsRange | null = spans[0] ?? null
    /** All the seconds the change is made on, first to last. */
    const whole: SecondsRange | null = span ? { start: span.start, end: spans[spans.length - 1]!.end } : null
    const pictureStarted = Date.now()
    // Every shot is rendered at once; each is laid in its turn.
    const pictures = plan.params.picture ? spans.map((s) => quiet(startPicture(ctx, plan.params.picture!, opts.videoUrl, s))!) : []
    const picture = pictures[0] ?? null
    if (whole) ctx.step("picture", "working", "freecutAi.pictureSelecting", spanLabel(whole), 0.05)
    else if (steps.has("picture")) {
      ctx.step("picture", "skipped", "freecutAi.pictureNoShot")
      steps.delete("picture")
    }
    const clipsPlan = quiet(steps.has("clips") && listened ? startPlan(ctx, listened, opts.videoUrl, "clips", { count: plan.params.clips }) : null)
    const trailerPlan = quiet(steps.has("trailer") && listened && plansTrailer() ? startPlan(ctx, listened, opts.videoUrl, "trailer", { targetDurationSec: TRAILER_SECONDS }) : null)
    const chaptersPlan = quiet(steps.has("chapters") && listened ? startPlan(ctx, listened, opts.videoUrl, "chapters") : null)

    // The waiting agents, shown at work in their places while the others take their turns.
    if (music) waitingShow("sound", "panel.media", musicStarted, 45_000, (p) => opts.say("freecutAi.note.composing", { p: Math.round(p * 100) }), music)
    if (picture) waitingShow("picture", "preview", pictureStarted, PICTURE_MS, (p) => opts.say("freecutAi.note.rendering", { p: Math.round(p * 100) }), picture)
    if (tracking && steps.has("phone")) waitingShow("framer", "preview", trackingStarted, TRACK_MS, () => opts.say("freecutAi.note.tracking"), tracking)

    // ── the Director: other cameras first, so every later step lands on the switched edit ──
    if (steps.has("cameras") && listened) {
      await attempt("cameras", async () => {
        const out = await runCameras(ctx, listened, opts.videoUrl, angles)
        if (out.refused) return refused("cameras", out.refused)
        summary.switches = out.switches
        count("cameras", out.switches, "freecutAi.switchedDoneOne", "freecutAi.switchedDone")
      })
    }

    // ── the Cutter's first pass (pauses and ums), with Color beside it ──
    let cutAny = false
    const colorLane = steps.has("color")
      ? attempt("color", async () => {
          const out = await runColor(ctx, plan.params.look, opts.colorEffects ?? [])
          if (out.refused) return refused("color", out.refused)
          summary.look = plan.params.look
          onEvent({ type: "color", effects: out.effects })
          ctx.step("color", "done", `freecutAi.look.${plan.params.look}` as MessageKey, undefined, 1)
        })
      : null
    const cutPass = async (cuts: readonly CutRange[], kinds: ReadonlyArray<"pauses" | "fillers" | "mistakes">) => {
      const out = await runCuts(ctx, joinCuts(cuts))
      cutAny = cutAny || out.pausesCut + out.fillersCut + out.mistakesCut > 0
      summary.pausesCut += out.pausesCut
      summary.fillersCut += out.fillersCut
      summary.mistakesCut += out.mistakesCut
      const removed = Math.max(0, fromSeconds - timelineSeconds(ctx.timeline)).toFixed(1)
      const report: Record<"pauses" | "fillers" | "mistakes", readonly [number, MessageKey, MessageKey, MessageKey]> = {
        pauses: [out.pausesCut, "freecutAi.summaryPausesOne", "freecutAi.summaryPauses", "freecutAi.nothingToCut"],
        fillers: [out.fillersCut, "freecutAi.summaryFillersOne", "freecutAi.summaryFillers", "freecutAi.noFillers"],
        mistakes: [out.mistakesCut, "freecutAi.summaryMistakesOne", "freecutAi.summaryMistakes", "freecutAi.noMistakes"],
      }
      for (const kind of kinds) {
        const [n, one, many, none] = report[kind]
        if (out.refused && n === 0) refused(kind, out.refused)
        else ctx.step(kind, "done", n === 0 ? none : n === 1 ? one : many, { n, seconds: removed }, 1)
      }
      if (out.captionsRemoved && listened) await runCaptions(ctx, listened, { fillersGone: fillersGoneAtStart, quiet: true })
    }
    if ((steps.has("pauses") || steps.has("fillers")) && listened) {
      const kinds = (["pauses", "fillers"] as const).filter((kind) => steps.has(kind))
      await attempt(kinds, () => cutPass(speech, kinds))
    }

    // ── Captions, on the tidied edit ──
    if (steps.has("captions") && listened) {
      await attempt("captions", async () => {
        const out = await runCaptions(ctx, listened, { fillersGone: fillersGoneAtStart })
        if (out.refused) return refused("captions", out.refused)
        summary.captions = out.captions
        // Captions asked for on a video already laid out: on its seam, like the rest.
        await captionsOnSeam(ctx, "captions", CAPTIONS_LABEL)
        count("captions", out.captions, "freecutAi.summaryCaptionsOne", "freecutAi.summaryCaptions")
      })
    }

    // ── the Cutter's second pass: the mistakes and repeats, read from what was said ──
    if (mistakes) {
      await attempt("mistakes", async () => {
        ctx.step("mistakes", "working", "freecutAi.picking", undefined, 0.2)
        await cutPass(await mistakes, ["mistakes"])
      })
    }
    if (colorLane) await colorLane
    // Music already under the edit (from an earlier run) is fitted to the new length, and ducked again.
    if (cutAny && !steps.has("music")) await refitMusic(ctx, words).catch(() => undefined)

    // ── the Framer: the phone version, before anything laid in the frame ──
    let framing = opts.framing ?? null
    let zoomLines: CreativeChoices["zoom"] = []
    const relayCaptions = async () => {
      // What was laid in the old frame is laid again in the new one.
      if (listened && ctx.timeline.items.some((i) => i.type === "subtitle" && i.label === CAPTIONS_LABEL)) await runCaptions(ctx, listened, { fillersGone: fillersGoneAtStart, quiet: true })
    }

    // ── the Framer: every speaker in a part of their own, when there is more than one ──
    /** One person in the picture: the layout asked for becomes the phone version, which follows them. */
    let alone = false
    /** Where the finished edit is shown from: the first shot in parts, when the speakers were laid out. */
    let landAt = 0
    if (steps.has("layout") && faces) {
      await attempt("layout", async () => {
        await clearEarlierLayout(ctx, "layout")
        const set = await faces
        onEvent({ type: "faces", set, layout: plan.params.layout })
        const out = await runLayout(ctx, set, plan.params.layout)
        if (out.alone) {
          alone = true
          return
        }
        if (!out.applied) return refused("layout", out.refused)
        landAt = out.at ?? 0
        await relayCaptions()
        await captionsOnSeam(ctx, "layout", CAPTIONS_LABEL)
        ctx.step("layout", "done", "freecutAi.layoutDone", { n: out.speakers }, 1)
        // The layout frames everyone: a phone version asked for beside it is part of it.
        if (steps.has("phone")) {
          ctx.step("phone", "skipped", "freecutAi.phoneInLayout")
          steps.delete("phone")
        }
      })
    }

    // ── the Framer: the phone version, before anything laid in the frame ──
    if ((steps.has("phone") || alone) && tracking) {
      const asked = steps.has("phone")
      await attempt(asked ? "phone" : "layout", async () => {
        framing = await tracking
        await clearEarlierLayout(ctx, asked ? "phone" : "layout")
        const out = await applyPhone(ctx, framing, asked ? "phone" : "layout")
        if (!out.applied) return refused(asked ? "phone" : "layout", out.refused)
        summary.phone = true
        await relayCaptions()
        if (asked) ctx.step("phone", "done", "freecutAi.phoneDone", undefined, 1)
        if (alone) ctx.step("layout", "done", "freecutAi.layoutAlone", undefined, 1)
      })
    } else if (tracking) {
      framing = await tracking.catch(() => null)
    }

    // ── zooms, b-roll and the picture change, in the final frame ──
    if (steps.has("zoom")) {
      await attempt("zoom", async () => {
        zoomLines = (await creative)?.zoom ?? []
        const out = await runZoom(ctx, zoomLines)
        if (out.refused && out.zooms === 0) return refused("zoom", out.refused)
        summary.zooms = out.zooms
        if (out.zooms === 0) ctx.step("zoom", "done", "freecutAi.noZooms", undefined, 1)
        else count("zoom", out.zooms, "freecutAi.zoomsDoneOne", "freecutAi.zoomsDone")
      })
    }
    if (shots) {
      await attempt("broll", async () => {
        const out = await placeShots(ctx, await shots)
        onEvent({ type: "pictures", pictures: out.pictures })
        if (out.placed === 0 && out.refused) return refused("broll", out.refused)
        if (out.placed === 0) return ctx.step("broll", "failed", "freecutAi.jobFailed", undefined, 1)
        summary.broll = out.placed
        count("broll", out.placed, "freecutAi.brollDoneOne", "freecutAi.brollDone")
      })
    }
    // ── the texts on the screen, after the pictures: a text keeps to the speaker's part of the frame ──
    if (steps.has("titles")) {
      await attempt("titles", async () => {
        const chosen = await creative
        if (!chosen) return ctx.step("titles", "failed", "freecutAi.jobFailed", undefined, 1)
        const out = await placeTitles(ctx, chosen.titles, opts.titleLook ?? DEFAULT_TITLE_LOOK)
        if (out.placed === 0 && out.refused !== undefined) return refused("titles", out.refused)
        onEvent({ type: "titles", titles: out.titles })
        summary.titles = out.placed
        if (out.placed === 0) ctx.step("titles", "done", "freecutAi.titles.none", undefined, 1)
        else count("titles", out.placed, "freecutAi.titles.doneOne", "freecutAi.titles.done")
      })
    }
    // ── Sound: the music, on the beat and under the voice ──
    if (music) {
      await attempt("music", async () => {
        const out = await placeMusic(ctx, music, listened)
        if (!out.placed) return refused("music", out.refused)
        summary.music = true
        summary.bpm = out.bpm
        ctx.step("music", "done", out.bpm ? "freecutAi.musicDoneBeat" : "freecutAi.musicDoneCard", out.bpm ? { bpm: Math.round(out.bpm) } : undefined, 1)
      })
    }

    // ── Picture: last of the edit, since its model is the slowest and nothing should wait behind it ──
    if (pictures.length > 0 && whole && plan.params.picture) {
      const change = plan.params.picture
      await attempt("picture", async () => {
        let placed = 0
        let late = 0
        let refusal: string | undefined
        let failure: unknown
        for (const [i, shot] of spans.entries()) {
          try {
            const out = await placePicture(ctx, change, shot, pictures[i]!, pictureStarted)
            if (out.placed) placed += 1
            else refusal = out.refused ?? refusal
          } catch (error) {
            if (error instanceof RunStopped || signal.aborted) throw error
            if (error instanceof PictureLate) {
              // Still rendering: the panel follows it on after the run, and lays it when it is ready.
              onEvent({ type: "late", picture: error.picture })
              ctx.working("picture", false)
              late += 1
            } else failure = error
          }
        }
        if (placed > 0) summary.picture = true
        if (late > 0) return ctx.step("picture", "waiting", "freecutAi.pictureLate", spanLabel(whole))
        if (placed === 0 && failure) throw failure
        if (placed === 0) return refusal ? refused("picture", refusal) : ctx.step("picture", "skipped", "freecutAi.pictureNoShot")
        ctx.step("picture", "done", "freecutAi.pictureDoneCard", spanLabel(whole), 1)
      })
    }

    // ── made from the video: kept when the edit is undone ──
    if (chaptersPlan) {
      await attempt("chapters", async () => {
        const out = await buildChapters(ctx, chaptersPlan)
        feeNote("chapters", out)
        summary.chapters = out.made[0]?.chapters?.length ?? 0
        count("chapters", summary.chapters, "freecutAi.chaptersDoneOne", "freecutAi.chaptersDone")
      })
    }
    if (clipsPlan && listened) {
      await attempt("clips", async () => {
        const out = await buildClips(ctx, clipsPlan, listened, plan.params.clips, framing, (n) => opts.say("freecutAi.made.clip", { n }))
        feeNote("clips", out)
        summary.clips = out.made.length
        count("clips", out.made.length, "freecutAi.clipsDoneOne", "freecutAi.clipsDone")
      })
    }
    if (steps.has("trailer") && listened) {
      await attempt("trailer", async () => {
        const out = await buildTrailer(ctx, trailerPlan, await creative, listened, opts.say("freecutAi.made.trailer"))
        feeNote("trailer", out)
        summary.trailer = out.made.length > 0
        ctx.step("trailer", "done", "freecutAi.trailerDone", undefined, 1)
      })
    }

    // ── the finale: the original and the edit side by side, playing ──
    ctx.show.end()
    if (ctx.has("compare") && !ctx.show.skipping) {
      link.compare("split", 0.5)
      onEvent({ type: "compare", mode: "split" })
      await ctx.preview(landAt, 5000)
    } else {
      link.playback("seek", landAt)
    }
    const result: RunSummary = { fromSeconds, toSeconds: timelineSeconds(ctx.timeline), ...summary }
    onEvent({ type: "done", summary: result })
    return result
  } catch (error) {
    if (error instanceof RunStopped || signal.aborted) throw new RunStopped()
    if (error instanceof RunDeclined) throw error
    if (!(error instanceof RunFailed)) console.warn("[Edit with AI] the run stopped", error)
    throw error instanceof RunFailed ? error : new RunFailed(keyOf(error), undefined, wordsOf(error))
  } finally {
    for (const id of tickers) clearInterval(id)
    // Paid work nobody will use is cancelled; nothing of the show stays drawn.
    ctx.end()
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
