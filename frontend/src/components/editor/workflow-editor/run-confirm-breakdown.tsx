"use client"

/**
 * The per-node price in the Render final and Update preview confirms (U1,
 * R16 a, decided 2026-10-06; mockups M12–M16): one row per node the run
 * executes, the total of those same rows, what is kept as is, and what an
 * Update preview leaves for Render final. A non-credit edition lists the
 * nodes with no numbers. A confirm without lines (every other run) shows
 * only the sum of each macro group it touches above the total, or nothing.
 *
 * Node names are the stored English labels; they are localized here, the way
 * the canvas header shows them (a rename passes through), and "Kept as is"
 * groups its repeats only after translating.
 *
 * What a Render final or an Update preview holds back behind ANOTHER render
 * still set to Preview gets its own line, "Waits for its own Render final"
 * (round 2, decided 2026-10-06; Update preview decided 2026-10-06), never a
 * row: it does not run and is not billed now.
 *
 * The total stays in credits (round 2, decided 2026-10-06): it is
 * `sumRunCreditLines` — the whole-credit sum the run is gated and billed on —
 * converted to the display unit ONCE, here at the render boundary. It is never
 * the sum of the rows' converted figures. Rows and the total still add up on
 * screen: credits are whole numbers and a display unit must be lossless
 * (`unitRate × 10^decimals` an integer, rule H12), so each conversion is exact
 * and no figure rounds. Summing converted floats instead would print
 * 0.30000000000000004 under a valid unit, and would make the shown total a
 * second computation that could drift from the one the run is priced on. The
 * "+ n more" row follows the same rule: credits summed, then converted.
 */
import { useState } from "react"
import { creditUnits, creditUnitsApprox } from "@/lib/credit-units"
import { useT, type TFunction } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { groupedLabels } from "./render-confirm-detail"
import { runLinesUnpriced } from "./run-unpriced"
import type { RunConfirmInfo, RunConfirmLine } from "./types"

/** Up to this many rows show in full; past it, the first `FOLDED_SHOWN` and a "+ n more" row. */
const MAX_ROWS = 6
const FOLDED_SHOWN = 5

/** "final · ×6 · 12 min", "re-runs first", "×6" — empty when there is nothing to say. */
export function lineQuantity(line: RunConfirmLine, t: TFunction): string {
  const { fanOut, units, unitKind } = line.quantity
  const parts: string[] = []
  if (line.renderQuality) parts.push(t(line.renderQuality === "proxy" ? "renderFinal.linePreview" : "renderFinal.lineFinal"))
  if (fanOut > 1) parts.push(t("renderFinal.lineTimes", { n: fanOut }))
  if (unitKind === "minute") parts.push(t("renderFinal.lineMinutes", { n: fanOut * units }))
  if (line.rerunsFirst) parts.push(t("renderFinal.lineRerunsFirst"))
  return parts.join(t("renderFinal.lineJoin"))
}

/** A row of the table: a macro group's header with its summed credits, or one node's line. */
export type BreakdownRow =
  | { readonly kind: "group"; readonly id: string; readonly label: string; readonly credits: number }
  | { readonly kind: "line"; readonly line: RunConfirmLine; readonly indented: boolean }

/**
 * The lines as rows. The nodes of a macro group (Reframe) are gathered under a
 * header carrying their SUM (D5, decided 2026-10-11) — the lines themselves are
 * untouched, so the total below is still the sum of the very same figures.
 */
export function breakdownRows(lines: readonly RunConfirmLine[]): BreakdownRow[] {
  const rows: BreakdownRow[] = []
  const done = new Set<string>()
  for (const line of lines) {
    const group = line.group
    if (!group) {
      rows.push({ kind: "line", line, indented: false })
      continue
    }
    if (done.has(group.id)) continue
    done.add(group.id)
    const members = lines.filter((l) => l.group?.id === group.id)
    rows.push({ kind: "group", id: group.id, label: group.label, credits: members.reduce((sum, l) => sum + l.credits, 0) })
    for (const l of members) rows.push({ kind: "line", line: l, indented: true })
  }
  return rows
}

