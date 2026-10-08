"use client"

/**
 * The Tighten review inspector (§2 of the inspectors design, A3): a full-size
 * `InspectorShell` anchored at one render, built on the review model
 * (`useReviewModel`, `useReviewEdits`, `useReviewChecks`).
 *
 * The header, the player (Preview or Final, and Original audition), the
 * transcript pane (its rows, minimap, span popover, selection toolbar and
 * find bar), the reasons panel, the banners and the footer with its gate;
 * below `sm` the panes become tabs (review-body.tsx). The editor mounts it
 * once, in `ReviewInspectorHost` (which shows the Clip Pack inspector instead
 * for a clip set: `ReviewInspector` picks), and opens it from a render's Review cut, the
 * context menu, an Edit Plan's Expand and `?review=<id>` (A3-5); its component
 * tests mount it directly.
 *
 * KEYS, all inside the dialog only (the canvas's own shortcuts stand down
 * under a modal, and keys typed in a portalled menu are the menu's): ⌘Z / ⇧⌘Z
 * undo and redo the review (R8 a); ⌘F find (below `sm`, from the Cuts or
 * Issues tab too: it switches to Transcript); Space plays or pauses the
 * player (not in a text field, and not on a focused control, whose own key
 * it is); with a selection, Del cuts it, R restores it and ⌘C copies its words.
 *
 * ESCAPE closes the innermost layer first (§2.4): the span popover (a Radix
 * layer, which closes itself), then the selection toolbar, then the find bar,
 * then the expanded run that has focus (decided 2026-10-06), and only then the
 * dialog. Closing, by any route, writes the pending edit first (`flush`), as
 * do Render final and Update preview (`useReviewRuns`).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Scissors } from "lucide-react"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { useReviewChecks } from "@/hooks/use-review-checks"
import { useReviewEdits } from "@/hooks/use-review-edits"
import { useReviewModel } from "@/hooks/use-review-model"
import { useReviewPlayback } from "@/hooks/use-review-playback"
import { useReviewRuns } from "@/hooks/use-review-runs"
import { SM_UP, useMediaQuery } from "@/hooks/use-media-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewKindOf } from "@/lib/edl-review/review-entry"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { ClipInspector } from "./clip-pack/clip-inspector"
import { ReviewActions, ReviewMeta, ReviewTitle, type ReviewView } from "./review-header"
import { ReviewBody, type ReviewBodyHandle } from "./review-body"
import { ReviewFooter } from "./review-footer"
import { ReviewJsonView } from "./review-json-view"
import { isControl, isTextField } from "./transcript-keys"

import type { ReviewInspectorProps } from "./inspector-props"
export type { ReviewInspectorProps }

/** The canvas node the review is anchored at: where focus goes back to when the opener is gone. */
function nodeElementOf(renderId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(renderId)}"]`)
}

export function ReviewInspector(props: ReviewInspectorProps) {
  // Which inspector a render opens (A4-2): a clip set's is the Clip Pack's. Read
  // as a string, so a run's ticks re-render nothing.
  const kind = useWorkflowStore((s) => reviewKindOf(props.renderId, s.nodes, s.edges))
  if (!props.open) return null
  // The model subscribes to the store: mounted only while the review is open.
  return kind === "clips" ? <ClipInspector {...props} /> : <OpenReviewInspector {...props} />
}

function OpenReviewInspector({ renderId: anchoredAt, onClose, onRenderChange }: ReviewInspectorProps) {
  const t = useT()
  const [renderId, setRenderId] = useState(anchoredAt)
  useEffect(() => setRenderId(anchoredAt), [anchoredAt])

  const model = useReviewModel(renderId)
  const edits = useReviewEdits(model)
  const checks = useReviewChecks(model, edits)
  const runs = useReviewRuns(model, edits, checks)
  const playback = useReviewPlayback(model, edits, checks)
  const wide = useMediaQuery(SM_UP)
  const [view, setView] = useState<ReviewView>("cut")
  const pane = useRef<ReviewBodyHandle | null>(null)

  const close = useCallback(() => {
    edits.flush()
    onClose()
  }, [edits, onClose])

  const changeRender = useCallback((id: string) => {
    if (id === renderId) return
    edits.flush()
    setRenderId(id)
    onRenderChange?.(id)
  }, [edits, renderId, onRenderChange])

  const onEscapeKeyDown = useCallback((e: globalThis.KeyboardEvent) => {
    if (view === "cut" && pane.current?.closeLayer()) e.preventDefault()
  }, [view])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    // React bubbles keys from portalled children (the header's menus and the
    // render picker) up here: a typeahead "r" or a Delete there is the menu's.
    if (e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.altKey && e.key.toLowerCase() === "z" && !isTextField(e.target)) {
      e.preventDefault()
      if (e.shiftKey) edits.redo()
      else edits.undo()
      return
    }
    if (view === "cut" && e.key === " " && !mod && !e.altKey && !isTextField(e.target) && !isControl(e.target)) {
      e.preventDefault()
      playback.toggle()
      return
    }
    if (view === "cut") pane.current?.handleKey(e)
  }, [edits, view, playback])

  const editedValue = edits.edited ?? model.base ?? model.plan
  const canReset = edits.canEdit && (edits.pendingReview !== undefined || model.editStatus !== "none")

  return (
    <InspectorShell
      open
      size="full"
      returnFocusTo={() => nodeElementOf(renderId)}
      onClose={close}
      icon={<Scissors />}
      title={<ReviewTitle planId={model.planId} renderId={renderId} />}
      meta={
        <ReviewMeta
          planId={model.planId}
          renderId={renderId}
          onRenderChange={changeRender}
          take={model.take}
          renders={checks.renders}
          settings={{ output: model.render.output, crossfadeMs: model.render.crossfadeMs }}
        />
      }
      actions={
        model.base ? (
          <ReviewActions
            view={view}
            onViewChange={setView}
            canReset={canReset}
            onReset={edits.resetToPlan}
            onCopyJson={() => copyToClipboard(JSON.stringify(editedValue, null, 2), t("node.dataCopied"))}
          />
        ) : undefined
      }
      onEscapeKeyDown={onEscapeKeyDown}
      onKeyDown={onKeyDown}
      // Decided here, not by the footer returning null: the shell draws its
      // bordered band for any footer element it is given.
      footer={model.base && runs.gate.mode !== "hidden" ? <ReviewFooter model={model} edits={edits} runs={runs} compact={!wide} /> : undefined}
      bodyClassName="p-0 gap-0"
    >
      {!model.base ? (
        <p className="p-4 text-sm text-muted-foreground" data-testid="review-no-plan">{t("edlReview.noPlan")}</p>
      ) : view === "json" ? (
        <ReviewJsonView edited={editedValue} planned={model.plan} />
      ) : (
        <ReviewBody ref={pane} model={model} edits={edits} checks={checks} runs={runs} playback={playback} wide={wide} />
      )}
    </InspectorShell>
  )
}
