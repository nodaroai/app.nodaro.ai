/**
 * Edit with AI, the panel beside the embedded editor (FreeCut).
 *
 * Open from the start, it always says what is happening (the status line),
 * and offers what it can do as cards: tapping one writes it into the request,
 * and the person can also just write what they want. A team of agents then
 * edits the video on the editor's own timeline while they watch
 * (`run-ai-edit.ts`). After a run, the cards show what was done, the next
 * step can be asked for right away (the video is listened to once), the edit
 * plays, compares with the original, or is undone in one press.
 *
 * Rendered beside the editor in the workflow editor (through the core shim
 * `components/editor/freecut-ai-slot.tsx`), and framed by other Nodaro
 * products at `/embed/edit-with-ai`. Loaded only on a build with credits.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Ear, Loader2, Sparkles, Square, X } from "lucide-react"
import type { AiPanelVideo } from "@nodaro/shared/media"
import { formatNumber, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { createEditorLink, type EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { requestSteps } from "@/ee/lib/freecut-ai/abilities"
import { costOf, doneSteps, statusOf } from "@/ee/lib/freecut-ai/panel-model"
import { AbilityCards } from "./panel/ability-cards"
import { AskedBubble, ConfirmPartial, Declined, PlanCard } from "./panel/notices"
import { OriginalView } from "./panel/original-view"
import { RequestBox } from "./panel/request-box"
import { ResultBar } from "./panel/result-bar"
import { RunLog } from "./panel/run-log"
import { StatusBlock } from "./panel/status-block"
import { useEditPrices } from "./panel/use-edit-prices"
import { AGENT_NAME, useEditSession } from "./panel/use-edit-session"

export interface AiEditPanelProps {
  /** The window that holds the editor (its frame, or the host page when the panel is framed), read when a message is sent. */
  readonly editorWindow: () => Window | null | undefined
  readonly editorOrigin: string
  /** The videos the panel can edit: each has an address it can be listened to at, and the file name the editor shows. */
  readonly videos: readonly AiPanelVideo[]
  /** The video the editor was opened on, when there is one. */
  readonly openedVideoUrl?: string
  /**
   * The names are the editor's own (the host loaded each video under its name):
   * a video is then told apart from the others on the timeline by its name.
   */
  readonly matchByName?: boolean
  readonly onClose: () => void
  /** Asks the host for the whole editor area (`true`, while the original video is shown) or the side column. */
  readonly onLayout?: (wide: boolean) => void
  /**
   * Which project the editor holds: the host changes it when it starts a fresh
   * one ("New project"), and the panel then forgets what it did in the old one.
   */
  readonly project?: number
  /** Classes for the panel's own box (a framed panel fills its frame). */
  readonly className?: string
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The time now, once a second while `on`: the status line's running clock. */
function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

