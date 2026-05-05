import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SortHeader } from "@/components/ui/sort-header"
import {
  useAdminUsageLogs,
  type SortDir,
  type UsageGroupBy,
  type UsageSortBy,
} from "@/ee/hooks/queries/use-admin-queries"

const GROUP_OPTIONS: ReadonlyArray<{ value: UsageGroupBy; label: string }> = [
  { value: "none", label: "No grouping (each row)" },
  { value: "user", label: "By user" },
  { value: "action", label: "By action" },
  { value: "day", label: "By day" },
  { value: "user-action", label: "By user + action" },
  { value: "user-day", label: "By user + day" },
  { value: "action-day", label: "By action + day" },
]

export default function AdminUsagePage() {
  const [page, setPage] = useState(0)
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("none")
  const [sortBy, setSortBy] = useState<UsageSortBy>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const { data: logs = [], isLoading: loading } = useAdminUsageLogs(
    page,
    50,
    groupBy,
    sortBy,
    sortDir,
  )

  const isGrouped = groupBy !== "none"
  const showUser = groupBy === "user" || groupBy === "user-action" || groupBy === "user-day"
  const showAction =
    groupBy === "none" ||
    groupBy === "action" ||
    groupBy === "user-action" ||
    groupBy === "action-day"
  const showDay = groupBy === "day" || groupBy === "user-day" || groupBy === "action-day"

  const { totalCredits, totalCount } = logs.reduce(
    (acc, log) => {
      acc.totalCredits += log.credits_used
      acc.totalCount += log.log_count
      return acc
    },
    { totalCredits: 0, totalCount: 0 },
  )

  const handleSort = (field: UsageSortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(field)
      setSortDir("desc")
    }
    setPage(0)
  }

  const handleGroupChange = (value: string) => {
    const next = value as UsageGroupBy
    setGroupBy(next)
    setPage(0)
    // Sane default sort for the chosen grouping.
    if (next === "none") {
      setSortBy("created_at")
    } else {
      setSortBy("credits_used")
    }
    setSortDir("desc")
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-xl font-bold">Usage Logs</h1>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Group by:</span>
            <Select value={groupBy} onValueChange={handleGroupChange}>
              <SelectTrigger className="h-8 w-[210px]" aria-label="Group by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                {GROUP_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {logs.length > 0 && (
            <div className="text-muted-foreground">
              Page total: <span className="font-medium">{totalCredits} credits</span>
              {isGrouped && (
                <>
                  {" / "}
                  <span className="font-medium">{totalCount} logs</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {showUser && <th className="text-left px-4 py-2 font-medium">User</th>}
              {showAction && <th className="text-left px-4 py-2 font-medium">Action</th>}
              {!isGrouped && <th className="text-left px-4 py-2 font-medium">Provider</th>}
              {showDay && <th className="text-left px-4 py-2 font-medium">Day</th>}
              <SortHeader
                label={isGrouped ? "Credits (sum)" : "Credits"}
                field="credits_used"
                align="right"
                active={sortBy === "credits_used"}
                dir={sortDir}
                onSort={handleSort}
              />
              {isGrouped && (
                <SortHeader
                  label="Logs"
                  field="log_count"
                  align="right"
                  active={sortBy === "log_count"}
                  dir={sortDir}
                  onSort={handleSort}
                />
              )}
              <SortHeader
                label={isGrouped ? "Last seen" : "Date"}
                field="created_at"
                active={sortBy === "created_at"}
                dir={sortDir}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t">
                {showUser && (
                  <td className="px-4 py-2">{log.user_email ?? "Unknown"}</td>
                )}
                {showAction && (
                  <td className="px-4 py-2">
                    {log.action ? <Badge variant="outline">{log.action}</Badge> : "-"}
                  </td>
                )}
                {!isGrouped && <td className="px-4 py-2">{log.provider ?? "-"}</td>}
                {showDay && (
                  <td className="px-4 py-2 text-muted-foreground">
                    {log.day ? new Date(log.day).toLocaleDateString() : "-"}
                  </td>
                )}
                <td className="px-4 py-2 text-right font-mono font-medium">
                  {log.credits_used}
                </td>
                {isGrouped && (
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {log.log_count}
                  </td>
                )}
                <td className="px-4 py-2 text-muted-foreground">
                  {log.created_at
                    ? new Date(log.created_at).toLocaleString()
                    : log.day
                    ? new Date(log.day).toLocaleDateString()
                    : "-"}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No usage logs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={logs.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
