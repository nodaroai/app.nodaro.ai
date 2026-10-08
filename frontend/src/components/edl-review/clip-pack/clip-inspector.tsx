"use client"

/**
 * The Clip Pack inspector (§4 of the inspectors design, A4-2): a full-size
 * `InspectorShell` anchored at one render of a clip set. One card per planned
 * clip the render's wire sends it (`buildClipCards`, matched to its takes by
 * `clipKey`), each with a Keep switch and an editable hook (text only, TA20 a);
 * Render final renders the kept clips only (TA15 a).
 *
 * Built on the same model as the cut review: `useReviewModel` (the plan, the
 * lock, the newer-run check), `useReviewChecks` (the render rule's verdict on
 * the decisions as they stand, with the not-yet-written ones in place) and
 * `useReviewRuns` (Render final behind the footer's gate); the decisions are
 * `useClipDecisions`. Closing, by any route, and Render final write a hook
 * typed a moment ago first (`flush`), so the run reads it.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Clapperboard } from "lucide-react"
import { resolveEditPlanOutput } from "@nodaro/shared"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { useClipCardInputs, useClipCards, useLiveClipCards } from "@/hooks/use-clip-cards"
import { useClipDecisions } from "@/hooks/use-clip-decisions"
import type { ReviewEditState } from "@/hooks/review-edit-state"
import { useReviewChecks } from "@/hooks/use-review-checks"
import { useReviewModel } from "@/hooks/use-review-model"
import { useReviewRuns } from "@/hooks/use-review-runs"
import { SM_UP, useMediaQuery } from "@/hooks/use-media-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { clipRenderChain } from "@/lib/edl-review/clip-chain"
import { clearReview } from "@/lib/edl-review/write-review"
import { useT } from "@/lib/i18n"
import type { ReviewInspectorProps } from "../inspector-props"
import { ReviewJsonView } from "../review-json-view"
import { ReviewTitle } from "../review-header"
import { ClipBody } from "./clip-body"
import { ClipActions, ClipMeta, type ClipView } from "./clip-header"
import { ClipFooter } from "./clip-footer"
import { useSinglePlayback } from "./use-single-playback"

/** The canvas node the review is anchored at: where focus goes back to when the opener is gone. */
function nodeElementOf(renderId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(renderId)}"]`)
}

export function ClipInspector(props: ReviewInspectorProps) {
  // The model subscribes to the store: mounted only while the review is open.
  return props.open ? <OpenClipInspector {...props} /> : null
}

function OpenClipInspector({ renderId: anchoredAt, onClose, onRenderChange }: ReviewInspectorProps) {
  const t = useT()
  const [renderId, setRenderId] = useState(anchoredAt)
  useEffect(() => setRenderId(anchoredAt), [anchoredAt])

  const model = useReviewModel(renderId)
  const decisions = useClipDecisions({ planId: model.planId, plan: model.plan, editedEdl: model.editedEdl, locked: model.locked })
  const inputs = useClipCardInputs(model, decisions.decisions)
  const base = useClipCards(inputs)

  const { flush, pendingReview } = decisions
  const keptCount = decisions.decisions && base ? base.keptCount : null
  const edits = useMemo<ReviewEditState>(() => ({ keptCount, pendingReview, flush }), [keptCount, pendingReview, flush])
  const checks = useReviewChecks(model, edits)
  const runs = useReviewRuns(model, edits, checks)
  const cards = useLiveClipCards(renderId, inputs, base, runs.running)

  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const chain = useMemo(() => (runs.gate.mode === "hidden" ? [] : clipRenderChain(renderId, nodes, edges)), [runs.gate.mode, renderId, nodes, edges])

  const wide = useMediaQuery(SM_UP)
  const [view, setView] = useState<ClipView>("clips")
  const playback = useSinglePlayback()

  const close = useCallback(() => {
    flush()
    onClose()
  }, [flush, onClose])
  const changeRender = useCallback((id: string) => {
    if (id === renderId) return
    flush()
    setRenderId(id)
    onRenderChange?.(id)
  }, [flush, renderId, onRenderChange])

  const rows = useMemo(() => cards?.cards.map((c) => c.row) ?? [], [cards])
  const keepAll = useCallback(() => decisions.setKeepFor(rows, true), [decisions, rows])
  const dropAll = useCallback(() => decisions.setKeepFor(rows, false), [decisions, rows])
  const discardStaleEdit = useCallback(() => {
    if (model.planId && !model.locked) clearReview(model.planId)
  }, [model.planId, model.locked])

  const jsonValue = useMemo(
    () => (model.plan === undefined ? null : resolveEditPlanOutput(model.plan, pendingReview).json ?? model.plan),
    [model.plan, pendingReview],
  )

  return (
    <InspectorShell
      open
      size="full"
      returnFocusTo={() => nodeElementOf(renderId)}
      onClose={close}
      icon={<Clapperboard />}
      title={<ReviewTitle planId={model.planId} renderId={renderId} kind="clips" />}
      meta={
        <ClipMeta
          cards={cards}
          planId={model.planId}
          renderId={renderId}
          onRenderChange={changeRender}
          renders={checks.renders}
          settings={{ output: model.render.output, crossfadeMs: model.render.crossfadeMs }}
        />
      }
      actions={
        cards ? (
          <ClipActions view={view} onViewChange={setView} canBulk={decisions.canEdit && rows.length > 0} onKeepAll={keepAll} onDropAll={dropAll} />
        ) : undefined
      }
      footer={cards && runs.gate.mode !== "hidden" ? <ClipFooter cards={cards} runs={runs} chain={chain} compact={!wide} onClose={close} /> : undefined}
      bodyClassName="p-0 gap-0"
    >
      {!cards ? (
        <p className="p-4 text-sm text-muted-foreground" data-testid="clip-no-plan">{t("clipReview.noPlan")}</p>
      ) : view === "json" ? (
        <ReviewJsonView edited={jsonValue} planned={model.plan} />
      ) : (
        <ClipBody
          model={model}
          cards={cards}
          onDiscardStaleEdit={discardStaleEdit}
          grid={{
            progress: cards.progress,
            canEdit: decisions.canEdit,
            active: playback.active,
            onPlay: playback.play,
            onKeep: decisions.setKeep,
            onHook: decisions.setHook,
            onResetHook: decisions.resetHook,
          }}
        />
      )}
    </InspectorShell>
  )
}
