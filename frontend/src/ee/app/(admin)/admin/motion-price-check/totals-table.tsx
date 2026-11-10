/**
 * Admin → Motion price check: the totals over every filtered run of the
 * range, in the API's order: All, then each engine, resolution and style,
 * with the resolutions shown by number (480p, 720p, 1080p).
 * A group's figures sum its settled runs only (a run in flight counts in
 * "unsettled" alone), so a group with none reads "—". In its own scroll box
 * (`Scroll`), named by the section's heading, so a phone scrolls the table and
 * never the page, and a keyboard scrolls it too.
 */
import { cn } from "@/lib/utils"
import type { MotionPriceTotal } from "@/ee/lib/motion-price-check-api"
import { engineLabel, formatCount, formatCredits, formatPct, formatUsd, resolutionLabel, styleLabel } from "./format"
import { Scroll } from "./scroll-box"

const DIMENSIONS: Readonly<Record<Exclude<MotionPriceTotal["dimension"], "all">, string>> = {
  engine: "Engine",
  resolution: "Resolution",
  style: "Style",
}

function valueLabel(t: MotionPriceTotal): string {
  if (t.value === null) return "Unknown"
  if (t.dimension === "engine") return engineLabel(t.value)
  if (t.dimension === "style") return styleLabel(t.value)
  // A resolution's row holds every run made at it: at 480p, drafts and plain runs alike.
  if (t.dimension === "resolution") return resolutionLabel(t.value, false)
  return t.value
}

/** A resolution's number of lines ("720p" is 720); one that names none sorts after every one that does. */
function linesOf(value: string | null): number {
  const match = value === null ? null : /^(\d+)p$/.exec(value)
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

/**
 * The rows as shown: the API's order, except that the resolutions (which the
 * SQL orders as text, 1080p before 480p) read by number, in their own places.
 */
function displayOrder(totals: readonly MotionPriceTotal[]): MotionPriceTotal[] {
  const resolutions = [...totals.filter((t) => t.dimension === "resolution")].sort((a, b) => {
    const [la, lb] = [linesOf(a.value), linesOf(b.value)]
    return la === lb ? 0 : la < lb ? -1 : 1
  })
  let next = 0
  return totals.map((t) => (t.dimension === "resolution" ? resolutions[next++]! : t))
}

const HEAD = "whitespace-nowrap p-2 font-medium text-muted-foreground"
const FIGURE = "whitespace-nowrap p-2 text-end tabular-nums"
const below = (v: number | null): boolean => v !== null && v < 0

export function TotalsTable({ totals, labelledBy }: { totals: MotionPriceTotal[]; labelledBy: string }) {
  return (
    <Scroll labelledBy={labelledBy}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th scope="col" className={`${HEAD} text-start`}>
              Group
            </th>
            {["Runs (unsettled)", "Held", "Taken", "Taken $", "Paid $", "Margin $", "Margin %"].map((label) => (
              <th key={label} scope="col" className={`${HEAD} text-end`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayOrder(totals).map((t) => (
            <tr key={`${t.dimension}:${t.value ?? ""}`} className="border-b border-border/50 last:border-0">
              <th scope="row" className="whitespace-nowrap p-2 text-start font-medium">
                {t.dimension === "all" ? (
                  "All"
                ) : (
                  <>
                    <span className="font-normal text-muted-foreground">{DIMENSIONS[t.dimension]}</span> {valueLabel(t)}
                  </>
                )}
              </th>
              <td className={FIGURE}>{`${formatCount(t.runs)} (${formatCount(t.unsettled)})`}</td>
              <td className={FIGURE}>{formatCredits(t.held)}</td>
              <td className={FIGURE}>{formatCredits(t.taken)}</td>
              <td className={FIGURE}>{formatUsd(t.takenUsd)}</td>
              <td className={FIGURE}>{formatUsd(t.paidUsd)}</td>
              <td className={cn(FIGURE, below(t.marginUsd) && "text-red-600 dark:text-red-400")}>{formatUsd(t.marginUsd)}</td>
              <td className={cn(FIGURE, below(t.marginPct) && "text-red-600 dark:text-red-400")}>{formatPct(t.marginPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  )
}
