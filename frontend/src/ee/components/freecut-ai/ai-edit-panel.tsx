/**
 * Edit with AI, the panel beside the embedded editor (FreeCut).
 *
 * Calm by default, like the podcast page it follows: one question, what it
 * can do as quiet rows in two tabs (edit this video, make from it), a field
 * for the person's own words, and one button with the price, pinned at the
 * bottom. While the agents work, the rows give way to this run's steps, each
 * with its live line, and the last things the agents said; the show can be
 * sped up or skipped. After, one line says what the edit did, the editor's own
 * player compares it with the original (Original | Split | Edited), Wide |
 * Phone switches the format, what was made waits in Results, and Undo all is
 * there, quietly.
 *
 * Rendered beside the editor in the workflow editor (through the core shim
 * `components/editor/freecut-ai-slot.tsx`), and framed by other Nodaro
 * products at `/embed/edit-with-ai`. Loaded only on a build with credits.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Sparkles, X } from "lucide-react"
import type { AiPanelVideo } from "@nodaro/shared/media"
import { formatNumber, useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { createEditorLink, type CompareMode, type EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { ABILITIES, ABILITY_NAME, ABILITY_OF, cardPhraseKeys, requestSteps } from "@/ee/lib/freecut-ai/abilities"
import { EDIT_STEPS, readTimelineView, timelineSeconds, type EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import { costOf, lockedSteps, statusOf } from "@/ee/lib/freecut-ai/panel-model"
import { cardOnlyPlan, layoutInWords } from "@/ee/lib/freecut-ai/request-reading"
import { brollCount } from "@/ee/lib/freecut-ai/run/broll"
import { titleCount } from "@/ee/lib/freecut-ai/run/titles"
import { AbilityRows } from "./panel/ability-cards"
import { LayoutShots } from "./panel/layout-shots"
import { AskedBubble, ConfirmPartial, Declined } from "./panel/notices"
import { OriginalView } from "./panel/original-view"
import { PictureWhere } from "./panel/picture-where"
import { PictureCount } from "./panel/picture-count"
import { Pictures } from "./panel/pictures"
import { TitleOptions } from "./panel/title-options"
import { Titles } from "./panel/titles"
import { ActionFooter, RequestField } from "./panel/request-box"
import { ResultBar } from "./panel/result-bar"
import { Results } from "./panel/results"
import { RunControls } from "./panel/run-controls"
import { Narration, RunList } from "./panel/run-list"
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
  /** The names are the editor's own (the host loaded each video under its name). */
  readonly matchByName?: boolean
  /** The editor's abilities (`FREECUT_READY.capabilities`): what it can draw and edit for the panel. */
  readonly capabilities?: readonly string[]
  readonly onClose: () => void
  /** Asks the host for the whole editor area (`true`, while the original video is shown by the panel itself) or the side column. */
  readonly onLayout?: (wide: boolean) => void
  /** Which project the editor holds: a fresh one ("New project") makes the panel forget what it did. */
  readonly project?: number
  /** Classes for the panel's own box (a framed panel fills its frame). */
  readonly className?: string
  /** Shown on top while there is no video to edit: which videos the panel works on. */
  readonly noVideoNote?: string
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

type Tab = "edit" | "make"

/** What the panel reads of the editor's timeline: the video's length (for prices) and whether several cameras are there. */
function useTimelineFacts(link: () => EditorLink | null, key: string): { readonly seconds?: number; readonly cameras: number } {
  const [facts, setFacts] = useState<{ seconds?: number; cameras: number }>({ cameras: 1 })
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Asked again until the video is on the timeline: the editor opens, then loads it.
    const read = async (attempt: number) => {
      let found = false
      try {
        const view = readTimelineView(await link()?.getTimeline())
        if (!live) return
        if (view) {
          const videos = new Set(view.items.filter((i) => i.type === "video" && i.mediaId).map((i) => i.mediaId))
          found = videos.size > 0
          if (found) setFacts({ seconds: Math.max(timelineSeconds(view), ...(view.media ?? []).map((m) => m.duration ?? 0)), cameras: videos.size })
        }
      } catch {
        // The editor is still opening.
      }
      if (live && !found && attempt < 60) timer = setTimeout(() => void read(attempt + 1), 1500)
    }
    timer = setTimeout(() => void read(0), 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [link, key])
  return facts
}

