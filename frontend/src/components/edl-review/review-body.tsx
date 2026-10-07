"use client"

/**
 * The Cut view's panes (§2.3 of the inspectors design):
 *  - from `sm` up (M1): the reasons panel (with the plan's issues under it) in
 *    a column beside the banners and the transcript;
 *  - below `sm` (M8): the banners, then the tabs Transcript | Cuts | Issues.
 *    Every tab stays mounted (decided 2026-10-07): an inactive one is hidden
 *    but keeps its layout (invisible, laid over the open one, and inert), so
 *    switching back finds the transcript's scroll, selection and find as they
 *    were. A hidden transcript's layers are not Escape's and its keys are off
 *    (`active`): from another tab, Escape closes the dialog and Del cuts
 *    nothing. ⌘F there switches to Transcript and opens find (decided
 *    2026-10-07), unless there is no transcript to find in (Cuts-only).
 * The player and the minimap (A3-4) take their places above the reasons and
 * above the tabs.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReviewChecks } from "@/hooks/use-review-checks"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { useT } from "@/lib/i18n"
import { ReasonsPanel, ReviewIssues } from "./reasons-panel"
import { ReviewBanners } from "./review-banners"
import { TranscriptPane, type TranscriptPaneHandle } from "./transcript-pane"

export interface ReviewBodyProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  readonly checks: ReviewChecks
  readonly runs: ReviewRuns
  /** From `sm` up: the panes side by side; below it, tabs. */
  readonly wide: boolean
}

type ReviewTab = "transcript" | "cuts" | "issues"

/** What the inspector reaches the transcript through: Escape's layers and the keys. */
export type ReviewBodyHandle = Pick<TranscriptPaneHandle, "closeLayer" | "handleKey">

const isFindKey = (e: KeyboardEvent<HTMLElement>): boolean => (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f"

/** A tab panel that stays mounted: never `hidden` (Radix's display:none), inert while another tab is open. */
const kept = (open: boolean) => ({ forceMount: true as const, hidden: false, inert: !open })
// Inactive: kept laid out (display:none would drop the transcript's scroll
// position and the virtualizer's row heights), invisible, over the open tab.
const TAB_CONTENT = "mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:invisible data-[state=inactive]:absolute data-[state=inactive]:inset-0"

export const ReviewBody = forwardRef<ReviewBodyHandle, ReviewBodyProps>(function ReviewBody({ model, edits, checks, runs, wide }, ref) {
  const t = useT()
  const [tab, setTab] = useState<ReviewTab>("transcript")
  const pane = useRef<TranscriptPaneHandle | null>(null)
  // A ⌘F pressed on Cuts or Issues: find opens once the transcript is showing
  // (an inert panel takes no focus), in the commit after the tab switch.
  const [findOnShow, setFindOnShow] = useState(0)
  const transcriptShown = wide || tab === "transcript"

  useImperativeHandle(ref, () => ({
    closeLayer: () => pane.current?.closeLayer() ?? false,
    handleKey: (e) => {
      if (!transcriptShown && isFindKey(e) && pane.current?.canFind) {
        e.preventDefault()
        setTab("transcript")
        setFindOnShow((n) => n + 1)
        return
      }
      pane.current?.handleKey(e)
    },
  }), [transcriptShown])
  useEffect(() => {
    if (findOnShow > 0) pane.current?.openFindFromTab()
  }, [findOnShow])
  const banners = <ReviewBanners model={model} edits={edits} checks={checks} runs={runs} />

  if (wide) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-e border-border p-3">
          <ReasonsPanel model={model} edits={edits} withIssues />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {banners}
          <TranscriptPane ref={pane} model={model} edits={edits} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {banners}
      <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewTab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList aria-label={t("edlReview.sections")} className="mx-3 my-2 shrink-0">
          <TabsTrigger value="transcript">{t("edlReview.tabTranscript")}</TabsTrigger>
          <TabsTrigger value="cuts">{t("edlReview.tabCuts")}</TabsTrigger>
          <TabsTrigger value="issues">{t("edlReview.tabIssues")}</TabsTrigger>
        </TabsList>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TabsContent value="transcript" {...kept(tab === "transcript")} className={TAB_CONTENT}>
            <TranscriptPane ref={pane} model={model} edits={edits} active={tab === "transcript"} />
          </TabsContent>
          <TabsContent value="cuts" {...kept(tab === "cuts")} className={`${TAB_CONTENT} overflow-auto p-3`}>
            <ReasonsPanel model={model} edits={edits} withIssues={false} />
          </TabsContent>
          <TabsContent value="issues" {...kept(tab === "issues")} className={`${TAB_CONTENT} overflow-auto p-3`}>
            <ReviewIssues problems={model.planProblems} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
})
