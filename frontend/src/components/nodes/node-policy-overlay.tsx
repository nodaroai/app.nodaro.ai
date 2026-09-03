"use client"

import { Clock, ShieldAlert } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import type { JobErrorHint } from "@/types/nodes"

/**
 * The ONE renderer of the two job-policy outcomes — a job held in
 * `pending_review`, and a job blocked by a Nodaro policy at either hook point.
 * Mounted once by `BaseNode`, so it is live on all 98 node cards.
 *
 * Why not a prop on each card: `jobRecovering` was added for exactly this and
 * is passed by 1 of 98 `<NodeJobProgress>` call sites, so "Recovering…" has
 * never reached a user. A store-reading overlay inside BaseNode cannot be
 * forgotten by node card #99.
 *
 * Reads its own slice by node id (BaseNode already does the same at
 * base-node.tsx:244), so it costs one shallow selector and re-renders only on
 * its own node's flags.
 */
export function NodePolicyOverlay({ nodeId }: { readonly nodeId: string }) {
  const t = useT()
  const { awaiting, hint, failed } = useWorkflowStore(
    useShallow((s: { nodes: Array<{ id: string; data?: unknown }> }) => {
      const d = s.nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined
      return {
        // STALENESS GUARD (a). An approve goes pending_review -> completed with
        // NO intervening poll tick, so no branch is re-entered that would clear
        // the flag. Gating on liveness means a stale flag can never cover a
        // delivered result. (Guard (b) — `jobAwaitingReview: undefined` on every
        // terminal patch — is the other half; both are required.)
        awaiting: d?.jobAwaitingReview === true && d?.executionStatus === "running",
        hint: d?.errorHint as JobErrorHint | undefined,
        failed: d?.executionStatus === "failed",
      }
    }),
  )

  if (awaiting) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 px-3 text-center rounded-xl border-2 border-amber-500/60 bg-amber-950/70 backdrop-blur-[2px]">
        <Clock className="w-6 h-6 text-amber-300" />
        <span className="text-xs font-semibold text-amber-100">{t("node.review.awaiting")}</span>
        <span className="text-[11px] leading-snug text-amber-200/80">{t("node.review.desc")}</span>
        <span className="text-[10px] text-amber-200/60">{t("node.review.creditsHeld")}</span>
      </div>
    )
  }

  // A PROVIDER safety block keeps its existing per-card treatment (the amber
  // block with the "Try on <model>" fallback). Only OUR verdict lands here —
  // there is no other provider to try.
  if (failed && hint?.kind === "policy-block") {
    return (
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 px-3 text-center rounded-xl border-2 border-amber-500/60 bg-amber-950/80 backdrop-blur-sm">
        <ShieldAlert className="w-6 h-6 text-amber-300" />
        <span className="text-xs font-semibold text-amber-100">{t("node.policyBlock.title")}</span>
        <span className="text-[11px] leading-snug text-amber-200/80 line-clamp-3" title={hint.reason || undefined}>
          {hint.reason ||
            (hint.hookPoint === "result"
              ? t("node.policyBlock.outputWithheld")
              : t("node.policyBlock.desc"))}
        </span>
      </div>
    )
  }

  return null
}
