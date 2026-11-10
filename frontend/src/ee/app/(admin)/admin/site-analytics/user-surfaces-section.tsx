import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { countText, dateText, momentText } from "./format"
import { adminUserLink } from "./online-users-section"
import { FilterInput, NUMBER_CELL, NUMBER_HEAD, RowsFooter, SectionShell } from "./parts"
import type { SurfaceSource, UserSurfaceRow, UserSurfacesReport } from "./types"
import { useUserSurfaces } from "./use-site-analytics"

/** The kinds of caller, as the chips name them; "All" is the null choice. */
export const SURFACE_KINDS: ReadonlyArray<{ source: SurfaceSource; label: string }> = [
  { source: "web", label: "Web" },
  { source: "extension", label: "Extension" },
  { source: "mcp", label: "MCP" },
  { source: "app", label: "Apps" },
  { source: "api", label: "API" },
  { source: "cli", label: "CLI" },
  { source: "sdk", label: "SDK" },
]
const ROWS_SHOWN = 25

const peopleText = (n: number): string => (n === 1 ? "1 person" : `${countText(n)} people`)

/** Since when: the oldest sighting in the table, as nothing before the table existed was recorded. */
function subtitleOf(data: UserSurfacesReport | undefined): string {
  const since = data?.recordedSince ? `since ${dateText(data.recordedSince)}, when recording began` : "since recording began"
  const base = `Every surface each account has used ${since} — the latest first`
  if (!data?.truncated) return base
  return `${base} · the newest ${countText(data.rows.length)} rows of ${countText(data.total)}, people counted among them`
}

/** A row's own words, for the text box: name, email, id, kind, label, detail. */
const rowText = (row: UserSurfaceRow): string => [row.name, row.email, row.userId, row.source, row.label, row.detail].filter(Boolean).join(" ").toLowerCase()

/**
 * The surfaces each account has used — the app, the studio, the extension, an
 * MCP client… — kept for good, unlike "Signed in now" above, which forgets
 * after fifteen minutes. One row per account and surface. A kind of caller
 * narrows the list on the server; the text box narrows what came.
 */
export function UserSurfacesSection() {
  const [source, setSource] = useState<SurfaceSource | null>(null)
  const [filter, setFilter] = useState("")
  const { data, error, isLoading, isPlaceholderData } = useUserSurfaces(source)
  const count = data ? ` · ${peopleText(data.people)}` : ""

  return (
    <SectionShell title={`Surfaces used${count}`} subtitle={subtitleOf(data)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={source === null ? "default" : "outline"} onClick={() => setSource(null)}>
          All
        </Button>
        {SURFACE_KINDS.map((kind) => (
          <Button key={kind.source} size="sm" variant={source === kind.source ? "default" : "outline"} onClick={() => setSource(kind.source)}>
            {kind.label}
          </Button>
        ))}
        <FilterInput value={filter} onChange={setFilter} placeholder="Filter by name, email or surface…" />
        {isPlaceholderData && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>
      {isLoading && !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load the surfaces people use."}</p>
      ) : (
        // The last kind's rows stay on screen while the next loads: the table follows the data, not the chip.
        <SurfacesTable key={data.source ?? "all"} rows={data.rows} filter={filter} empty={data.source ? "Nobody has used this surface since recording began." : "Nothing recorded yet."} />
      )}
    </SectionShell>
  )
}

function SurfacesTable({ rows, filter, empty }: { rows: readonly UserSurfaceRow[]; filter: string; empty: string }) {
  const [expanded, setExpanded] = useState(false)
  const needle = filter.trim().toLowerCase()
  const kept = needle ? rows.filter((row) => rowText(row).includes(needle)) : rows
  const shown = expanded ? kept : kept.slice(0, ROWS_SHOWN)

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-start py-2 font-medium">Person</th>
              <th className="text-start py-2 font-medium">Surface</th>
              <th className="text-start py-2 font-medium">Detail</th>
              <th className="text-start py-2 font-medium whitespace-nowrap">First seen</th>
              <th className="text-start py-2 font-medium whitespace-nowrap">Last seen</th>
              <th className={NUMBER_HEAD}>Touches</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.userId}|${row.source}|${row.detail ?? ""}`} className="border-b border-border/50 align-top">
                <td className="py-1.5 pe-3">
                  <Link to={adminUserLink(row.userId)} className="font-medium hover:underline">
                    {row.name ?? row.email ?? row.userId}
                  </Link>
                  {row.name && row.email && <p className="text-xs text-muted-foreground">{row.email}</p>}
                </td>
                <td className="py-1.5 pe-3 whitespace-nowrap">
                  <span className="rounded border px-1.5 py-0.5 text-xs font-medium">{row.label}</span>
                </td>
                <td className="py-1.5 pe-3 font-mono text-xs break-all">{row.detail ?? "—"}</td>
                <td className="py-1.5 pe-3 whitespace-nowrap">{momentText(row.firstSeenAt)}</td>
                <td className="py-1.5 pe-3 whitespace-nowrap">{momentText(row.lastSeenAt)}</td>
                <td className={NUMBER_CELL} title="About one touch per hour the surface was in use">
                  {countText(row.touches)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  {needle ? "Nothing matches the filter." : empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RowsFooter shown={shown.length} total={kept.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </>
  )
}