export default function AiEditPanel({ editorWindow, editorOrigin, videos, openedVideoUrl, matchByName = false, capabilities = [], onClose, onLayout, project = 0, className, noVideoNote }: AiEditPanelProps) {
  const t = useT()
  const linkRef = useRef<EditorLink | null>(null)
  const [view, setView] = useState<"edited" | "original">("edited")
  const [tab, setTab] = useState<Tab>("edit")
  const session = useEditSession({ link: () => linkRef.current, videos, openedVideoUrl, matchByName, capabilities })
  const linkOf = useMemo(() => () => linkRef.current, [])
  const facts = useTimelineFacts(linkOf, `${session.videoUrl}|${project}|${session.phase.kind}`)
  const listed = useEditPrices(facts.seconds)
  // How many pictures the next run lays on the words: the person's number, else the video's length decides.
  const pictures = facts.seconds === undefined ? undefined : brollCount(facts.seconds, session.pictureCount)
  // A picture change on several shots is charged once per shot; the pictures on the words, once per picture.
  const prices = useMemo(
    () => ({
      ...listed,
      steps: {
        ...listed.steps,
        picture: listed.steps.picture === undefined ? undefined : listed.steps.picture * session.pictureShots,
        broll: listed.brollPicture === undefined || pictures === undefined ? undefined : listed.brollPicture * pictures,
      },
    }),
    [listed, session.pictureShots, pictures],
  )
  const now = useTicking(session.phase.kind === "running")
  const editorCompares = capabilities.includes("compare")

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

  const showCompare = (mode: CompareMode) => {
    if (editorCompares) {
      session.setCompareMode(mode)
      linkRef.current?.compare(mode)
      return
    }
    // An editor without its own compare: the panel shows the original in its place.
    linkRef.current?.playback("pause")
    setView("original")
    onLayout?.(true)
  }
  const backToEdit = () => {
    setView("edited")
    onLayout?.(false)
  }
  // Closed while comparing: the editor goes back to the edit.
  const close = () => {
    if (view === "original") backToEdit()
    if (session.compareMode !== "program") linkRef.current?.compare("program")
    onClose()
  }
  useEffect(() => () => onLayout?.(false), [onLayout])

  const locked = lockedSteps(session.current.outcomes)
  const asked = useMemo(() => requestSteps(session.request), [session.request])
  const will = asked.filter((step) => !locked.includes(step))
  const already = asked.filter((step) => locked.includes(step))
  // A request made only of the cards' words is not read by a model: no reading to pay for.
  const cardsOnly = useMemo(() => !!cardOnlyPlan(session.request, EDIT_STEPS.flatMap((step) => cardPhraseKeys(step).map((key) => ({ step, text: t(key) })))), [session.request, t])
  const heard = session.current.heard
  const cost = costOf(will, { heard: !!heard, read: !cardsOnly && session.request.trim().length > 0, prices })
  const planSteps = session.plan?.steps ?? []
  const phase = session.phase
  const status = statusOf({
    phase,
    stage: session.stage,
    waiting: session.waiting,
    view,
    planSteps: phase.kind === "running" ? planSteps : [],
    outcomes: session.current.outcomes,
    working: session.working.filter((a) => a !== "lead").map((a) => t(AGENT_NAME[a])).join(t("common.listComma")),
    elapsed: phase.kind === "running" ? clock(now - phase.startedAt) : "",
  })
  const lockedUi = session.running || session.busy || view === "original"
  const unit = creditUnitLabel(t("credits.unitShort"))
  const credits = (n: number) => ({ n: formatNumber(creditUnits(n)), u: unit })
  const planCost = phase.kind === "confirming" ? costOf(phase.plan.steps, { heard: !!heard, read: false, prices }).total : undefined
  const planTotal = planCost !== undefined ? t(prices.readEstimate ? "freecutAi.priceAbout" : "freecutAi.price", credits(planCost)) : undefined
  // What a plan adds beyond the price shown, each with its own price when known.
  const confirmLines =
    phase.kind === "confirming"
      ? [
          ...(phase.extra.listen ? [prices.listen !== undefined ? t("freecutAi.cost.listen", credits(prices.listen)) : t("freecutAi.extra.listen")] : []),
          ...phase.extra.steps.map((step) => {
            const price = prices.steps[step]
            return price !== undefined ? t(`freecutAi.cost.${step}` as MessageKey, credits(price)) : t(ABILITY_NAME[step])
          }),
        ]
      : []
  // Not offered here: what this editor cannot do yet, and switching cameras with one camera.
  const hidden: EditStep[] = [
    ...(capabilities.includes("edit-ops-2") ? [] : EDIT_STEPS.filter((step) => ABILITY_OF[step].needs === "edit-ops-2")),
    ...(facts.cameras < 2 ? (["cameras"] as const) : []),
  ]
  // An editor that cannot make anything yet has no Make tab.
  const makeOffered = ABILITIES.some((a) => a.group === "make" && !hidden.includes(a.key))
  const shownTab: Tab = makeOffered ? tab : "edit"
  const idle = !session.running && !session.edited && phase.kind === "idle"
  const makeOnly = will.length > 0 && will.every((step) => ABILITY_OF[step].group === "make")
  const summary = phase.kind === "done" ? phase.summary : undefined

  return (
    <div className={cn("flex h-full", view === "original" ? "w-full" : "w-[360px] shrink-0", className)}>
      {view === "original" && session.video ? <OriginalView url={session.video.url} onBack={backToEdit} /> : null}
      <aside className="flex h-full w-[360px] shrink-0 flex-col border-s border-white/10 bg-[#0b0b11] text-white" aria-label={t("freecutAi.title")}>
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-[#ff0073]" />
            {t("freecutAi.title")}
          </span>
          <button type="button" onClick={close} aria-label={t("freecutAi.closePanel")} className="rounded-md p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {idle ? null : <StatusBlock model={status} subText={phase.kind === "failed" ? phase.reason : undefined} />}

        {session.edited && !session.running && view === "edited" ? (
          <ResultBar
            fromSeconds={session.current.fromSeconds}
            toSeconds={session.current.toSeconds}
            summary={summary}
            busy={session.busy}
            compare={editorCompares ? session.compareMode : null}
            onCompare={showCompare}
            onUndoAll={() => void session.undoAll()}
            format={session.current.framing ? session.current.format ?? "phone" : undefined}
            onFormat={(to) => void session.switchFormat(to)}
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3">
          {idle ? (
            <div className="flex flex-col gap-1 pt-1">
              <h2 className="text-[19px] font-semibold leading-snug tracking-tight">{t("freecutAi.ask.title")}</h2>
              <p className="text-[12px] leading-relaxed text-white/55">{t("freecutAi.ask.sub")}</p>
            </div>
          ) : null}

          {videos.length === 0 && noVideoNote ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] leading-relaxed text-white/75" role="status">{noVideoNote}</p>
          ) : null}

          {videos.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-white/75">
              <span className="shrink-0">{t("freecutAi.videoLabel")}</span>
              <select
                value={session.videoUrl}
                disabled={lockedUi}
                onChange={(e) => session.chooseVideo(e.target.value)}
                className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white"
              >
                {videos.map((v) => (
                  <option key={v.url} value={v.url}>{v.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          {session.running ? (
            <>
              <AskedBubble text={session.asked} />
              {phase.kind === "confirming" ? <ConfirmPartial plan={phase.plan} lines={confirmLines} total={planTotal} onAnswer={session.answer} /> : null}
              {session.plan && planSteps.length > 0 && phase.kind !== "confirming" ? <RunList plan={session.plan} outcomes={session.current.outcomes} /> : null}
              <Narration lines={session.feed} />
            </>
          ) : (
            <>
              {phase.kind === "declined" ? (
                <>
                  <AskedBubble text={session.asked} />
                  <Declined plan={phase.plan} reason={phase.reason} />
                </>
              ) : null}
              {phase.kind === "failed" && phase.detail ? <p className="text-[11px] text-white/60" dir="auto">{phase.detail}</p> : null}
              {session.note ? <p className="text-xs text-white/75" role="status">{t(session.note.key, session.note.vars)}</p> : null}
              <Results made={session.current.made} onOpen={(id) => linkRef.current?.openSequence(id)} />
              {view === "edited" ? <LayoutShots link={linkOf} refreshKey={`${session.videoUrl}|${project}|${phase.kind}|${session.busy}`} faces={session.current.faces?.set} busy={session.busy} onChange={(rows, choice) => void session.changeShots(rows, choice)} /> : null}
              {view === "edited" ? <Pictures link={linkOf} refreshKey={`${session.videoUrl}|${project}|${phase.kind}|${session.busy}`} records={session.current.pictures ?? []} busy={session.busy} price={listed.brollPicture === undefined ? undefined : t("freecutAi.price", credits(listed.brollPicture))} onChange={(row, choice) => void session.changePicture(row, choice)} onAdd={(choice) => void session.addPicture(choice)} /> : null}
              {view === "edited" ? <Titles link={linkOf} refreshKey={`${session.videoUrl}|${project}|${phase.kind}|${session.busy}`} records={session.current.titles ?? []} look={session.titleLook} busy={session.busy} onChange={(row, change) => void session.changeTitle(row, change)} /> : null}

              {makeOffered ? (
                <div role="tablist" aria-label={t("freecutAi.title")} className="flex rounded-lg bg-white/[0.05] p-0.5">
                  {(["edit", "make"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={shownTab === id}
                      onClick={() => setTab(id)}
                      className={cn("flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors", shownTab === id ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white")}
                    >
                      {t(id === "edit" ? "freecutAi.tab.edit" : "freecutAi.tab.make")}
                    </button>
                  ))}
                </div>
              ) : null}
              <AbilityRows
                groups={shownTab === "edit" ? ["tidy", "add", "look", "format"] : ["make"]}
                asked={asked}
                outcomes={session.current.outcomes}
                locked={lockedUi}
                hidden={hidden}
                onToggle={session.toggleStep}
                layoutWide={layoutInWords(session.request) === "side"}
                onLayoutWide={session.setLayoutWide}
                pictureNote={<PictureWhere link={linkOf} shots={session.pictureShots} locked={lockedUi} onShots={session.setPictureShots} />}
                brollNote={pictures === undefined ? undefined : <PictureCount count={pictures} locked={lockedUi} onCount={session.setPictureCount} />}
                titlesNote={facts.seconds === undefined ? undefined : <TitleOptions look={session.titleLook} count={titleCount(facts.seconds, session.titleCount)} locked={lockedUi} onLook={session.setTitleLook} onCount={session.setTitleCount} />}
              />
              {view === "edited" ? (
                <RequestField
                  value={session.request}
                  onChange={session.setRequest}
                  onSubmit={() => void session.start()}
                  will={will}
                  already={already}
                  disabled={lockedUi || !session.video}
                  after={session.edited}
                />
              ) : null}
              <RunLog lines={session.feed} />
            </>
          )}
        </div>

        {session.running ? (
          phase.kind === "confirming" ? null : <RunControls speed={session.speed} onSpeed={session.setSpeed} onSkip={session.skip} onStop={session.stop} />
        ) : view === "edited" ? (
          <ActionFooter cost={cost} estimate={prices.readEstimate} ready={will.length > 0 || (session.request.trim().length > 0 && !cardsOnly)} makeOnly={makeOnly} disabled={lockedUi || !session.video} onStart={() => void session.start()} />
        ) : null}
      </aside>
    </div>
  )
}
