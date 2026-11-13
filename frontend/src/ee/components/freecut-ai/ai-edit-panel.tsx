/**
 * Edit with AI, the panel beside the embedded editor (FreeCut).
 *
 * The person writes what they want; a team of agents edits the open video on
 * the editor's own timeline while they watch (`run-ai-edit.ts`). This panel is
 * the conversation side of it: the request, the plan, each agent's state and a
 * running log, then the result with Play and Undo all. Loaded only on a build
 * with credits, through the core shim `components/editor/freecut-ai-slot.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Play, Sparkles, Square, Undo2, X } from "lucide-react"
import { formatNumber, useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { createEditorLink, type EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { EDIT_STEPS, type EditPlan, type EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import {
  AGENT_COLORS,
  RunFailed,
  RunStopped,
  runAiEdit,
  undoAiEdit,
  type AgentId,
  type AgentState,
  type RunEvent,
  type RunSummary,
} from "@/ee/lib/freecut-ai/run-ai-edit"

export interface AiEditPanelProps {
  /** The editor frame's window, read when a message is sent. */
  readonly editorWindow: () => Window | null | undefined
  readonly editorOrigin: string
  readonly videoUrl: string
  readonly onClose: () => void
}

const AGENTS: readonly AgentId[] = ["lead", "cutter", "captions", "sound"]

const AGENT_NAME: Record<AgentId, MessageKey> = {
  lead: "freecutAi.agent.lead",
  cutter: "freecutAi.agent.cutter",
  captions: "freecutAi.agent.captions",
  sound: "freecutAi.agent.sound",
}

const STEP_NAME: Record<EditStep, MessageKey> = {
  fillers: "freecutAi.step.fillers",
  pauses: "freecutAi.step.pauses",
  captions: "freecutAi.step.captions",
  music: "freecutAi.step.music",
}

interface AgentView {
  readonly state: AgentState
  readonly key: MessageKey
  readonly vars?: Record<string, string | number>
  readonly progress?: number
}

interface FeedLine {
  readonly id: number
  readonly agent: AgentId
  readonly key: MessageKey
  readonly vars?: Record<string, string | number>
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly summary: RunSummary }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly reason: string; readonly detail?: string }
  | { readonly kind: "undone" }

const IDLE_AGENTS: Record<AgentId, AgentView> = {
  lead: { state: "waiting", key: "freecutAi.waiting" },
  cutter: { state: "waiting", key: "freecutAi.waiting" },
  captions: { state: "waiting", key: "freecutAi.waiting" },
  sound: { state: "waiting", key: "freecutAi.waiting" },
}

