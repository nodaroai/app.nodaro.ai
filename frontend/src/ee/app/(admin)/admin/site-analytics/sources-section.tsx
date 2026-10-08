import { useState } from "react"
import { Button } from "@/components/ui/button"
import { countText, momentText, percentText } from "./format"
import { FilterInput, NUMBER_CELL, NUMBER_HEAD, RowsFooter, SectionProblem, SectionShell } from "./parts"
import type { SectionResult, SiteAnalyticsDays, SourceRow, SourceTable, SourcesReport } from "./types"

type Tab = keyof SourcesReport

/** GA's placeholders — "(not set)", "(direct)", "(organic)"… — in parentheses, or nothing at all. */
const isPlaceholder = (label: string) => label === "" || /^\(.*\)$/.test(label)

/**
 * A visit that arrived with UTM tags. A link without tags still gets a
 * manual source and medium — GA fills them from what it detected ("google",
 * "organic") — but then the campaign names the channel: "(organic)",
 * "(referral)", "(ai-assistant)". A tagged link that left the campaign out
 * gets "(not set)" there instead ("extension" / "card-character-open").
 * Labels: source, medium, campaign, content, term.
 */
export function hasUtmTags(row: SourceRow): boolean {
  const campaign = row.labels[2] ?? ""
  const campaignByGa = isPlaceholder(campaign) && campaign !== "" && campaign !== "(not set)"
  return !campaignByGa && row.labels.some((label) => !isPlaceholder(label))
}

/** A switch that narrows a table to the rows that say where the visit came from. */
interface Narrowing {
  label: string
  /** What an empty narrowed table says. */
  empty: string
  /** On when the tab opens. */
  on: boolean
  keeps: (row: SourceRow) => boolean
}

export const SOURCE_TABS: ReadonlyArray<{ id: Tab; label: string; columns: readonly string[]; narrowing?: Narrowing }> = [
  { id: "channels", label: "Channels", columns: ["Channel"] },
  {
    id: "sourceMedium",
    label: "Source / medium",
    columns: ["Source", "Medium"],
    narrowing: {
      label: "Hide direct and unknown",
      empty: "Every visit in this range was direct or unknown.",
      on: false,
      keeps: (row) => row.labels.some((label) => !isPlaceholder(label)),
    },
  },
  {
    id: "campaigns",
    label: "Campaigns",
    columns: ["Campaign"],
    narrowing: { label: "Named campaigns only", empty: "No visits from a named campaign in this range.", on: true, keeps: (row) => !isPlaceholder(row.labels[0] ?? "") },
  },
  {
    id: "utm",
    label: "UTM",
    columns: ["Source", "Medium", "Campaign", "Content", "Term"],
    narrowing: { label: "Tagged visits only", empty: "No visits with UTM tags in this range.", on: true, keeps: hasUtmTags },
  },
  { id: "landingPages", label: "Landing pages", columns: ["Landing page (path, every site)"] },
]
const ROWS_SHOWN = 25

/** Where visits came from: channel, source and medium, campaign and every UTM field, and the path they landed on. */
export function SourcesSection({ result, days, email }: { result: SectionResult<SourcesReport>; days: SiteAnalyticsDays; email: string | null }) {
  const range = `Last ${days} days, ending yesterday`
  return (
    <SectionShell title="Traffic sources · Google Analytics" subtitle={result.status === "ok" ? `${range} · updated ${momentText(result.fetchedAt)}` : range}>
      {result.status === "ok" ? <SourcesBody report={result.data} /> : <SectionProblem result={result} product="Analytics" email={email} />}
    </SectionShell>
  )
}

function SourcesBody({ report }: { report: SourcesReport }) {
  const [tabId, setTabId] = useState<Tab>("channels")
  const tab = SOURCE_TABS.find((t) => t.id === tabId) ?? SOURCE_TABS[0]!
  const [narrowed, setNarrowed] = useState(tab.narrowing?.on ?? false)
  const [filter, setFilter] = useState("")
  const table = report[tab.id]
  // The switch only where it would hide something.
  const narrowing = tab.narrowing && table.rows.some((row) => !tab.narrowing!.keeps(row)) ? tab.narrowing : undefined

  const choose = (id: Tab) => {
    setTabId(id)
    setNarrowed(SOURCE_TABS.find((t) => t.id === id)?.narrowing?.on ?? false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCE_TABS.map((t) => (
          <Button key={t.id} size="sm" variant={t.id === tab.id ? "default" : "outline"} onClick={() => choose(t.id)}>
            {t.label}
          </Button>
        ))}
        <FilterInput value={filter} onChange={setFilter} placeholder="Filter…" />
        {narrowing && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={narrowed} onChange={(e) => setNarrowed(e.target.checked)} />
            {narrowing.label}
          </label>
        )}
      </div>
      <SourcesTable key={tab.id} table={table} columns={tab.columns} narrowing={narrowed ? narrowing : undefined} filter={filter} />
    </div>
  )
}

function SourcesTable({ table, columns, narrowing, filter }: { table: SourceTable; columns: readonly string[]; narrowing: Narrowing | undefined; filter: string }) {
  const [expanded, setExpanded] = useState(false)
  const needle = filter.trim().toLowerCase()
  const rows = table.rows.filter((row) => (!narrowing || narrowing.keeps(row)) && row.labels.some((label) => label.toLowerCase().includes(needle)))
  const shown = expanded ? rows : rows.slice(0, ROWS_SHOWN)
  const capNote = table.total > table.rows.length ? `Google sent its top ${countText(table.rows.length)} of ${countText(table.total)}` : undefined

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b">
              {columns.map((column) => (
                <th key={column} className="text-start py-2 font-medium">
                  {column}
                </th>
              ))}
              <th className={NUMBER_HEAD}>Sessions</th>
              <th className={NUMBER_HEAD}>Users</th>
              <th className={NUMBER_HEAD}>New users</th>
              <th className={NUMBER_HEAD}>Engagement rate</th>
              <th className={NUMBER_HEAD}>Key events</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={JSON.stringify(row.labels)} className="border-b border-border/50 align-top">
                {row.labels.map((label, i) => (
                  <td key={i} className={`py-1.5 pe-3 break-all ${isPlaceholder(label) ? "text-muted-foreground" : ""}`}>
                    {label || "(empty)"}
                  </td>
                ))}
                <td className={NUMBER_CELL}>{countText(row.sessions)}</td>
                <td className={NUMBER_CELL}>{countText(row.activeUsers)}</td>
                <td className={NUMBER_CELL}>{countText(row.newUsers)}</td>
                <td className={NUMBER_CELL}>{percentText(row.engagementRate)}</td>
                <td className={NUMBER_CELL}>{countText(row.keyEvents)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length + 5} className="py-6 text-center text-muted-foreground">
                  {needle ? "Nothing matches the filter." : (narrowing?.empty ?? "No visits in this range.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RowsFooter shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} note={capNote} />
    </>
  )
}
