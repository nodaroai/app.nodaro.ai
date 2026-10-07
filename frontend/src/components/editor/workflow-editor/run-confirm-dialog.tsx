"use client"

import { useCallback, useRef, useState } from "react"
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
  const title = isRenderFinal
    ? credits != null
      ? t("renderFinal.confirmTitleCredits", { credits: creditUnits(credits) })
      : t("renderFinal.confirmTitle")
    : info?.trigger === "update-preview" && credits != null
      ? t("renderFinal.previewConfirmTitleCredits", { credits: creditUnits(credits) })
    : info?.alwaysConfirm
      ? t("editor.runConfirmEntireTitle")
      : t("editor.runConfirmCreditsTitle", { credits: creditUnits(credits ?? 0) })
  const body = !isRenderFinal && info?.alwaysConfirm && credits != null ? t("editor.runConfirmEstimated", { nodes: nodeLabel, credits: creditUnits(credits) }) : nodeLabel
  const action =
    info?.trigger === "render-final" ? t("renderFinal.action")
      : info?.trigger === "update-preview" ? t("renderFinal.updatePreview")
        : t("common.run")
  return { title, body, action }
}

/**
 * Run-confirmation gate dialog. The editor wires `confirmRun` onto the
 * `ExecutionContext`; the run handlers `await` it before any side effect.
 *
 * Both dialogs stack above an open inspector (`INSPECTOR_CHILD_DIALOG_Z`):
 * the review inspector's Render final and Update preview open them over it.
 */
export function useRunConfirm(): UseRunConfirm {
  const t = useT()
  const [info, setInfo] = useState<RunConfirmInfo | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)
  const [ask, setAsk] = useState<AskConfirmInfo | null>(null)
  const askResolverRef = useRef<((v: boolean) => void) | null>(null)

  const settleAsk = useCallback((v: boolean) => {
    const resolve = askResolverRef.current
    askResolverRef.current = null
    setAsk(null)
    resolve?.(v)
  }, [])

  const askConfirm = useCallback((next: AskConfirmInfo): Promise<boolean> => {
    if (askResolverRef.current || resolverRef.current) return Promise.resolve(false)
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
    if (resolverRef.current || askResolverRef.current) return Promise.resolve(false)
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
