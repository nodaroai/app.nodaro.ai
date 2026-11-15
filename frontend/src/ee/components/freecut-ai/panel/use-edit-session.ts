/**
 * One Edit with AI panel's state, across runs: the request, the video being
 * edited, what each card says, and the run itself (`runAiEdit`).
 *
 * The panel remembers each video it edited, for as long as it is open: what
 * was heard (listening is paid once per video) and which steps are done (they
 * are not done again, and their cards stay ticked). Undo all reverts every
 * undo entry the panel's runs made, newest first, and the cards of the steps
 * it reverted; what was heard stays, since the video itself did not change.
 * A fresh project in the editor (`forget`) forgets the cards and the entries.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { AiPanelVideo } from "@nodaro/shared/media"
import { useT, type MessageKey } from "@/lib/i18n"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { EDIT_STEPS, type EditPlan, type EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import { ABILITY_NAME, ABILITY_PHRASE, requestSteps, toggleStepInRequest } from "@/ee/lib/freecut-ai/abilities"
import {
  doneSteps,
  outcomesAfterRun,
  outcomesAfterStop,
  stepsOfEntry,
  withAgentEvent,
  withoutSteps,
  type Phase,
  type StepOutcomes,
} from "@/ee/lib/freecut-ai/panel-model"
import {
  RunDeclined,
  RunFailed,
  RunStopped,
  runAiEdit,
  undoAiEdit,
  type AgentId,
  type HeardVideo,
  type RunEvent,
} from "@/ee/lib/freecut-ai/run-ai-edit"

export const AGENTS: readonly AgentId[] = ["lead", "cutter", "captions", "sound"]

export const AGENT_NAME: Record<AgentId, MessageKey> = {
  lead: "freecutAi.agent.lead",
  cutter: "freecutAi.agent.cutter",
  captions: "freecutAi.agent.captions",
  sound: "freecutAi.agent.sound",
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
}

/** One undo entry a run made: its label, the video, and the steps it stands for. */
interface Entry {
  readonly label: string
  readonly url: string
  readonly steps: readonly EditStep[]
}

const EMPTY: VideoMemory = { outcomes: {} }

export interface EditSessionOptions {
  readonly link: () => EditorLink | null
  readonly videos: readonly AiPanelVideo[]
  readonly openedVideoUrl?: string
  /** The videos' names are the editor's own: the run tells the video apart by its name. */
  readonly matchByName?: boolean
}

/** The video to start on: the opened one when the panel may edit it, else the first. */
const firstVideo = (videos: readonly AiPanelVideo[], opened?: string) =>
  (opened && videos.some((v) => v.url === opened) ? opened : videos[0]?.url) ?? ""