export default function AiEditPanel({ editorWindow, editorOrigin, videoUrl, onClose }: AiEditPanelProps) {
  const t = useT()
  const [request, setRequest] = useState(() => t("freecutAi.example"))
  const [asked, setAsked] = useState("")
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [agents, setAgents] = useState<Record<AgentId, AgentView>>(IDLE_AGENTS)
  const [feed, setFeed] = useState<readonly FeedLine[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ readonly key: MessageKey; readonly vars?: Record<string, string | number> } | null>(null)
  const linkRef = useRef<EditorLink | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The undo entries the last run made, in order: Undo all reverts exactly these.
  const recordedRef = useRef<string[]>([])
  const feedRef = useRef<HTMLOListElement>(null)
  const lineId = useRef(0)

  useEffect(() => {
    const link = createEditorLink(editorWindow, editorOrigin)
    linkRef.current = link
    return () => {
      abortRef.current?.abort()
      link.dispose()
      linkRef.current = null
    }
  }, [editorWindow, editorOrigin])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feed])

  const names = useMemo(
    () => Object.fromEntries(AGENTS.map((a) => [a, t(AGENT_NAME[a])])) as Record<AgentId, string>,
    [t],
  )
  const stepLabels = useMemo(
    () => Object.fromEntries(EDIT_STEPS.map((s) => [s, t(STEP_NAME[s])])) as Record<EditStep, string>,
    [t],
  )

  const onEvent = (event: RunEvent) => {
    if (event.type === "plan") setPlan(event.plan)
    else if (event.type === "agent") {
      setAgents((prev) => ({ ...prev, [event.agent]: { state: event.state, key: event.key, vars: event.vars, progress: event.progress } }))
    } else if (event.type === "feed") {
      lineId.current += 1
      const line: FeedLine = { id: lineId.current, agent: event.agent, key: event.key, vars: event.vars }
      setFeed((prev) => [...prev.slice(-60), line])
    } else if (event.type === "recorded") {
      recordedRef.current = [...recordedRef.current, event.label]
    }
  }

  async function start() {
    const link = linkRef.current
    const text = request.trim() || t("freecutAi.example")
    if (!link || phase.kind === "running") return
    const controller = new AbortController()
    abortRef.current = controller
    recordedRef.current = []
    setAsked(text)
    setPlan(null)
    setFeed([])
    setNote(null)
    setAgents(IDLE_AGENTS)
    setPhase({ kind: "running" })
    try {
      const summary = await runAiEdit({
        request: text,
        videoUrl,
        link,
        signal: controller.signal,
        names,
        stepLabels,
        // Undo entries are kept even after a stop: Undo all must still find them.
        onEvent: (event) => {
          if (event.type === "recorded" || !controller.signal.aborted) onEvent(event)
        },
      })
      setPhase({ kind: "done", summary })
    } catch (error) {
      if (error instanceof RunStopped) {
        setPhase({ kind: "stopped" })
      } else {
        const reason = error instanceof RunFailed ? t(error.key, error.vars) : t("freecutAi.unexpected")
        setPhase({ kind: "failed", reason, detail: error instanceof RunFailed ? error.detail : undefined })
      }
    } finally {
      abortRef.current = null
    }
  }

  // Exactly the undo entries the last run made, newest first; an edit by hand on top stops it.
  async function undoAll() {
    const link = linkRef.current
    const recorded = recordedRef.current
    if (!link || busy) return
    if (recorded.length === 0) {
      setNote({ key: "freecutAi.nothingToUndo" })
      return
    }
    setBusy(true)
    try {
      const reverted = await undoAiEdit(link, recorded)
      recordedRef.current = recorded.slice(0, recorded.length - reverted)
      if (reverted === recorded.length) setPhase({ kind: "undone" })
      else if (reverted > 0) setNote({ key: "freecutAi.undonePartly", vars: { done: reverted, total: recorded.length } })
      else setNote({ key: "freecutAi.nothingToUndo" })
    } catch {
      setNote({ key: "freecutAi.editorNoAnswer" })
    } finally {
      setBusy(false)
    }
  }

  function play() {
    const link = linkRef.current
    if (!link) return
    link.playback("seek", 0)
    link.playback("play")
  }

  const running = phase.kind === "running"

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-s border-[#2D2D2D] bg-[#161616] text-white" aria-label={t("freecutAi.title")}>
      <div className="flex items-center justify-between border-b border-[#2D2D2D] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-[#ff0073]" />
          {t("freecutAi.title")}
        </span>
        <button type="button" onClick={onClose} aria-label={t("freecutAi.closePanel")} className="text-white/60 transition-colors hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {phase.kind === "idle" || phase.kind === "undone" ? (
          <p className="text-xs leading-relaxed text-white/60">{phase.kind === "undone" ? t("freecutAi.undone") : t("freecutAi.intro")}</p>
        ) : (
          <div className="self-end rounded-lg bg-white/10 px-3 py-2 text-xs">
            <span className="block text-[11px] text-white/50">{t("freecutAi.youAsked")}</span>
            <span dir="auto">{asked}</span>
          </div>
        )}

        {plan && phase.kind !== "idle" && phase.kind !== "undone" ? (
          <div className="rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("freecutAi.plan")}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {plan.steps.map((step) => (
                <span key={step} className="rounded-md bg-white/10 px-2 py-0.5 text-[11px]">{t(STEP_NAME[step])}</span>
              ))}
            </div>
            {plan.reply ? <p className="mt-2 text-xs text-white/80" dir="auto">{plan.reply}</p> : null}
            {!plan.understood ? <p className="mt-2 text-xs text-white/60">{t("freecutAi.standardEdit")}</p> : null}
          </div>
        ) : null}

        {phase.kind !== "idle" && phase.kind !== "undone" ? (
          <ul className="flex flex-col gap-1.5">
            {AGENTS.map((id) => {
              const view = agents[id]
              return (
                <li key={id} className="grid grid-cols-[8px_72px_minmax(0,1fr)_44px] items-center gap-2 text-xs">
                  <span
                    className={cn("h-2 w-2 rounded-full", view.state === "working" && "animate-pulse", (view.state === "waiting" || view.state === "skipped") && "opacity-40")}
                    style={{ background: AGENT_COLORS[id] }}
                  />
                  <span className="truncate font-semibold" style={{ color: AGENT_COLORS[id] }}>{names[id]}</span>
                  <span className={cn("truncate", view.state === "working" ? "text-white" : "text-white/55", view.state === "failed" && "text-red-400")}>
                    {t(view.key, view.vars)}
                  </span>
                  <span className="h-1 overflow-hidden rounded bg-white/10">
                    <span className="block h-full transition-[width] duration-300" style={{ width: `${Math.round((view.progress ?? (view.state === "done" ? 1 : 0)) * 100)}%`, background: AGENT_COLORS[id] }} />
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}

        {feed.length > 0 ? (
          <ol ref={feedRef} className="flex max-h-56 flex-col gap-1 overflow-y-auto border-t border-[#2D2D2D] pt-2" aria-live="polite">
            {feed.map((line) => (
              <li key={line.id} className="text-[11px] leading-snug">
                <span className="me-1.5 font-semibold" style={{ color: AGENT_COLORS[line.agent] }}>{names[line.agent]}</span>
                <span className="text-white/80" dir="auto">{t(line.key, line.vars)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {phase.kind === "done" ? <Summary summary={phase.summary} /> : null}
        {phase.kind === "stopped" ? <p className="text-xs text-white/70">{t("freecutAi.stopped")}</p> : null}
        {phase.kind === "failed" ? <p className="text-xs text-red-400" dir="auto">{t("freecutAi.failed", { reason: phase.reason })}</p> : null}
        {phase.kind === "failed" && phase.detail ? <p className="text-[11px] text-white/55" dir="auto">{phase.detail}</p> : null}
        {note ? <p className="text-xs text-white/70" role="status">{t(note.key, note.vars)}</p> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-[#2D2D2D] px-4 py-3">
        {phase.kind === "done" || phase.kind === "stopped" || phase.kind === "failed" ? (
          <div className="flex flex-wrap gap-2">
            {phase.kind === "done" ? (
              <button type="button" onClick={play} className="flex items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover">
                <Play className="h-3.5 w-3.5" />
                {t("freecutAi.play")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void undoAll()}
              className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10 disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t("freecutAi.undoAll")}
            </button>
            <button type="button" onClick={() => { setNote(null); setPhase({ kind: "idle" }) }} className="rounded-md px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
              {t("freecutAi.again")}
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="freecut-ai-request" className="sr-only">{t("freecutAi.requestLabel")}</label>
            <textarea
              id="freecut-ai-request"
              dir="auto"
              rows={3}
              value={request}
              readOnly={running}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void start()
                }
              }}
              placeholder={t("freecutAi.placeholder")}
              className="w-full resize-none rounded-md border border-white/15 bg-transparent px-2.5 py-2 text-xs leading-relaxed text-white placeholder:text-white/40 focus:border-[#ff0073] focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] leading-snug text-white/45">{t("freecutAi.pricing")}</span>
              {running ? (
                <button type="button" onClick={() => abortRef.current?.abort()} className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">
                  <Square className="h-3 w-3" />
                  {t("freecutAi.stop")}
                </button>
              ) : (
                <button type="button" onClick={() => void start()} className="flex shrink-0 items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("freecutAi.run")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function Summary({ summary }: { readonly summary: RunSummary }) {
  const t = useT()
  const lines: string[] = []
  if (summary.pausesCut > 0) lines.push(summary.pausesCut === 1 ? t("freecutAi.summaryPausesOne") : t("freecutAi.summaryPauses", { n: summary.pausesCut }))
  if (summary.fillersCut > 0) lines.push(summary.fillersCut === 1 ? t("freecutAi.summaryFillersOne") : t("freecutAi.summaryFillers", { n: summary.fillersCut }))
  if (summary.captions > 0) lines.push(summary.captions === 1 ? t("freecutAi.summaryCaptionsOne") : t("freecutAi.summaryCaptions", { n: summary.captions }))
  if (summary.music) lines.push(t("freecutAi.summaryMusic"))
  return (
    <div className="rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2.5">
      <p className="text-sm font-semibold">{t("freecutAi.summaryTitle")}</p>
      <p className="mt-0.5 font-mono text-xs text-white/70">
        {t("freecutAi.summaryLength", { from: oneDecimal(summary.fromSeconds), to: oneDecimal(summary.toSeconds) })}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-white/85">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

const oneDecimal = (seconds: number) => formatNumber(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
