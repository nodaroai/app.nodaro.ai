"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { AskConfirmInfo, RunConfirmInfo } from "./types"
import { creditUnits } from "@/lib/credit-units"
import { useT, type TFunction } from "@/lib/i18n"
import { RunConfirmBreakdown } from "./run-confirm-breakdown"
import { runLinesUnpriced } from "./run-unpriced"
import { INSPECTOR_CHILD_DIALOG_Z } from "@/components/inspector/inspector-shell"

interface UseRunConfirm {
  /** Resolves true to run, false to abort. Single-flight: a second call while a
   *  dialog is open resolves false immediately (no stacked dialog / leaked promise). */
  readonly confirmRun: (info: RunConfirmInfo) => Promise<boolean>
  /** A yes/no question that is not about price; same single-flight contract. */
  readonly askConfirm: (info: AskConfirmInfo) => Promise<boolean>
  /** True while a confirm dialog is open — bind to the run button's `disabled`. */
  readonly isConfirming: boolean
  readonly dialog: ReactNode
}

/**
 * The run confirm's title, description and action label. Render final and
 * Update preview title with the mockups' "action · ≈credits" (round 2, decided
 * 2026-10-06): the button's own words, then the figure written exactly as the
 * breakdown's total row writes it (`renderFinal.lineTotalCredits`).
 */
export function runConfirmText(
  info: RunConfirmInfo | null,
  t: TFunction,
): { readonly title: string; readonly body: string; readonly action: string } {
  const credits = info?.estimatedCredits ?? null
  const nodeLabel = info
    ? info.nodeCount === 1
      ? t("editor.runConfirmNodeOne", { n: info.nodeCount })
      : t("editor.runConfirmNodes", { n: info.nodeCount })
    : ""
  const isRenderFinal = info?.trigger === "render-final"
  // A continuation (Continue from failed, Finish review) is always asked: its
  // own words, its figure in the title, and a body that says every listed step
  // runs and is charged.
  if (info && (info.trigger === "continue-failed" || info.trigger === "finish-review")) {
    const finish = info.trigger === "finish-review"
    const title = credits != null && !info.priceUnchecked
      ? t(finish ? "continueFailed.finishConfirmTitleCredits" : "continueFailed.confirmTitleCredits", { credits: creditUnits(credits) })
      : t(finish ? "continueFailed.finishConfirmTitle" : "continueFailed.confirmTitle")
    const body = t(finish ? "continueFailed.finishConfirmBody" : "continueFailed.confirmBody")
    return { title, body, action: runConfirmAction(info, t) }
  }
  // A run holding a node the server refuses to price (`llm_model_unpriced`): its title states no
  // figure — the one it has leaves that node out — but the button's words and "not priced yet".
  if (info && credits != null && runLinesUnpriced(info.lines ?? [])) {
    return { title: `${runConfirmAction(info, t)} · ${t("renderFinal.priceNotPricedYet")}`, body: nodeLabel, action: runConfirmAction(info, t) }
  }
  // A run whose UGC price could not be checked asks first whatever its figure: its title states no price,
  // and its body gives the figure the note under it speaks of.
  if (info?.priceUnchecked) {
    const title = isRenderFinal ? t("renderFinal.confirmTitle")
      : info.trigger === "up-to-here" ? t("runUpToHere.confirmTitle")
        : info.alwaysConfirm ? t("editor.runConfirmEntireTitle")
          : t("ugc.price.uncheckedTitle")
    const itemised = isRenderFinal || info.trigger === "update-preview"
    const body = !itemised && credits != null ? t("editor.runConfirmEstimated", { nodes: nodeLabel, credits: creditUnits(credits) }) : nodeLabel
    return { title, body, action: runConfirmAction(info, t) }
  }
  const title = isRenderFinal
    ? credits != null
      ? t("renderFinal.confirmTitleCredits", { credits: creditUnits(credits) })
      : t("renderFinal.confirmTitle")
    : info?.trigger === "update-preview" && credits != null
      ? t("renderFinal.previewConfirmTitleCredits", { credits: creditUnits(credits) })
    : info?.trigger === "up-to-here"
      ? credits != null
        ? t("runUpToHere.confirmTitleCredits", { credits: creditUnits(credits) })
        : t("runUpToHere.confirmTitle")
    : info?.alwaysConfirm
      ? t("editor.runConfirmEntireTitle")
      : t("editor.runConfirmCreditsTitle", { credits: creditUnits(credits ?? 0) })
  // Run up to here carries its figure in the title, as Render final does.
  const body = !isRenderFinal && info?.trigger !== "up-to-here" && info?.alwaysConfirm && credits != null ? t("editor.runConfirmEstimated", { nodes: nodeLabel, credits: creditUnits(credits) }) : nodeLabel
  return { title, body, action: runConfirmAction(info, t) }
}