export function useEditSession({ link, videos, openedVideoUrl, matchByName = false }: EditSessionOptions) {
  const t = useT()
  const [request, setRequest] = useState("")
  const [asked, setAsked] = useState("")
  const [videoUrl, setVideoUrl] = useState(() => firstVideo(videos, openedVideoUrl))
  const [memory, setMemory] = useState<Record<string, VideoMemory>>({})
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [listening, setListening] = useState(false)
  const [working, setWorking] = useState<readonly AgentId[]>([])
  const [feed, setFeed] = useState<readonly FeedLine[]>([])
  const [note, setNote] = useState<{ readonly key: MessageKey; readonly vars?: Record<string, string | number> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState(0)
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

  function chooseVideo(url: string) {
    if (running || busy || !videos.some((v) => v.url === url)) return
    setVideoUrl(url)
    setPlan(null)
    setFeed([])
    setNote(null)
    setPhase({ kind: "idle" })
  }

  async function start() {
    const editor = link()
    const text = request.trim()
    if (!editor || !video || !text || running || busy) return
    const url = video.url
    const before = memory[url] ?? EMPTY
    const done = doneSteps(before.outcomes)
    const controller = new AbortController()
    abortRef.current = controller
    changingRef.current = false
    const startedAt = Date.now()
    setAsked(text)
    setPlan(null)
    setFeed([])
    setNote(null)
    setWorking([])
    setListening(false)
    setPhase({ kind: "running", startedAt })
    let planSteps: readonly EditStep[] = []
    const onEvent = (event: RunEvent) => {
      // Kept even after a stop: Undo all must still find the entries, and what was heard was paid for.
      if (event.type === "recorded") {
        keepEntries([...recordedRef.current, { label: event.label, url, steps: stepsOfEntry(event.label, stepLabels, planSteps) }])
        return
      }
      if (event.type === "heard") {
        remember(url, (m) => ({ ...m, heard: event.heard }))
        return
      }
      if (controller.signal.aborted) return
      if (event.type === "plan") {
        planSteps = event.plan.steps
        setPlan(event.plan)
        remember(url, (m) => ({ ...m, outcomes: { ...m.outcomes, ...Object.fromEntries(planSteps.map((s) => [s, { state: "waiting" as const, key: "freecutAi.waiting" as MessageKey }])) } }))
      } else if (event.type === "agent") {
        if (event.agent === "lead") setListening(event.state === "working" && event.key === "freecutAi.listening")
        setWorking((prev) => (event.state === "working" ? [...new Set([...prev, event.agent])] : prev.filter((a) => a !== event.agent)))
        remember(url, (m) => ({ ...m, outcomes: withAgentEvent(m.outcomes, event.agent, planSteps, event) }))
      } else if (event.type === "feed") {
        lineId.current += 1
        const line: FeedLine = { id: lineId.current, agent: event.agent, key: event.key, vars: event.vars, at: (Date.now() - startedAt) / 1000 }
        setFeed((prev) => [...prev.slice(-80), line])
      }
    }
    try {
      const summary = await runAiEdit({
        request: text,
        videoUrl: url,
        ...(matchByName ? { videoName: video.name } : {}),
        heard: before.heard,
        done,
        // What the person was shown a price for: a plan that adds a paid part is asked about first.
        quoted: requestSteps(text).filter((step) => !done.includes(step)),
        link: editor,
        signal: controller.signal,
        names,
        stepLabels,
        onEvent,
        confirmPartial: (pending, extra) =>
          new Promise<boolean>((resolve) => {
            confirmRef.current = resolve
            setPhase({ kind: "confirming", plan: pending, extra })
          }),
      })
      remember(url, (m) => ({ ...m, outcomes: outcomesAfterRun(m.outcomes, summary, planSteps), fromSeconds: m.fromSeconds ?? summary.fromSeconds, toSeconds: summary.toSeconds }))
      setRequest("")
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
      setListening(false)
    }
  }

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
        // Everything the panel did is gone: every card starts over (what was heard stays).
        setMemory((prev) => Object.fromEntries(Object.entries(prev).map(([url, m]) => [url, { heard: m.heard, outcomes: {} }])))
        setPhase({ kind: "undone" })
      } else if (reverted > 0) {
        // Only the steps whose entries were reverted start over, on their own video.
        const undone = recorded.slice(recorded.length - reverted)
        setMemory((prev) => {
          const next = { ...prev }
          for (const entry of undone) {
            const m = next[entry.url] ?? EMPTY
            next[entry.url] = { ...m, outcomes: withoutSteps(m.outcomes, entry.steps), toSeconds: undefined }
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

  /** The editor started a fresh project: what the panel did there is gone with it (what was heard stays). */
  function forget() {
    abortRef.current?.abort()
    keepEntries([])
    setMemory((prev) => Object.fromEntries(Object.entries(prev).map(([url, m]) => [url, { heard: m.heard, outcomes: {} }])))
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
    listening,
    working,
    feed,
    note,
    busy,
    running,
    edited,
    toggleStep,
    start,
    stop,
    answer,
    undoAll,
    forget,
    play,
  }
}

export type EditSession = ReturnType<typeof useEditSession>
