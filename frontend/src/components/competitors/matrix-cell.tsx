"use client"

import { AlertTriangle, Clock } from "lucide-react"
import type { CompetitorSearchKind } from "@nodaro/shared"
import { useT, type MessageKey } from "@/lib/i18n"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"
import { cn } from "@/lib/utils"
import { brandHueStyle } from "./brand-colors"
import { barShare, type MatrixCell, type MatrixColumn } from "./platform-matrix"

const FAILED_KEY: Readonly<Record<CompetitorSearchKind, MessageKey>> = {
  own: "competitors.failedOwn",
  about: "competitors.failedAbout",
}
const FAILED_KEY_OWN: Readonly<Record<CompetitorSearchKind, MessageKey>> = {
  own: "competitors.failedOwnYou",
  about: "competitors.failedAboutYou",
}

/** Why a search on a platform failed, in the reader's words ("your" for their own brand). */
export function failedLine(failed: readonly CompetitorSearchKind[], isOwn: boolean, t: ReturnType<typeof useT>): string {
  const keys = isOwn ? FAILED_KEY_OWN : FAILED_KEY
  return failed.map((kind) => t(keys[kind])).join(t("common.fragmentGap"))
}

/** One brand on one platform in the "Who is where" table. */
export function MatrixCellView({
  cell,
  column,
  hue,
  isOwn,
  selected,
}: {
  readonly cell: MatrixCell
  readonly column: MatrixColumn
  readonly hue: number | undefined
  /** The row is the person's own brand. */
  readonly isOwn: boolean
  /** Its column is the platform the page ranks by. */
  readonly selected: boolean
}) {
  const t = useT()
  const tint = selected ? "bg-primary/[0.04]" : ""
  if (cell.state === "loading") {
    return (
      <td className={cn("px-2.5 py-2.5", tint)}>
        <div className="h-4 w-12 animate-pulse rounded bg-muted" />
      </td>
    )
  }
  if (cell.state === "none" || cell.state === "pending") {
    const label = t(cell.state === "none" ? "competitors.notTrackedHere" : "competitors.cellPendingHint")
    return (
      <td className={cn("px-2.5 py-2.5", tint)}>
        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" title={label}>
          {/* A platform added since the last scan: read from the next one. */}
          {cell.state === "pending" && <Clock className="h-3 w-3" aria-hidden />}
          <span aria-hidden>—</span>
          <span className="sr-only">{label}</span>
        </span>
      </td>
    )
  }
  const why = failedLine(cell.failed, isOwn, t)
  if (cell.state === "failed") {
    return (
      <td className={cn("px-2.5 py-2.5", tint)}>
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-amber-700 dark:text-amber-400" title={why}>
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {t("competitors.cellFailed")}
          <span className="sr-only">{why}</span>
        </span>
      </td>
    )
  }
  const share = barShare(cell, column)
  const aboutOnly = !cell.reads.own && cell.reads.about
  const main = <span className="text-[16px] font-semibold tabular-nums text-foreground">{aboutOnly ? cell.about : cell.own}</span>
  // The column's bars measure one count; a cell that does not read it gets no bar (an empty one would read as zero).
  const measured = column.measure === "own" ? cell.reads.own : cell.reads.about
  return (
    <td className={cn("px-2.5 py-2.5", tint)}>
      <div className="flex flex-col justify-center gap-[5px]">
        <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          {aboutOnly ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {interpolateNodes(t(cell.about === 1 ? "competitors.cellAboutOnlyCountOne" : "competitors.cellAboutOnlyCount"), { n: main })}
            </span>
          ) : (
            <>
              {main}
              {cell.reads.about && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {t(cell.about === 1 ? "competitors.cellAboutOne" : "competitors.cellAbout", { n: cell.about })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex min-h-1 items-center gap-1.5">
          {measured && (
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", hue === undefined ? "bg-muted-foreground" : "brand-swatch")}
                style={{ ...brandHueStyle(hue), width: `${Math.round(share * 100)}%` }}
              />
            </div>
          )}
          {cell.state === "partial" && (
            <span className="shrink-0 text-amber-700 dark:text-amber-400" title={why}>
              <AlertTriangle className="h-3 w-3" aria-hidden />
              <span className="sr-only">{why}</span>
            </span>
          )}
        </div>
      </div>
    </td>
  )
}
