import { useState } from "react"
import { Button } from "@/components/ui/button"
import { countText, dayText, durationText, momentText, pageAddress, perUser } from "./format"
import { LineChart } from "./line-chart"
import { FilterInput, RowsFooter, SectionProblem, SectionShell, StatCard } from "./parts"
import type { SectionResult, SiteAnalyticsDays, TrafficReport, TrafficRow } from "./types"

type Grouping = "pages" | "titles"
const ROWS_SHOWN = 25

/** Google Analytics: views, people and time on the site, by page or by page title (GA's own grouping). */
export function TrafficSection({
  result,
  days,
  email,
  siteDomain,
}: {
  result: SectionResult<TrafficReport>
  days: SiteAnalyticsDays
  email: string | null
  /** Only pages on this domain become links: anyone can send GA hits under another site's name. */
  siteDomain: string | null
}) {
  const range = `Last ${days} days, ending yesterday`
  return (
    <SectionShell title="Traffic · Google Analytics" subtitle={result.status === "ok" ? `${range} · updated ${momentText(result.fetchedAt)}` : range}>
      {result.status === "ok" ? <TrafficBody report={result.data} siteDomain={siteDomain} /> : <SectionProblem result={result} product="Analytics" email={email} />}
    </SectionShell>
  )
}

function PageCell({ row, grouping, siteDomain }: { row: TrafficRow; grouping: Grouping; siteDomain: string | null }) {
  const address = grouping === "pages" ? pageAddress(row, siteDomain) : null
  if (!address) {
    return grouping === "pages" && row.host ? (
      <span className="break-all">
        <span className="text-muted-foreground">{row.host}</span>
        {row.path}
      </span>
    ) : (
      <span>{row.key || "(not set)"}</span>
    )
  }
  return (
    <a href={address} target="_blank" rel="noopener noreferrer" className="hover:underline break-all">
      <span className="text-muted-foreground">{row.host}</span>
      {row.path}
    </a>
  )
}

function TrafficBody({ report, siteDomain }: { report: TrafficReport; siteDomain: string | null }) {
  const [grouping, setGrouping] = useState<Grouping>("pages")
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState(false)
  const { totals, daily } = report
  const needle = filter.trim().toLowerCase()
  const all = grouping === "pages" ? report.pages : report.titles
  const allTotal = grouping === "pages" ? report.pagesTotal : report.titlesTotal
  const rows = all.filter((row) => row.key.toLowerCase().includes(needle))
  const shown = expanded ? rows : rows.slice(0, ROWS_SHOWN)
  const capNote = allTotal > all.length ? `Google sent its busiest ${countText(all.length)} of ${countText(allTotal)}` : undefined

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Views" value={countText(totals.views)} />
        <StatCard label="Active users" value={countText(totals.activeUsers)} />
        <StatCard label="Engagement per user" value={durationText(perUser(totals.engagementSeconds, totals.activeUsers))} hint="Average time engaged" />
        <StatCard label="Events" value={countText(totals.events)} />
      </div>

      <LineChart
        ariaLabel="Views and active users per day"
        labels={daily.map((d) => dayText(d.date))}
        series={[
          { label: "Views", values: daily.map((d) => d.views), className: "text-primary" },
          { label: "Active users", values: daily.map((d) => d.activeUsers), className: "text-sky-500" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={grouping === "pages" ? "default" : "outline"} onClick={() => setGrouping("pages")}>
          Pages
        </Button>
        <Button size="sm" variant={grouping === "titles" ? "default" : "outline"} onClick={() => setGrouping("titles")}>
          Page titles
        </Button>
        <FilterInput value={filter} onChange={setFilter} placeholder={grouping === "pages" ? "Filter pages…" : "Filter titles…"} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-start py-2 font-medium">{grouping === "pages" ? "Page" : "Page title"}</th>
              <th className="text-end py-2 font-medium">Views</th>
              <th className="text-end py-2 font-medium">Active users</th>
              <th className="text-end py-2 font-medium">Views per user</th>
              <th className="text-end py-2 font-medium">Engagement per user</th>
              <th className="text-end py-2 font-medium">Events</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-b border-border/50 align-top">
                <td className="py-1.5 pe-3">
                  <PageCell row={row} grouping={grouping} siteDomain={siteDomain} />
                </td>
                <td className="py-1.5 text-end font-mono">{countText(row.views)}</td>
                <td className="py-1.5 text-end font-mono">{countText(row.activeUsers)}</td>
                <td className="py-1.5 text-end font-mono">{perUser(row.views, row.activeUsers).toFixed(2)}</td>
                <td className="py-1.5 text-end font-mono">{durationText(perUser(row.engagementSeconds, row.activeUsers))}</td>
                <td className="py-1.5 text-end font-mono">{countText(row.events)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  {needle ? "Nothing matches the filter." : "No views in this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RowsFooter shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} note={capNote} />
    </div>
  )
}
