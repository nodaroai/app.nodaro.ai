import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useUnblockUser, type AdminBlockedUser } from "@/ee/hooks/queries/use-admin-access"
import { formatBlockDateTime } from "./block-format"

/**
 * Every blocked account, newest first, with a one-click unblock. Blocking
 * itself happens from the account's row on the Users page, where the admin
 * sees who the person is before acting.
 */
export function BlockedUsersCard({
  users,
  truncated,
}: {
  readonly users: readonly AdminBlockedUser[]
  readonly truncated: boolean
}) {
  const unblock = useUnblockUser()

  const doUnblock = async (u: AdminBlockedUser) => {
    try {
      const out = await unblock.mutateAsync({ userId: u.userId })
      if (out.warning) toast.warning(out.warning)
      else toast.success(`Unblocked ${u.email ?? u.userId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unblock the account")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Blocked accounts ({users.length})</CardTitle>
        <p className="text-xs text-muted-foreground">To block an account, open it on the Users page.</p>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No blocked accounts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Blocked by</th>
                  <th className="py-2 pr-4 font-medium">Since</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const pending = unblock.isPending && unblock.variables?.userId === u.userId
                  return (
                    <tr key={u.userId} className="border-b align-top last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{u.email ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{u.userId}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.reason ?? "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.blockedBy ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                        {formatBlockDateTime(u.blockedAt)}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" disabled={unblock.isPending} onClick={() => doUnblock(u)}>
                          {pending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
                          Unblock
                        </Button>
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
