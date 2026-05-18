"use client"

import type { PipelineDriftSummary } from "@nodaro/shared"
import { Button } from "@/components/ui/button"

interface Props {
  readonly drift: PipelineDriftSummary | null
  readonly onFork?: () => void
  readonly onDismiss?: () => void
}

/**
 * Phase 1B.4 — yellow/amber drift banner shown when the engine emits a
 * `pipeline:drift` event (Section H). The shared schema carries a narrower
 * shape than the plan's original template — `stageName` and a list of
 * `driftedEntityIds` plus an optional `summary` string. The banner renders
 * the summary verbatim when present, or a generic fallback otherwise, plus a
 * count of drifted entities.
 *
 * The only recoverable action surfaced here is "Fork pipeline" — the engine
 * already pauses at the next checkpoint, so the user either resolves drift
 * by editing the canvas back into shape (in which case the next stage
 * boundary will clear it) or by hard-forking. "Dismiss" is local state only:
 * it hides the banner until the next `pipeline:drift` event arrives.
 */
export function DriftBanner({ drift, onFork, onDismiss }: Props) {
  if (!drift) return null
  const driftedCount = drift.driftedEntityIds.length
  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm space-y-2"
      data-testid="drift-banner"
      role="alert"
    >
      <div className="font-medium text-amber-900">
        Canvas drift detected at <span className="font-mono">{drift.stageName}</span>
        {driftedCount > 0 && (
          <span className="text-amber-700">
            {" — "}
            {driftedCount} affected entit{driftedCount === 1 ? "y" : "ies"}
          </span>
        )}
      </div>
      {drift.summary && (
        <div className="text-xs text-zinc-700 whitespace-pre-line">{drift.summary}</div>
      )}
      <div className="flex gap-2 pt-1">
        {onFork && (
          <Button size="sm" variant="destructive" onClick={onFork}>
            Fork pipeline
          </Button>
        )}
        {onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  )
}
