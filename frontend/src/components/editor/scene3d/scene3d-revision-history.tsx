"use client"

import { Check, History, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { Scene3DRevisionEntry } from "@/types/nodes"
import { useT, type TFunction } from "@/lib/i18n"

/**
 * The two revision-state blocks the v1 and v2 panels share verbatim.
 *
 * Revision history and the stale-completion notice are properties of the NODE,
 * not of a schema version: both panels hold the same `sceneHistory` and the
 * same "a job finished while you were editing" race. They were extracted the
 * moment there were two panels rather than copied, because a copy is how the
 * read-only rules below (history stays readable, only the mutating control
 * disappears) drift apart between versions.
 */

/** Localized label for a revision with no summary of its own. */
const SOURCE_LABEL_KEYS: Record<Scene3DRevisionEntry["source"], Parameters<TFunction>[0]> = {
  generate: "cfgext.scene3dSourceGenerate",
  edit: "cfgext.scene3dSourceEdit",
  manual: "cfgext.scene3dSourceManual",
  upstream: "cfgext.scene3dSourceUpstream",
}

export function Scene3DPendingRevisionNotice({
  readOnly,
  onResolve,
}: {
  readOnly: boolean
  onResolve: (adopt: boolean) => void
}) {
  const t = useT()
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 flex flex-col gap-1.5">
      <p className="text-[11px] text-amber-500">{t("cfgext.scene3dPendingRevision")}</p>
      {/* A read-only viewer is TOLD a newer revision arrived — resolving it
          is the owner's decision, made where the state lives. */}
      {!readOnly && (
        <div className="flex gap-1.5">
          <Button type="button" size="sm" className="h-6 text-[11px]" onClick={() => onResolve(true)}>
            <Check className="w-3 h-3 mr-1" /> {t("cfgext.scene3dUsePending")}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => onResolve(false)}>
            <X className="w-3 h-3 mr-1" /> {t("cfgext.scene3dKeepMine")}
          </Button>
        </div>
      )}
    </div>
  )
}

export function Scene3DRevisionHistory({
  history,
  activeRevisionId,
  readOnly,
  onRestore,
}: {
  history: Scene3DRevisionEntry[]
  activeRevisionId?: string
  readOnly: boolean
  onRestore: (revisionId: string) => void
}) {
  const t = useT()
  if (history.length <= 1) return null
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <History className="w-3 h-3" />
          <span>{t("cfgext.scene3dRevisionCount", { count: history.length })}</span>
        </div>
        <div className="max-h-32 overflow-y-auto flex flex-col gap-0.5">
          {[...history].reverse().map((entry) => (
            <div key={entry.revisionId} className="flex items-center gap-1.5 text-[11px] px-1.5 py-0.5">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {entry.revisionId.slice(0, 6)}
              </span>
              <span className="truncate flex-1 text-muted-foreground">
                {entry.changeSummary ?? t(SOURCE_LABEL_KEYS[entry.source])}
              </span>
              {entry.revisionId === activeRevisionId ? (
                <span className="text-[9px] text-[#ff0073] shrink-0">{t("cfgext.scene3dActiveRevision")}</span>
              ) : (
                // The history stays READABLE read-only — only the restore
                // control, which would rewrite the parent's state, is gone.
                !readOnly && (
                  <button
                    type="button"
                    aria-label={`Restore revision ${entry.revisionId.slice(0, 6)}`}
                    title={entry.context?.prompt}
                    className="text-muted-foreground/60 hover:text-foreground shrink-0"
                    onClick={() => onRestore(entry.revisionId)}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
