import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { ENVIRONMENT_LOOK, NewTabLink } from "./product-card"
import { ACCENT_TEXT } from "./product-icon"
import { ENVIRONMENTS, newestVersion, upToDateCount } from "./site-face"
import type { HeaderVersionsReport } from "./types"

/**
 * The header itself on top — its name, its newest release, how many sites run
 * it — and the line down to every product below it. Colours come from the
 * theme: the accent is the brand colour pulled toward the text colour, so it
 * keeps its contrast in light, dark and the contrast modes.
 */

/** The gap between product cards; the connector's bar runs from the first card's centre to the last's. */
export const CARD_GAP_PX = 14

const checkedAt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })

const CHIP = "whitespace-nowrap rounded-lg border border-primary/25 bg-card px-3.5 py-1.5 text-[13px]"

function NewestRelease({ report }: { report: HeaderVersionsReport }) {
  const { latest } = report
  const big = "font-mono text-3xl font-semibold"
  if (latest.status === "ok") {
    return latest.version ? (
      <NewTabLink href={latest.tagsUrl} className={cn(big, "text-emerald-700 dark:text-emerald-400")}>
        {latest.version}
      </NewTabLink>
    ) : (
      <span className={cn(big, "text-muted-foreground")}>none tagged</span>
    )
  }
  if (latest.status === "error") return <span className={cn(big, "text-destructive")}>unknown</span>
  return <span className={cn(big, "text-muted-foreground")}>—</span>
}

export function ShellSummary({ report, refreshing, onRefresh }: { report: HeaderVersionsReport; refreshing: boolean; onRefresh: () => void }) {
  const { upToDate, total } = upToDateCount(report)
  const ranked = newestVersion(report) !== null && total > 0
  return (
    <div className="flex justify-center">
      <div className="relative w-full max-w-[620px] rounded-xl border-2 border-primary bg-primary/10 px-5 py-4 text-center">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="absolute end-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-card px-2.5 py-1 text-[13px] hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
          Refresh
        </button>
        <div className={cn("font-mono text-lg font-semibold", ACCENT_TEXT)}>{report.headerPackage ?? "Shared header"}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">Shared header version on every product</p>
        <div className="mt-3.5 flex items-baseline justify-center gap-2.5">
          <span className="text-sm text-muted-foreground">Newest release:</span>
          <NewestRelease report={report} />
        </div>
        {report.latest.status === "error" && <p className="mt-1 text-xs text-destructive">{report.latest.message}</p>}
        <div className="mt-3 flex flex-wrap justify-center gap-2.5">
          {ranked && (
            <div className={CHIP} data-testid="up-to-date">
              <b className="text-emerald-700 dark:text-emerald-400">{upToDate}</b> of {total} sites up to date
            </div>
          )}
          <div className={cn(CHIP, "text-muted-foreground")}>Checked {checkedAt(report.checkedAt)}</div>
        </div>
      </div>
    </div>
  )
}

/** The line from the header down to the bar over the cards; decoration only. */
export function Connector({ count }: { count: number }) {
  const inset = `calc((100% - ${(count - 1) * CARD_GAP_PX}px) / ${2 * count})`
  return (
    <div className="relative h-[29px]">
      <div aria-hidden className="absolute inset-x-0 top-0 mx-auto h-7 w-0.5 bg-primary" />
      <div className={cn("absolute start-[calc(50%+10px)] top-1.5 text-[13px]", ACCENT_TEXT)}>Each product installs a version and shows it</div>
      {count > 1 && <div aria-hidden className="absolute top-[27px] h-0.5 bg-primary" style={{ insetInline: inset }} />}
    </div>
  )
}

const LEGEND = [
  { label: "Newest", dot: "bg-emerald-500" },
  { label: "Behind", dot: "bg-amber-500" },
  { label: "Ahead", dot: "bg-sky-500" },
  { label: "Header off", dot: "bg-muted-foreground/40" },
  { label: "Unreadable", dot: "bg-destructive" },
] as const

export function Legend() {
  return (
    <ul aria-label="Legend" className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[12.5px] text-muted-foreground">
      {ENVIRONMENTS.map((environment) => {
        const { label, icon: Icon, frame } = ENVIRONMENT_LOOK[environment]
        return (
          <li key={environment} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-flex h-4 w-6 items-center justify-center rounded border", frame)}>
              <Icon className="h-2.5 w-2.5" />
            </span>
            {label} site
          </li>
        )
      })}
      {LEGEND.map(({ label, dot }, i) => (
        <li key={label} className={cn("flex items-center gap-1.5", i === 0 && "border-s ps-4")}>
          <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", dot)} />
          {label}
        </li>
      ))}
    </ul>
  )
}
