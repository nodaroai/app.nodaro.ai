/**
 * One Edit with AI panel's state, across runs: the request, the video being
 * edited, what each card says, what was made, and the run itself
 * (`runAiEdit`), with its speed.
 *
 * The panel remembers each video it edited, for as long as it is open: what
 * was heard (listening is paid once per video), which steps are done, the
 * phone version's framing (Wide | Phone switches with it), the color look's
 * effects, and what was made (clips, a trailer, chapters). Undo all reverts
 * every undo entry the panel's runs made, newest first; what was heard and
 * what was made stay. A fresh project in the editor (`forget`) forgets the
 * edit and its entries.
 */
import { applyTitleChange, type TitleChoiceChange } from "@/ee/lib/freecut-ai/run/titles"
import type { TitleRow } from "@/ee/lib/freecut-ai/title-rows"
import { DEFAULT_TITLE_LOOK, type TitleLook, type TitleRecord } from "@/ee/lib/freecut-ai/title-style"
import { useEffect, useMemo, useRef, useState } from "react"
import type { AiPanelVideo } from "@nodaro/shared/media"
import { localeText, useT, type MessageKey } from "@/lib/i18n"
import { PLATFORM_LANGUAGES } from "@/lib/i18n/platform-languages"
import { getCurrentUserId } from "@/lib/api"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { EDIT_STEPS, readTimelineView, type EditPlan, type EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import { ABILITY_NAME, ABILITY_PHRASE, cardPhraseKeys, LAYOUT_WIDE_PHRASE, requestSteps, toggleStepInRequest, type AgentId } from "@/ee/lib/freecut-ai/abilities"
import { formatOps, type PhoneFraming } from "@/ee/lib/freecut-ai/crop-path"
import type { CardPhrase } from "@/ee/lib/freecut-ai/request-reading"
import { lockedSteps, outcomesAfterStop, withoutSteps, type Phase, type RunStage, type StepOutcomes } from "@/ee/lib/freecut-ai/panel-model"
import { RunDeclined, RunFailed, RunStopped, runAiEdit, undoAiEdit, type HeardVideo, type MadeResult, type RunEvent } from "@/ee/lib/freecut-ai/run-ai-edit"
import { captionOps } from "@/ee/lib/freecut-ai/run/captions"
import { JobFailed, JobTimedOut, keyOf } from "@/ee/lib/freecut-ai/run/jobs"
import { applyPictureChange, type PictureChoice, addPictureAtPlayhead, type PictureSourceChoice } from "@/ee/lib/freecut-ai/run/change-picture"
import type { PictureRecord, PictureRow } from "@/ee/lib/freecut-ai/picture-rows"
import { clipNameKey } from "@/ee/lib/freecut-ai/run/layout"
import { placeLatePicture, spanLabel } from "@/ee/lib/freecut-ai/run/picture"
import type { LatePicture } from "@/ee/lib/freecut-ai/run/types"
import type { ShotChoice } from "@/ee/lib/freecut-ai/change-shot"
import { applyShotChange } from "@/ee/lib/freecut-ai/run/change-shots"
import type { LayoutRow } from "@/ee/lib/freecut-ai/layout-rows"
import type { ShotTrackSet } from "@/ee/lib/freecut-ai/shot-layout"
import type { SpeakerLayout } from "@/ee/lib/freecut-ai/speaker-layout"
import { SKIP_PACE } from "@/ee/lib/freecut-ai/run/show"

export const AGENTS: readonly AgentId[] = ["lead", "cutter", "captions", "sound", "broll", "picture", "color", "framer", "director"]

export const AGENT_NAME: Record<AgentId, MessageKey> = {
  lead: "freecutAi.agent.lead",
  cutter: "freecutAi.agent.cutter",
  captions: "freecutAi.agent.captions",
  sound: "freecutAi.agent.sound",
  broll: "freecutAi.agent.broll",
  picture: "freecutAi.agent.picture",
  color: "freecutAi.agent.color",
  framer: "freecutAi.agent.framer",
  director: "freecutAi.agent.director",
}

export interface FeedLine {
  readonly id: number
  readonly agent: AgentId
  readonly key: MessageKey
  readonly vars?: Record<string, string | number>
  /** Seconds since the run started. */
  readonly at: number
}

interface VideoMemory {
  readonly heard?: HeardVideo
  readonly outcomes: StepOutcomes
  /** The timeline's length before the first run on this video, and after the last, in seconds. */
  readonly fromSeconds?: number
  readonly toSeconds?: number
  readonly framing?: PhoneFraming | null
  /** Which format the edit is in now, once there is a phone version. */
  readonly format?: "wide" | "phone"
  readonly colorEffects?: ReadonlyArray<{ readonly itemId: string; readonly effectId: string }>
  /** Picture changes still rendering after their run: followed here one by one, each laid when it is ready. */
  readonly late?: readonly LatePicture[]
  /** The face tracks the speaker layout was made from: with them, one stretch can be shown another way. */
  readonly faces?: { readonly set: ShotTrackSet; readonly layout: SpeakerLayout }
  /** What the b-roll run knows about its pictures: their words, what they show, and the ones that were not made. */
  readonly pictures?: readonly PictureRecord[]
  /** What the run knows about the texts it laid on the screen. */
  readonly titles?: readonly TitleRecord[]
  readonly made: readonly MadeResult[]
}

/** One undo entry a run made: its label, the video, and the step it stands for. */
interface Entry {
  readonly label: string
  readonly url: string
  readonly step: EditStep
}

const EMPTY: VideoMemory = { outcomes: {}, made: [] }

export interface EditSessionOptions {
  readonly link: () => EditorLink | null
  readonly videos: readonly AiPanelVideo[]
  readonly openedVideoUrl?: string
  /** The videos' names are the editor's own: the run tells the video apart by its name. */
  readonly matchByName?: boolean
  /** The editor's abilities (`FREECUT_READY.capabilities`). */
  readonly capabilities: readonly string[]
}

/** The video to start on: the opened one when the panel may edit it, else the first. */
const firstVideo = (videos: readonly AiPanelVideo[], opened?: string) =>
  (opened && videos.some((v) => v.url === opened) ? opened : videos[0]?.url) ?? ""

/** Every card's phrase in every language the panel speaks: a request made of them starts at once. */
const CARD_PHRASES: readonly CardPhrase[] = EDIT_STEPS.flatMap((step) =>
  PLATFORM_LANGUAGES.flatMap((locale) => cardPhraseKeys(step).map((key) => ({ step, text: localeText(locale, key) ?? "" }))).filter((p) => p.text),
)

export type Speed = 1 | 2

export function useEditSession({ link, videos, openedVideoUrl, matchByName = false, capabilities }: EditSessionOptions) {
  const t = useT()
  const [request, setRequest] = useState("")
  const [asked, setAsked] = useState("")
  const [videoUrl, setVideoUrl] = useState(() => firstVideo(videos, openedVideoUrl))
  const [memory, setMemory] = useState<Record<string, VideoMemory>>({})
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [stage, setStage] = useState<RunStage>("reading")
  const [waiting, setWaiting] = useState(false)
  const [working, setWorking] = useState<readonly AgentId[]>([])
  const [feed, setFeed] = useState<readonly FeedLine[]>([])
  const [note, setNote] = useState<{ readonly key: MessageKey; readonly vars?: Record<string, string | number> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState(0)
  const [speed, setSpeedState] = useState<Speed>(1)
  /** How many shots in a row the next picture change is made on. */
  const [pictureShots, setPictureShots] = useState(1)
  /** How many pictures to lay on the words; null until the person chooses (the video's length decides). */
  const [pictureCount, setPictureCount] = useState<number | null>(null)
  /** How many texts to lay on the screen (null: the video's length decides), and the look they take. */
  const [titleCount, setTitleCount] = useState<number | null>(null)
  const [titleLook, setTitleLook] = useState<TitleLook>(DEFAULT_TITLE_LOOK)
  const [compareMode, setCompareMode] = useState<"program" | "source" | "split">("program")
  const paceRef = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const confirmRef = useRef<((yes: boolean) => void) | null>(null)
  const changingRef = useRef(false)
  // Every undo entry the panel's runs made, in order: Undo all reverts exactly these.
  const recordedRef = useRef<Entry[]>([])
  const lineId = useRef(0)
  const running = phase.kind === "running" || phase.kind === "confirming"

  // The host's list can change (a video imported, or the one being edited removed); never mid-run.
  useEffect(() => {
    if (running || videos.some((v) => v.url === videoUrl)) return
    setVideoUrl(firstVideo(videos, openedVideoUrl))
  }, [videos, openedVideoUrl, videoUrl, running])

  useEffect(() => () => abortRef.current?.abort(), [])

  const video = videos.find((v) => v.url === videoUrl)
  const current = memory[videoUrl] ?? EMPTY
  const names = useMemo(() => Object.fromEntries(AGENTS.map((a) => [a, t(AGENT_NAME[a])])) as Record<AgentId, string>, [t])
  const stepLabels = useMemo(() => Object.fromEntries(EDIT_STEPS.map((s) => [s, t(ABILITY_NAME[s])])) as Record<EditStep, string>, [t])

  const remember = (url: string, change: (m: VideoMemory) => VideoMemory) =>
    setMemory((prev) => ({ ...prev, [url]: change(prev[url] ?? EMPTY) }))
  const keepEntries = (next: Entry[]) => {
    recordedRef.current = next
    setEntries(next.length)
  }

  function toggleStep(step: EditStep) {
    if (running || busy) return
    setNote(null)
    setRequest((text) => toggleStepInRequest(text, step, t(ABILITY_PHRASE[step]), t("common.listComma")))
    if (phase.kind === "declined" || phase.kind === "failed") setPhase({ kind: "idle" })
  }

  /** The speaker layout's frame: the phone (the card's own phrase) or the wide one, the speakers side by side. */
  function setLayoutWide(wide: boolean) {
    if (running || busy) return
    setNote(null)
    setRequest((text) => {
      const separator = t("common.listComma")
      const without = requestSteps(text).includes("layout") ? toggleStepInRequest(text, "layout", "", separator) : text
      return toggleStepInRequest(without, "layout", t(wide ? LAYOUT_WIDE_PHRASE : ABILITY_PHRASE.layout), separator)
    })
  }

  function chooseVideo(url: string) {
    if (running || busy || !videos.some((v) => v.url === url)) return
    setVideoUrl(url)
    setPlan(null)
    setFeed([])
    setNote(null)
    setPhase({ kind: "idle" })
  }

  function setSpeed(next: Speed) {
    setSpeedState(next)
    paceRef.current = next
  }

  /** Lands everything left at once: the show is skipped, the work is not. */
  function skip() {
    paceRef.current = SKIP_PACE
  }

  async function start() {
    const editor = link()
    const text = request.trim()
    if (!editor || !video || !text || running || busy) return
    const url = video.url
    const before = memory[url] ?? EMPTY
    const locked = lockedSteps(before.outcomes)
    const controller = new AbortController()
    abortRef.current = controller
    changingRef.current = false
    paceRef.current = speed
    const startedAt = Date.now()
    setAsked(text)
    setPlan(null)
    setFeed([])
    setNote(null)
    setWorking([])
    setStage("reading")
    setWaiting(false)
    setPhase({ kind: "running", startedAt })
    const onEvent = (event: RunEvent) => {
      // Kept even after a stop: Undo all must still find the entries, and what was heard was paid for.
      if (event.type === "recorded") {
        keepEntries([...recordedRef.current, { label: event.label, url, step: event.step }])
        return
      }
      if (event.type === "heard") {
        remember(url, (m) => ({ ...m, heard: event.heard }))
        return
      }
      if (event.type === "made") {
        remember(url, (m) => ({ ...m, made: [...m.made, event.result] }))
        return
      }
      if (event.type === "framing") {
        remember(url, (m) => ({ ...m, framing: event.framing, format: "phone" }))
        return
      }
      if (event.type === "late") {
        remember(url, (m) => ({ ...m, late: [...(m.late ?? []), event.picture] }))
        return
      }
      if (event.type === "faces") {
        remember(url, (m) => ({ ...m, faces: { set: event.set, layout: event.layout } }))
        return
      }
      if (event.type === "pictures") {
        remember(url, (m) => ({ ...m, pictures: event.pictures }))
        return
      }
      if (event.type === "titles") {
        remember(url, (m) => ({ ...m, titles: event.titles }))
        return
      }
      if (event.type === "color") {
        remember(url, (m) => ({ ...m, colorEffects: event.effects }))
        return
      }
      if (controller.signal.aborted) return
      if (event.type === "plan") {
        setPlan(event.plan)
        remember(url, (m) => ({ ...m, outcomes: { ...m.outcomes, ...Object.fromEntries(event.plan.steps.map((s) => [s, { state: "waiting" as const, key: "freecutAi.waiting" as MessageKey }])) } }))
      } else if (event.type === "compare") {
        setCompareMode(event.mode)
      } else if (event.type === "phase") {
        setStage(event.phase)
      } else if (event.type === "waiting") {
        setWaiting(event.waiting)
      } else if (event.type === "agents") {
        setWorking(event.working)
      } else if (event.type === "step") {
        remember(url, (m) => ({ ...m, outcomes: { ...m.outcomes, [event.step]: { state: event.state, key: event.key, vars: event.vars, progress: event.progress, ...(event.detail ? { detail: event.detail } : {}) } } }))
      } else if (event.type === "feed") {
        lineId.current += 1
        const line: FeedLine = { id: lineId.current, agent: event.agent, key: event.key, vars: event.vars, at: (Date.now() - startedAt) / 1000 }
        setFeed((prev) => [...prev.slice(-120), line])
      }
    }
    try {
      const summary = await runAiEdit({
        request: text,
        videoUrl: url,
        ...(matchByName ? { videoName: video.name } : {}),
        heard: before.heard,
        done: locked,
        framing: before.framing ?? null,
        colorEffects: before.colorEffects,
        // What the person was shown a price for: a plan that adds a paid part is asked about first.
        quoted: requestSteps(text).filter((step) => !locked.includes(step)),
        pictureShots,
        ...(pictureCount === null ? {} : { brollCount: pictureCount }),
        ...(titleCount === null ? {} : { titleCount }),
        titleLook,
        link: editor,
        signal: controller.signal,
        capabilities,
        names,
        stepLabels,
        say: t,
        phrases: CARD_PHRASES,
        urlOfName: (fileName) => videos.find((v) => v.name.trim().toLowerCase() === fileName.trim().toLowerCase())?.url,
        onEvent,
        pace: () => paceRef.current,
        confirmPartial: (pending, extra) =>
          new Promise<boolean>((resolve) => {
            confirmRef.current = resolve
            setPhase({ kind: "confirming", plan: pending, extra })
          }),
      })
      remember(url, (m) => ({ ...m, fromSeconds: m.fromSeconds ?? summary.fromSeconds, toSeconds: summary.toSeconds }))
      setRequest("")
      setPictureShots(1)
      setPhase({ kind: "done", summary })
    } catch (error) {
      if (error instanceof RunDeclined) {
        // Nothing ran: the cards go back to what they said before.
        remember(url, (m) => ({ ...m, outcomes: before.outcomes }))
        setPhase(changingRef.current ? { kind: "idle" } : { kind: "declined", plan: error.plan, reason: error.reason })
      } else if (error instanceof RunStopped) {
        remember(url, (m) => ({ ...m, outcomes: outcomesAfterStop(m.outcomes) }))
        setPhase({ kind: "stopped" })
      } else {
        remember(url, (m) => ({ ...m, outcomes: outcomesAfterStop(m.outcomes) }))
        const reason = error instanceof RunFailed ? t(error.key, error.vars) : t("freecutAi.unexpected")
        setPhase({ kind: "failed", reason, detail: error instanceof RunFailed ? error.detail : undefined })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      confirmRef.current = null
      setWorking([])
      setWaiting(false)
    }
  }

  // A picture change that outlasted its run: followed to its end between runs, then laid over its shot.
  const lateUrl = Object.keys(memory).find((u) => (memory[u]?.late?.length ?? 0) > 0)
  const late = lateUrl ? memory[lateUrl]?.late?.[0] : undefined
  useEffect(() => {
    const editor = link()
    if (!late || !lateUrl || running || busy || !editor) return
    const controller = new AbortController()
    const label = t(ABILITY_NAME.picture)
    // The card speaks once the last render is settled; until then it keeps saying the picture is still changing.
    const settle = (outcome: StepOutcomes["picture"]) =>
      remember(lateUrl, (m) => {
        const rest = (m.late ?? []).filter((l) => l.jobId !== late.jobId)
        return { ...m, late: rest, outcomes: rest.length > 0 ? m.outcomes : { ...m.outcomes, picture: outcome } }
      })
    void placeLatePicture(editor, late, label, controller.signal).then(
      (laid) => {
        if (controller.signal.aborted) return
        if (laid.recorded) keepEntries([...recordedRef.current, { label, url: lateUrl, step: "picture" }])
        settle(laid.placed ? { state: "done", key: "freecutAi.pictureDoneCard", vars: spanLabel(late.span) } : laid.refused ? { state: "failed", key: "freecutAi.editorRefused", detail: laid.refused } : { state: "skipped", key: "freecutAi.pictureNoShot" })
      },
      (error: unknown) => {
        // A run started, or the panel closed: the render is picked up again after.
        if (controller.signal.aborted) return
        settle({ state: "failed", key: error instanceof JobTimedOut ? "freecutAi.tooSlow" : "freecutAi.jobFailed", ...(error instanceof JobFailed && error.errorDetail ? { detail: error.errorDetail } : {}) })
      },
    )
    return () => controller.abort()
    // Followed per render: the editor link and the words are read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [late?.jobId, lateUrl, running, busy])

  const stop = () => abortRef.current?.abort()

  // The person's answer before anything paid starts: run the plan, or go back and change the request.
  function answer(yes: boolean) {
    const resolve = confirmRef.current
    confirmRef.current = null
    if (yes) setPhase((p) => (p.kind === "confirming" ? { kind: "running", startedAt: Date.now() } : p))
    else changingRef.current = true
    resolve?.(yes)
  }

  // Exactly the undo entries the panel's runs made, newest first; an edit by hand on top stops it.
  async function undoAll() {
    const editor = link()
    const recorded = recordedRef.current
    if (!editor || busy || running) return
    if (recorded.length === 0) {
      setNote({ key: "freecutAi.nothingToUndo" })
      return
    }
    setBusy(true)
    try {
      const reverted = await undoAiEdit(editor, recorded.map((e) => e.label))
      const kept = recorded.slice(0, recorded.length - reverted)
      keepEntries(kept)
      if (reverted === recorded.length) {
        // Everything the panel did is gone: every card starts over (what was heard and what was made stay).
        setMemory((prev) => Object.fromEntries(Object.entries(prev).map(([u, m]) => [u, { heard: m.heard, made: m.made, outcomes: {} }])))
        setPhase({ kind: "undone" })
      } else if (reverted > 0) {
        const undone = recorded.slice(recorded.length - reverted)
        setMemory((prev) => {
          const next = { ...prev }
          for (const entry of undone) {
            const m = next[entry.url] ?? EMPTY
            next[entry.url] = { ...m, outcomes: withoutSteps(m.outcomes, [entry.step]), toSeconds: undefined, ...(entry.step === "phone" ? { framing: null, format: undefined } : {}), ...(entry.step === "broll" ? { pictures: m.pictures?.filter((p) => !p.failed) } : {}) }
          }
          return next
        })
        setNote({ key: "freecutAi.undonePartly", vars: { done: reverted, total: recorded.length } })
      } else {
        setNote({ key: "freecutAi.nothingToUndo" })
      }
    } catch {
      setNote({ key: "freecutAi.editorNoAnswer" })
    } finally {
      setBusy(false)
    }
  }

  /** Wide | Phone: the same edit, framed for the other screen (captions laid again in the new frame). */
  async function switchFormat(to: "wide" | "phone") {
    const editor = link()
    const framing = current.framing
    if (!editor || !framing || busy || running || current.format === to) return
    setBusy(true)
    try {
      const timeline = readTimelineView(await editor.getTimeline())
      if (!timeline) return
      const ops = formatOps(timeline, framing, to)
      const captioned = timeline.items.some((i) => i.type === "subtitle" && i.label === "Captions")
      const captions = captioned && current.heard
        ? captionOps(timeline, framing.mediaId, current.heard, { fillersGone: current.outcomes.fillers?.state === "done", highlight: capabilities.includes("captions-word-highlight") }).ops
        : []
      const label = t(to === "phone" ? "freecutAi.format.phone" : "freecutAi.format.wide")
      const result = await editor.applyOps(label, [...ops, ...captions])
      if (result.ok) {
        if (result.recorded !== false) keepEntries([...recordedRef.current, { label, url: videoUrl, step: "phone" }])
        remember(videoUrl, (m) => ({ ...m, format: to }))
      } else {
        setNote({ key: "freecutAi.editorRefusedNote", vars: { reason: result.error?.message ?? "" } })
      }
    } catch {
      setNote({ key: "freecutAi.editorNoAnswer" })
    } finally {
      setBusy(false)
    }
  }

  /** Stretches of the speaker layout shown another way, as the person chose: edits like the rest, undone with them. */
  async function changeShots(rows: readonly LayoutRow[], choice: ShotChoice) {
    const editor = link()
    const faces = current.faces
    if (!editor || !faces || busy || running || rows.length === 0) return
    setBusy(true)
    try {
      const label = t("freecutAi.shots.changeLabel")
      const changed = await applyShotChange(editor, {
        label,
        rows,
        choice,
        faces,
        nameOf: (framing) => t(clipNameKey(framing)),
        onRecorded: () => keepEntries([...recordedRef.current, { label, url: videoUrl, step: "layout" }]),
      })
      if (changed.ok) editor.playback("seek", rows[0]!.from)
      else setNote({ key: "freecutAi.editorRefusedNote", vars: { reason: changed.reason ?? "" } })
    } catch {
      setNote({ key: "freecutAi.editorNoAnswer" })
    } finally {
      setBusy(false)
    }
  }

  /** One picture on the words made again, replaced by the person's own, or taken off: an edit like the rest, undone with them. */
  async function changePicture(row: PictureRow, choice: PictureChoice) {
    const editor = link()
    if (!editor || busy || running) return
    setBusy(true)
    setNote(null)
    const controller = new AbortController()
    const url = videoUrl
    try {
      const userId = await getCurrentUserId()
      if (!userId) {
        setNote({ key: "freecutAi.signedOut" })
        return
      }
      const label = t("freecutAi.pictures.changeLabel")
      const result = await applyPictureChange(editor, {
        label,
        row,
        choice,
        userId,
        signal: controller.signal,
        onRecorded: () => keepEntries([...recordedRef.current, { label, url, step: "broll" }]),
      })
      if (result.ok) {
        remember(url, (m) => ({ ...m, pictures: [...(m.pictures ?? []).filter((p) => p.id !== result.forget), ...(result.record ? [result.record] : [])] }))
        editor.playback("seek", row.from)
        if (result.filled) setNote({ key: "freecutAi.pictures.filledNote" })
      } else if ("notMade" in result) {
        // A moment still without a picture keeps the words just tried, and the newest reason.
        const before = row.record
        if (row.source === "none" && before) {
          remember(url, (m) => ({
            ...m,
            pictures: (m.pictures ?? []).map((p) => (p.id === before.id ? { ...p, ...(choice.kind === "again" ? { prompt: choice.prompt } : {}), ...(result.reason ? { reason: result.reason } : {}) } : p)),
          }))
        }
        setNote(result.reason ? { key: "freecutAi.pictures.notMadeWhy", vars: { reason: result.reason } } : { key: "freecutAi.pictures.notMadeNote" })
      } else if ("taken" in result) {
        setNote({ key: "freecutAi.pictures.taken" })
      } else {
        setNote({ key: "freecutAi.editorRefusedNote", vars: { reason: result.refused ?? "" } })
      }
    } catch (error) {
      setNote({ key: keyOf(error) })
    } finally {
      setBusy(false)
    }
  }

  /** A picture added by hand where the playhead is: an edit like the rest, undone with them. */
  async function addPicture(choice: PictureSourceChoice) {
    const editor = link()
    if (!editor || busy || running) return
    setBusy(true)
    setNote(null)
    const controller = new AbortController()
    const url = videoUrl
    try {
      const userId = await getCurrentUserId()
      if (!userId) {
        setNote({ key: "freecutAi.signedOut" })
        return
      }
      const label = t("freecutAi.pictures.addLabel")
      const result = await addPictureAtPlayhead(editor, { label, choice, userId, signal: controller.signal, onRecorded: () => keepEntries([...recordedRef.current, { label, url, step: "broll" }]) })
      if (result.ok) {
        const added = result.record
        if (added) remember(url, (m) => ({ ...m, pictures: [...(m.pictures ?? []), added] }))
        if (result.filled) setNote({ key: "freecutAi.pictures.filledNote" })
      } else if ("notMade" in result) {
        setNote(result.reason ? { key: "freecutAi.pictures.notMadeWhy", vars: { reason: result.reason } } : { key: "freecutAi.pictures.notMadeNote" })
      } else if ("taken" in result) {
        setNote({ key: "freecutAi.pictures.taken" })
      } else {
        setNote(result.refused ? { key: "freecutAi.editorRefusedNote", vars: { reason: result.refused } } : { key: "freecutAi.pictures.nowhere" })
      }
    } catch (error) {
      setNote({ key: keyOf(error) })
    } finally {
      setBusy(false)
    }
  }

  /** One text on the screen changed or taken off: an edit like the rest, undone with them. */
  async function changeTitle(row: TitleRow, change: TitleChoiceChange) {
    const editor = link()
    if (!editor || busy || running) return
    setBusy(true)
    setNote(null)
    const url = videoUrl
    try {
      const label = t("freecutAi.titles.changeLabel")
      const result = await applyTitleChange(editor, { label, row, change, onRecorded: () => keepEntries([...recordedRef.current, { label, url, step: "titles" }]) })
      if (result.ok) {
        const kept = result.records ?? []
        const gone = new Set([...kept.map((r) => r.id), ...(result.forget ? [result.forget] : [])])
        remember(url, (m) => ({ ...m, titles: [...(m.titles ?? []).filter((r) => !gone.has(r.id)), ...kept] }))
        editor.playback("seek", row.from)
      } else {
        setNote({ key: "freecutAi.editorRefusedNote", vars: { reason: result.refused ?? "" } })
      }
    } catch (error) {
      setNote({ key: keyOf(error) })
    } finally {
      setBusy(false)
    }
  }

  /** The editor started a fresh project: what the panel did there is gone with it (what was heard stays). */
  function forget() {
    abortRef.current?.abort()
    keepEntries([])
    setMemory((prev) => Object.fromEntries(Object.entries(prev).map(([u, m]) => [u, { heard: m.heard, made: [], outcomes: {} }])))
    setPlan(null)
    setFeed([])
    setNote(null)
    setPhase({ kind: "idle" })
  }

  function play() {
    const editor = link()
    if (!editor) return
    editor.playback("seek", 0)
    editor.playback("play")
  }

  const edited = entries > 0 && phase.kind !== "undone"

  return {
    request,
    setRequest: (text: string) => {
      setRequest(text)
      if (phase.kind === "declined" || phase.kind === "failed") setPhase({ kind: "idle" })
    },
    asked,
    video,
    videoUrl,
    chooseVideo,
    current,
    phase,
    plan,
    stage,
    waiting,
    working,
    feed,
    note,
    busy,
    running,
    edited,
    speed,
    setSpeed,
    compareMode,
    setCompareMode,
    skip,
    toggleStep,
    setLayoutWide,
    pictureShots,
    setPictureShots,
    pictureCount,
    setPictureCount,
    titleCount,
    setTitleCount,
    titleLook,
    setTitleLook,
    start,
    stop,
    answer,
    undoAll,
    switchFormat,
    changeShots,
    changePicture,
    addPicture,
    changeTitle,
    forget,
    play,
  }
}

export type EditSession = ReturnType<typeof useEditSession>
