"use client"

/**
 * The per-node price in the Render final and Update preview confirms (U1,
 * R16 a, decided 2026-10-06; mockups M12–M16): one row per node the run
 * executes, the total of those same rows, what is kept as is, and what an
 * Update preview leaves for Render final. A non-credit edition lists the
 * nodes with no numbers. Renders nothing for a confirm without lines (every
 * other run).
 *
 * Node names are the stored English labels; they are localized here, the way
 * the canvas header shows them (a rename passes through), and "Kept as is"
 * groups its repeats only after translating.
 *
 * What a Render final holds back behind ANOTHER render still set to Preview
 * gets its own line, "Waits for its own Render final" (round 2, decided
 * 2026-10-06), never a row: it does not run and is not billed now.
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
import { creditUnits } from "@/lib/credit-units"
import { useT, type TFunction } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { groupedLabels } from "./render-confirm-detail"
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

export function RunConfirmBreakdown({ info }: { readonly info: RunConfirmInfo }) {
  const t = useT()
  const localize = useLocalizeNodeLabel()
  const [expanded, setExpanded] = useState(false)
  const lines = info.lines
  if (!lines) return null
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

  const folded = !expanded && lines.length > MAX_ROWS
  const shown = folded ? lines.slice(0, FOLDED_SHOWN) : lines
  const rest = lines.slice(FOLDED_SHOWN)
  return (
    <div className="space-y-2 text-sm">
      {/* The rows scroll on their own once "+ n more" opens them all: the
          dialog has no height cap, so a long run would push its title and its
          buttons off the screen. The total stays below the box, in view. */}
      <div data-testid="run-confirm-rows" className="max-h-[40vh] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {shown.map((line) => (
              <tr key={line.nodeId}>
                <td className="py-0.5 pe-3 font-medium">{localize(line.label)}</td>
                <td className="py-0.5 pe-3 text-muted-foreground">{lineQuantity(line, t)}</td>
                <td className="py-0.5 text-end tabular-nums">{creditUnits(line.credits)}</td>
              </tr>
            ))}
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
            credits: creditUnits(rest.reduce((sum, line) => sum + line.credits, 0)),
          })}
        </button>
      )}
      <div className="flex justify-between gap-3 border-t border-border pt-1 font-medium">
        <span>{t("renderFinal.lineTotal")}</span>
        <span className="tabular-nums">
          {t("renderFinal.lineTotalCredits", { credits: creditUnits(info.estimatedCredits) })}
        </span>
      </div>
      {gatedLine}
      {waitsLine}
      {keptLine}
    </div>
  )
}