export function RunConfirmBreakdown({ info }: { readonly info: RunConfirmInfo }) {
  const t = useT()
  const localize = useLocalizeNodeLabel()
  const [expanded, setExpanded] = useState(false)
  const lines = info.lines
  if (!lines) {
    // Every other run (R8, decided 2026-10-12): no itemised table, but the sum of
    // each macro group the run touches sits above the run's total. No numbers on
    // a non-credit edition, so nothing at all there.
    if (!info.groups?.length || info.estimatedCredits === null) return null
    return (
      <div className="space-y-2 text-sm">
        <table className="w-full border-collapse">
          <tbody>
            {info.groups.map((group) => (
              <tr key={`group:${group.id}`} data-testid="run-confirm-group">
                <td className="py-0.5 pe-3 font-medium">{localize(group.label)}</td>
                <td className="py-0.5 pe-3 text-muted-foreground">{t("reframe.groupSum")}</td>
                <td className="py-0.5 text-end tabular-nums">{creditUnits(group.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between gap-3 border-t border-border pt-1 font-medium">
          <span>{t("renderFinal.lineTotal")}</span>
          <span className="tabular-nums">{t("renderFinal.lineTotalCredits", { credits: creditUnits(info.estimatedCredits) })}</span>
        </div>
      </div>
    )
  }
  const kept = groupedLabels((info.kept ?? []).map(localize))
  const gated = (info.gated ?? []).map(localize)
  const list = (names: readonly string[]) => names.join(t("common.listComma"))
  const keptLine = kept.length > 0 && (
    <p className="text-xs text-muted-foreground">{t("renderFinal.kept", { names: list(kept) })}</p>
  )
  const gatedLine = gated.length > 0 && (
    <p className="text-xs text-muted-foreground">{t("renderFinal.gated", { names: list(gated) })}</p>
  )
  const waits = (info.waits ?? []).map(localize)
  const waitsLine = waits.length > 0 && (
    <p className="text-xs text-muted-foreground">{t("renderFinal.waitsOwn", { names: list(waits) })}</p>
  )

  // A non-credit edition (M16): what runs, in order, with no numbers.
  if (info.estimatedCredits === null) {
    const runs = lines.map((line) => {
      const quantity = lineQuantity(line, t)
      const label = localize(line.label)
      return quantity ? t("common.qualified", { token: label, qualifier: quantity }) : label
    })
    return (
      <div className="space-y-1 text-sm">
        <p>{t("renderFinal.runs", { names: list(runs) })}</p>
        {gatedLine}
        {waitsLine}
        {keptLine}
      </div>
    )
  }

  const rows = breakdownRows(lines)
  // A node the server refuses to price (`llm_model_unpriced`): its row and the total say it is not
  // priced yet, the server's sentence on hover — never a figure that leaves it out.
  const unpriced = runLinesUnpriced(lines)
  const notPriced = t("renderFinal.priceNotPricedYet")
  const folded = !expanded && rows.length > MAX_ROWS
  const shown = folded ? rows.slice(0, FOLDED_SHOWN) : rows
  const rest = rows.slice(FOLDED_SHOWN).flatMap((r) => (r.kind === "line" ? [r.line] : []))
  return (
    <div className="space-y-2 text-sm">
      {/* The rows scroll on their own once "+ n more" opens them all: the
          dialog has no height cap, so a long run would push its title and its
          buttons off the screen. The total stays below the box, in view. */}
      <div data-testid="run-confirm-rows" className="max-h-[40vh] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {shown.map((row) =>
              row.kind === "group" ? (
                <tr key={`group:${row.id}`} data-testid="run-confirm-group">
                  <td className="py-0.5 pe-3 font-medium">{localize(row.label)}</td>
                  <td className="py-0.5 pe-3 text-muted-foreground">{t("reframe.groupSum")}</td>
                  <td className="py-0.5 text-end tabular-nums">{creditUnits(row.credits)}</td>
                </tr>
              ) : (
                <tr key={row.line.nodeId}>
                  <td className={`py-0.5 pe-3 ${row.indented ? "ps-4 text-muted-foreground" : "font-medium"}`}>{localize(row.line.label)}</td>
                  <td className="py-0.5 pe-3 text-muted-foreground">{lineQuantity(row.line, t)}</td>
                  {/* A metered LLM node's line is its estimate: `≈N`. */}
                  <td className="py-0.5 text-end tabular-nums" title={row.line.unpriced ? row.line.unpricedMessage : undefined}>
                    {row.line.unpriced ? notPriced : creditUnitsApprox(row.line.credits, row.line.estimate)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {folded && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setExpanded(true)}
        >
          {t("renderFinal.moreLines", {
            n: rest.length,
            credits: creditUnitsApprox(rest.reduce((sum, line) => sum + line.credits, 0), rest.some((line) => line.estimate === true)),
          })}
        </button>
      )}
      <div className="flex justify-between gap-3 border-t border-border pt-1 font-medium">
        <span>{t("renderFinal.lineTotal")}</span>
        <span className="tabular-nums" title={unpriced?.message}>
          {unpriced ? notPriced : t("renderFinal.lineTotalCredits", { credits: creditUnits(info.estimatedCredits) })}
        </span>
      </div>
      {gatedLine}
      {waitsLine}
      {keptLine}
    </div>
  )
}