export default function AiEditPanel({ editorWindow, editorOrigin, videos, openedVideoUrl, matchByName = false, onClose, onLayout, project = 0, className }: AiEditPanelProps) {
  const t = useT()
  const linkRef = useRef<EditorLink | null>(null)
  const [view, setView] = useState<"edited" | "original">("edited")
  const session = useEditSession({ link: () => linkRef.current, videos, openedVideoUrl, matchByName })
  const prices = useEditPrices()
  const now = useTicking(session.phase.kind === "running")

  // A fresh project in the editor: what the panel did in the old one is gone with it.
  const projectRef = useRef(project)
  const forget = session.forget
  useEffect(() => {
    if (projectRef.current === project) return
    projectRef.current = project
    forget()
  }, [project, forget])

  useEffect(() => {
    const link = createEditorLink(editorWindow, editorOrigin)
    linkRef.current = link
    return () => {
      link.dispose()
      linkRef.current = null
    }
  }, [editorWindow, editorOrigin])

  const showOriginal = () => {
    linkRef.current?.playback("pause")
    setView("original")
    onLayout?.(true)
  }
  const backToEdit = () => {
    setView("edited")
    onLayout?.(false)
  }
  // Closed while the original shows: it opens again on the edit, in its column.
  const close = () => {
    if (view === "original") backToEdit()
    onClose()
  }
  // A host that is closed while the original shows gets its column back next time.
  useEffect(() => () => onLayout?.(false), [onLayout])

  const done = doneSteps(session.current.outcomes)
  const asked = useMemo(() => requestSteps(session.request), [session.request])
  const will = asked.filter((step) => !done.includes(step))
  const already = asked.filter((step) => done.includes(step))
  const cost = costOf(will, { heard: !!session.current.heard, prices })
  const planSteps = session.plan?.steps ?? []
  const status = statusOf({
    phase: session.phase,
    view,
    listening: session.listening,
    planSteps: session.phase.kind === "running" ? planSteps : [],
    outcomes: session.current.outcomes,
    working: session.working.filter((a) => a !== "lead").map((a) => t(AGENT_NAME[a])).join(t("common.listComma")),
    elapsed: session.phase.kind === "running" ? clock(now - session.phase.startedAt) : "",
  })
  const phase = session.phase
  const locked = session.running || session.busy || view === "original"
  const heard = session.current.heard
  // What the whole plan is charged, for a plan that costs more than the price shown.
  const unit = creditUnitLabel(t("credits.unitShort"))
  const planCost = phase.kind === "confirming" ? costOf(phase.plan.steps, { heard: !!heard, prices }).total : undefined
  const planTotal = planCost !== undefined ? t(prices.readEstimate ? "freecutAi.priceAbout" : "freecutAi.price", { n: formatNumber(creditUnits(planCost)), u: unit }) : undefined

  return (
    <div className={cn("flex h-full", view === "original" ? "w-full" : "w-[360px] shrink-0", className)}>
      {view === "original" && session.video ? <OriginalView url={session.video.url} onBack={backToEdit} /> : null}
      <aside className="flex h-full w-[360px] shrink-0 flex-col border-s border-[#2D2D2D] bg-[#161616] text-white" aria-label={t("freecutAi.title")}>
        <div className="flex items-center justify-between border-b border-[#2D2D2D] px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[#ff0073]" />
            {t("freecutAi.title")}
          </span>
          <button type="button" onClick={close} aria-label={t("freecutAi.closePanel")} className="text-white/60 transition-colors hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <StatusBlock model={status} subText={phase.kind === "failed" ? phase.reason : undefined} />

        {session.edited && !session.running && view === "edited" ? (
          <ResultBar
            fromSeconds={session.current.fromSeconds}
            toSeconds={session.current.toSeconds}
            busy={session.busy}
            onPlay={session.play}
            onCompare={showOriginal}
            onUndoAll={() => void session.undoAll()}
          />
        ) : null}

        {view === "edited" && !session.running ? (
          <RequestBox
            value={session.request}
            onChange={session.setRequest}
            onSubmit={() => void session.start()}
            will={will}
            already={already}
            cost={cost}
            estimate={prices.readEstimate}
            disabled={locked || !session.video}
            after={session.edited}
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {videos.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-white/75">
              <span className="shrink-0">{t("freecutAi.videoLabel")}</span>
              <select
                value={session.videoUrl}
                disabled={locked}
                onChange={(e) => session.chooseVideo(e.target.value)}
                className="min-w-0 flex-1 truncate rounded-md border border-white/15 bg-[#1E1E1E] px-2 py-1 text-xs text-white"
              >
                {videos.map((v) => (
                  <option key={v.url} value={v.url}>{v.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          {session.running || phase.kind === "declined" ? <AskedBubble text={session.asked} /> : null}
          {session.plan && session.running ? <PlanCard plan={session.plan} /> : null}
          {phase.kind === "confirming" ? <ConfirmPartial plan={phase.plan} extra={phase.extra} total={planTotal} onAnswer={session.answer} /> : null}
          {phase.kind === "declined" ? <Declined plan={phase.plan} reason={phase.reason} /> : null}
          {phase.kind === "failed" && phase.detail ? <p className="text-[11px] text-white/60" dir="auto">{phase.detail}</p> : null}
          {session.note ? <p className="text-xs text-white/75" role="status">{t(session.note.key, session.note.vars)}</p> : null}

          {session.listening ? (
            <p className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("freecutAi.listening")}
            </p>
          ) : heard ? (
            <p className="flex items-center gap-1.5 text-xs text-white/65">
              <Ear className="h-3.5 w-3.5" aria-hidden />
              {heard.words.length > 0 ? t("freecutAi.heardWords", { n: heard.words.length }) : t("freecutAi.noSpeech")}
            </p>
          ) : null}

          <AbilityCards asked={asked} outcomes={session.current.outcomes} locked={locked} prices={prices} onToggle={session.toggleStep} />
          <RunLog lines={session.feed} />
        </div>

        {session.running ? (
          <div className="border-t border-[#2D2D2D] px-4 py-3">
            <button type="button" onClick={session.stop} className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">
              <Square className="h-3 w-3" aria-hidden />
              {t("freecutAi.stop")}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
