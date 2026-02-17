import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAdminUsageLogs } from "@/hooks/queries/use-admin-queries"

export default function AdminUsagePage() {
  const [page, setPage] = useState(0)
  const { data: logs = [], isLoading: loading } = useAdminUsageLogs(page)

  const totalCredits = logs.reduce((sum, log) => sum + log.credits_used, 0)

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Usage Logs</h1>
        {logs.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Page total: <span className="font-medium">{totalCredits} credits</span>
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Action</th>
              <th className="text-left px-4 py-2 font-medium">Provider</th>
              <th className="text-left px-4 py-2 font-medium">Credits</th>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-4 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="px-4 py-2">
                  <Badge variant="outline">{log.action}</Badge>
                </td>
                <td className="px-4 py-2">{log.provider}</td>
                <td className="px-4 py-2 font-medium">{log.credits_used}</td>
                <td className="px-4 py-2">{log.user_email}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(log.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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
