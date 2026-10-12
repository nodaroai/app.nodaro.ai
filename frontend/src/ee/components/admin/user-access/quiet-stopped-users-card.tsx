import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useQuietReleaseUser, type AdminQuietStoppedUser } from "@/ee/hooks/queries/use-admin-access"
import { formatBlockDateTime } from "./block-format"

/**
 * Every quietly stopped account, newest first, with what is waiting in its
 * queue and a one-click release. Stopping happens from the account's row on
 * the Users page, like a block.
 */
export function QuietStoppedUsersCard({
  users,
  truncated,
  isSuperAdmin,
}: {
  readonly users: readonly AdminQuietStoppedUser[]
  readonly truncated: boolean
  readonly isSuperAdmin: boolean
}) {
  const release = useQuietReleaseUser()

  const doRelease = async (u: AdminQuietStoppedUser) => {
    try {
      await release.mutateAsync({ userId: u.userId })
      toast.success(`Released ${u.email ?? u.userId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to release the account")
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Quietly stopped accounts ({users.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          Their runs are accepted and charged and never start; the person is not told. Release to run what is waiting.
        </p>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No quietly stopped accounts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Stopped by</th>
                  <th className="py-2 pr-4 font-medium">Since</th>
                  <th className="py-2 pr-4 font-medium">Waiting</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const pending = release.isPending && release.variables?.userId === u.userId
                  return (
                    <tr key={u.userId} className="border-b align-top last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{u.email ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{u.userId}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.reason ?? "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.stoppedBy ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{formatBlockDateTime(u.stoppedAt)}</td>
                      <td className="py-2 pr-4 tabular-nums">{u.waitingJobs}</td>
                      <td className="py-2 text-right">
                        {isSuperAdmin && (
                          <Button size="sm" variant="outline" disabled={release.isPending} onClick={() => doRelease(u)}>
                            {pending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
                            Release
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {truncated && <p className="pt-2 text-xs text-muted-foreground">Showing the newest 500.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
