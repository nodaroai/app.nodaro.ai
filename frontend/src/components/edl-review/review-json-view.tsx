"use client"

/**
 * The review's JSON tab (M9 of the inspectors design; R17 a makes it the Edit
 * Plan's old JSON tree once the entry points land): the cut as edited, or as
 * the plan made it, with Copy JSON.
 */
import { useState } from "react"
import { JsonTree, type JsonValue } from "@/components/ui/json-tree"
import { useT } from "@/lib/i18n"
import { cn, copyToClipboard } from "@/lib/utils"

export interface ReviewJsonViewProps {
  /** The edit as it stands (with the reviewer's pending changes). */
  readonly edited: unknown
  /** The plan as stored. */
  readonly planned: unknown
}

export function ReviewJsonView({ edited, planned }: ReviewJsonViewProps) {
  const t = useT()
  const [which, setWhich] = useState<"edited" | "planned">("edited")
  const value = which === "edited" ? edited : planned
  const option = (id: "edited" | "planned", label: string) => (
    <button
      type="button"
      aria-pressed={which === id}
      className={cn("rounded px-2 py-0.5 text-xs", which === id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
      onClick={() => setWhich(id)}
    >
      {label}
    </button>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div role="group" className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {option("edited", t("edlReview.asEdited"))}
          {option("planned", t("edlReview.asPlanned"))}
        </div>
        <button
          type="button"
          className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80"
          onClick={() => copyToClipboard(JSON.stringify(value, null, 2), t("node.dataCopied"))}
        >
          {t("cfgext.scrapeCopyJson")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="review-json">
        <JsonTree value={(value ?? null) as JsonValue} className="text-[11px]" />
      </div>
    </div>
  )
}
