"use client"

import { formatCreditUnits } from "@/lib/credit-units"
import { useT } from "@/lib/i18n"
import { ugcQuoteLineLabel } from "@/lib/ugc-copy"

/** A line as the route wrote it: its English label and credits, and the id the editor names it by. */
interface QuoteLine { readonly label: string; readonly credits: number; readonly key?: unknown; readonly n?: unknown; readonly seconds?: unknown }

/**
 * What UGC Clips' last run quoted for its clips — one line per clip, what is
 * expected, and what is held while they render, each line named in the
 * person's language by its id (lib/ugc-copy.ts) — read from saved data
 * defensively: a malformed quote is not shown (null), a malformed line is left
 * out. Hidden while the node runs again: the figures are the last run's. One
 * table for the node card and the node's panel.
 */
export function UgcClipsQuote({ quote, status }: { quote: unknown; status: unknown }) {
  const t = useT()
  const q = quote && typeof quote === "object" ? (quote as { lines?: unknown; expected?: unknown; ceiling?: unknown }) : undefined
  if (status === "running" || !q || typeof q.expected !== "number" || typeof q.ceiling !== "number") return null
  const lines = Array.isArray(q.lines)
    ? q.lines.filter((l): l is QuoteLine => typeof (l as QuoteLine | null)?.label === "string" && typeof (l as QuoteLine).credits === "number")
    : []
  const credits = (n: number) => formatCreditUnits(n, { label: t("credits.unitShort"), localized: true })
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-muted/30 p-2 text-[11px]" data-testid="ugc-clips-quote">
      {lines.map((line, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2">
          <span dir="auto" className="truncate">{ugcQuoteLineLabel(line)}</span>
          <span className="tabular-nums text-muted-foreground">{credits(line.credits)}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-2 border-t pt-0.5 font-medium">
        <span>{t("ugc.clips.expected")}</span>
        <span className="tabular-nums">{credits(q.expected)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
        <span>{t("ugc.clips.held")}</span>
        <span className="tabular-nums">{credits(q.ceiling)}</span>
      </div>
    </div>
  )
}
