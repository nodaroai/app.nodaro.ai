// Admin → Settings → Content rights → Imports with a declaration: how many
// imports of a link started in a window, and how many carried a confirmation
// of the declaration (migration 597; /v1/admin/content-rights/import-share).
// What an administrator reads before turning the requirement on: each import
// started without one would then be refused. Counts only, never a link, a site
// or an account. Counting began when the count was deployed: a window reaching
// back past that starts there, and the card says so.

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

/** One count of the server's answer: imports of one lane, way in and app, with or without a confirmation. */
export interface ImportShareRow {
  /** `checkbox` (ticked), `derived` (from a standing authorization), or `none` (no confirmation). */
  declaration: string
  /** Where an import without a confirmation was made; null for the ones that carried one. */
  lane: string | null
  via: string | null
  appId: string | null
  imports: number
}

export interface ImportShare {
  rows: ImportShareRow[]
  /** When counting began, when that is inside the window: the figures start there. */
  countingSince: string | null
}

export interface ImportShareGroup {
  via: string | null
  lane: string
  appId: string | null
  imports: number
}

export interface ImportShareSummary {
  total: number
  withDeclaration: number
  without: number
  /** The imports without a declaration, by way in, lane and app, the most first. */
  groups: ImportShareGroup[]
}

export const IMPORT_SHARE_WINDOWS = [7, 30, 90] as const

const WAY_IN: Readonly<Record<string, string>> = {
  session: "A signed-in person",
  api: "An API key",
  app: "A connected app",
  mcp: "An agent (MCP)",
}

const WHERE: Readonly<Record<string, string>> = {
  route: "A direct request",
  run: "A workflow run",
  mcp: "An agent's inputs",
  admin: "An administrator",
  plugin: "A plugin's download",
}

export const wayInLabel = (via: string | null): string => (via === null ? "None (a step of the server)" : WAY_IN[via] ?? via)
export const whereLabel = (lane: string): string => WHERE[lane] ?? lane

/** The window's totals, and the imports without a declaration grouped by way in, lane and app. */
export function summarizeImportShare(rows: readonly ImportShareRow[]): ImportShareSummary {
  const total = rows.reduce((sum, r) => sum + r.imports, 0)
  const unconfirmed = rows.filter((r) => r.declaration === "none")
  const without = unconfirmed.reduce((sum, r) => sum + r.imports, 0)
  const byGroup = new Map<string, ImportShareGroup>()
  for (const r of unconfirmed) {
    const lane = r.lane ?? "unknown"
    const key = JSON.stringify([r.via, lane, r.appId])
    byGroup.set(key, { via: r.via, lane, appId: r.appId, imports: (byGroup.get(key)?.imports ?? 0) + r.imports })
  }
  const groups = [...byGroup.values()].sort((a, b) => b.imports - a.imports)
  return { total, withDeclaration: total - without, without, groups }
}

/** The share that carried one, rounded down: never "100%" while one import did not. */
export const sharePercent = (part: number, total: number): number => Math.floor((part / total) * 100)

/** A day as the admin screens write it, in UTC: "2 November 2026". */
export const countingDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  return typeof body?.error?.message === "string" ? body.error.message : fallback
}

function useImportShare(days: number) {
  return useQuery({
    queryKey: queryKeys.admin.importShare(days),
    queryFn: async (): Promise<ImportShare> => {
      const res = await fetch(`/v1/admin/content-rights/import-share?days=${days}`, { headers: await getAuthHeaders() })
      if (!res.ok) throw new Error(await failureMessage(res, "Failed to load the import counts"))
      const body = (await res.json()) as { data: ImportShareRow[]; countingSince?: string | null }
      return { rows: body.data, countingSince: body.countingSince ?? null }
    },
    // The admin settings page is already behind the admin gate; nothing else renders this card.
    staleTime: 60_000,
  })
}

export function ImportShareCard() {
  const [days, setDays] = useState<number>(IMPORT_SHARE_WINDOWS[0])
  const { data, isLoading, error } = useImportShare(days)
  const summary = data ? summarizeImportShare(data.rows) : null

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Imports with a declaration</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            How many imports of a link started in this window, and how many carried a confirmation of the
            declaration. With the requirement on, each import started without one would have been refused.
            Counts only: no link, site or account is shown.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[150px]" aria-label="Time window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_SHARE_WINDOWS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                Last {d} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div role="status">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">{error.message}</p>
      ) : (
        <>
          {data?.countingSince && (
            <p className="text-xs text-muted-foreground">
              Counting began on {countingDay(data.countingSince)}: imports before that day are not in these figures.
            </p>
          )}
          {!summary || summary.total === 0 ? (
            <p className="text-sm text-muted-foreground">No imports in the last {days} days.</p>
          ) : (
            <>
              <div>
                <p className="text-sm">
                  <span className="font-medium">{summary.without}</span> started without a declaration
                </p>
                <p className="text-xs text-muted-foreground">
                  {summary.withDeclaration} of {summary.total} carried one ({sharePercent(summary.withDeclaration, summary.total)}%)
                </p>
              </div>
              {summary.groups.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Imports without a declaration, by way in</caption>
                    <thead>
                      <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="text-start font-medium px-2 py-2">Way in</th>
                        <th className="text-start font-medium px-2 py-2">Where</th>
                        <th className="text-start font-medium px-2 py-2">Connected app</th>
                        <th className="text-end font-medium px-2 py-2">Without a declaration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.groups.map((g) => (
                        <tr key={JSON.stringify([g.via, g.lane, g.appId])} className="border-b last:border-b-0">
                          <td className="px-2 py-2">{wayInLabel(g.via)}</td>
                          <td className="px-2 py-2">{whereLabel(g.lane)}</td>
                          <td className="px-2 py-2 text-muted-foreground">{g.appId ?? "—"}</td>
                          <td className="px-2 py-2 text-end tabular-nums">{g.imports}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