/** The confirm's action: the button's own words. */
function runConfirmAction(info: RunConfirmInfo | null, t: TFunction): string {
  return info?.trigger === "render-final" ? t("renderFinal.action")
    : info?.trigger === "update-preview" ? t("renderFinal.updatePreview")
      : info?.trigger === "continue-failed" ? t("continueFailed.action")
      : info?.trigger === "finish-review" ? t("continueFailed.finishReview")
      : info?.trigger === "up-to-here" ? t("node.runUpToHere")
        : t("common.run")
}

/**
 * Run-confirmation gate dialog. The editor wires `confirmRun` onto the
 * `ExecutionContext`; the run handlers `await` it before any side effect.
 *
 * Both dialogs stack above an open inspector (`INSPECTOR_CHILD_DIALOG_Z`):
 * the review inspector's Render final and Update preview open them over it.
 */
export function useRunConfirm(
  /** The workflow the editor is on: a confirmation asked for one is answered "no" once the editor leaves it. */
  workflowId?: string | null,
): UseRunConfirm {
  const t = useT()
  const [info, setInfo] = useState<RunConfirmInfo | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)
  const [ask, setAsk] = useState<AskConfirmInfo | null>(null)
  const askResolverRef = useRef<((v: boolean) => void) | null>(null)

  // No confirmation outlives its editor, nor the workflow it was asked for. A dialog open when the
  // editor goes away (browser Back with it up) or switches to another workflow in place is
  // answered "no", and one asked after the editor went (a run that was still being priced when it
  // left) is answered "no" at once: every run waiting on it takes its own abort path and releases
  // what it holds (a node's in-flight ▶, Run from here's lock) instead of keeping that node
  // un-runnable until a reload. Set true in the effect, not only at creation: StrictMode mounts,
  // unmounts and mounts again, and a switch closes the dialog and opens it again for the next one.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const resolve = resolverRef.current
      resolverRef.current = null
      resolve?.(false)
      const resolveAsk = askResolverRef.current
      askResolverRef.current = null
      resolveAsk?.(false)
      setInfo(null)
      setAsk(null)
    }
  }, [workflowId])

  const settleAsk = useCallback((v: boolean) => {
    const resolve = askResolverRef.current
    askResolverRef.current = null
    setAsk(null)
    resolve?.(v)
  }, [])

  const askConfirm = useCallback((next: AskConfirmInfo): Promise<boolean> => {
    if (!aliveRef.current || askResolverRef.current || resolverRef.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      askResolverRef.current = resolve
      setAsk(next)
    })
  }, [])

  const settle = useCallback((v: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setInfo(null)
    resolve?.(v)
  }, [])

  const confirmRun = useCallback((next: RunConfirmInfo): Promise<boolean> => {
    // Single-flight: a confirm is already pending → don't open a second dialog
    // or overwrite the resolver (which would leak the first promise forever).
    // Asked after the editor went: answered "no" (above).
    if (!aliveRef.current || resolverRef.current || askResolverRef.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setInfo(next)
    })
  }, [])

  const open = info !== null
  const { title, body, action } = runConfirmText(info, t)

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false) }}>
      <AlertDialogContent className={INSPECTOR_CHILD_DIALOG_Z} overlayClassName={INSPECTOR_CHILD_DIALOG_Z}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
          {info?.priceNotes?.map((note) => (
            <p key={note} className="text-xs text-muted-foreground" data-testid="run-confirm-price-note">{note}</p>
          ))}
        </AlertDialogHeader>
        {info && <RunConfirmBreakdown info={info} />}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus onClick={() => settle(false)}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className="bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const askDialog = (
    <AlertDialog open={ask !== null} onOpenChange={(o) => { if (!o) settleAsk(false) }}>
      <AlertDialogContent className={INSPECTOR_CHILD_DIALOG_Z} overlayClassName={INSPECTOR_CHILD_DIALOG_Z}>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          <AlertDialogDescription>{ask?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus onClick={() => settleAsk(false)}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settleAsk(true)}
            className="bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
          >
            {ask?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return {
    confirmRun,
    askConfirm,
    isConfirming: open || ask !== null,
    dialog: <>{dialog}{askDialog}</>,
  }
}
