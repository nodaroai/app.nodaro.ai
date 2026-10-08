import { useState } from "react"
import { Button } from "@/components/ui/button"
import { httpLink } from "@/lib/post-site"
import { countText, dayText, momentText, percentText, positionText } from "./format"
import { IndexStatusCell } from "./index-status-cell"
import { LineChart } from "./line-chart"
import { FilterInput, NUMBER_CELL, NUMBER_HEAD, RowsFooter, SectionProblem, SectionShell, StatCard } from "./parts"
import type { SearchReport, SearchRow, SectionResult, SitemapStatus } from "./types"

type Tab = "pages" | "queries"
const ROWS_SHOWN = 25

/** Search Console: how the site shows up in Google search, which searches bring people, and whether pages are indexed. */
export function SearchSection({ result, email }: { result: SectionResult<SearchReport>; email: string | null }) {
  const subtitle =
    result.status === "ok"
      ? `${dayText(result.data.window.startDate)} – ${dayText(result.data.window.endDate)} (Pacific time) · Google is still settling the last 2–3 days · updated ${momentText(result.fetchedAt)}`
      : undefined
  return (
    <SectionShell title="Google Search · Search Console" subtitle={subtitle}>
      {result.status === "ok" ? <SearchBody report={result.data} /> : <SectionProblem result={result} product="Search Console" email={email} />}
    </SectionShell>
  )
}

/** A link only to an http(s) address — the text alone otherwise. */
function MaybeLink({ href, text }: { href: string | null; text: string }) {
  if (!href) return <>{text}</>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {text}
    </a>
  )
}

function Numbers({ row }: { row: SearchRow }) {
  return (
    <>
      <td className={NUMBER_CELL}>{countText(row.clicks)}</td>
      <td className={NUMBER_CELL}>{countText(row.impressions)}</td>
      <td className={NUMBER_CELL}>{percentText(row.ctr)}</td>
      <td className={NUMBER_CELL}>{positionText(row.position)}</td>
    </>
  )
}

function SearchBody({ report }: { report: SearchReport }) {
  const [tab, setTab] = useState<Tab>("pages")
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState(false)
  const { totals, daily } = report
  const needle = filter.trim().toLowerCase()
  const all = tab === "pages" ? report.pages : report.queries
  const capped = tab === "pages" ? report.pagesCapped : report.queriesCapped
  const rows = all.filter((row) => row.key.toLowerCase().includes(needle))
  const shown = expanded ? rows : rows.slice(0, ROWS_SHOWN)
  const capNote = capped ? `Google sent its top ${countText(all.length)}` : undefined

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Clicks" value={countText(totals.clicks)} />
        <StatCard label="Impressions" value={countText(totals.impressions)} hint="Times a page showed in results" />
        <StatCard label="Click-through rate" value={percentText(totals.ctr)} />
        <StatCard label="Average position" value={positionText(totals.position)} />
      </div>

      <LineChart
        ariaLabel="Clicks and impressions per day"
        labels={daily.map((d) => dayText(d.date))}
        series={[
          { label: "Clicks", values: daily.map((d) => d.clicks), className: "text-primary" },
          { label: "Impressions", values: daily.map((d) => d.impressions), className: "text-sky-500" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === "pages" ? "default" : "outline"} onClick={() => setTab("pages")}>
          Pages
        </Button>
        <Button size="sm" variant={tab === "queries" ? "default" : "outline"} onClick={() => setTab("queries")}>
          Searches
        </Button>
        <FilterInput value={filter} onChange={setFilter} placeholder={tab === "pages" ? "Filter pages…" : "Filter searches…"} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-start py-2 font-medium">{tab === "pages" ? "Page" : "Search"}</th>
              <th className={NUMBER_HEAD}>Clicks</th>
              <th className={NUMBER_HEAD}>Impressions</th>
              <th className={NUMBER_HEAD}>CTR</th>
              <th className={NUMBER_HEAD}>Position</th>
              {tab === "pages" && <th className={NUMBER_HEAD}>In Google’s index</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-b border-border/50 align-top">
                <td className="py-1.5 pe-3 break-all">
                  <MaybeLink href={tab === "pages" ? httpLink(row.key) : null} text={row.key} />
                </td>
                <Numbers row={row} />
                {tab === "pages" && (
                  <td className="py-1.5 ps-3">
                    <IndexStatusCell url={row.key} />
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={tab === "pages" ? 6 : 5} className="py-6 text-center text-muted-foreground">
                  {needle ? "Nothing matches the filter." : "No search data in this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RowsFooter shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} note={capNote} />

      {report.sitemaps === null ? (
        <p className="text-xs text-muted-foreground">Sitemaps unavailable: {report.sitemapsError ?? "Google could not list them."}</p>
      ) : (
        report.sitemaps.length > 0 && <Sitemaps sitemaps={report.sitemaps} />
      )}
    </div>
  )
}

function Sitemaps({ sitemaps }: { sitemaps: readonly SitemapStatus[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Sitemaps</h3>
      {sitemaps.map((sitemap) => (
        <div key={sitemap.path} className="border rounded-md p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="break-all font-mono text-xs">
            <MaybeLink href={httpLink(sitemap.path)} text={sitemap.path} />
          </span>
          <span className="text-xs text-muted-foreground">
            {sitemap.contents.map((c) => `${countText(c.submitted)} ${c.type}`).join(" · ") || "Nothing listed"}
            {sitemap.lastDownloaded ? ` · read by Google ${momentText(sitemap.lastDownloaded)}` : " · not read yet"}
            {sitemap.isPending ? " · pending" : ""}
          </span>
          {(sitemap.errors > 0 || sitemap.warnings > 0) && (
            <span className="text-xs text-destructive">
              {sitemap.errors} errors · {sitemap.warnings} warnings
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
