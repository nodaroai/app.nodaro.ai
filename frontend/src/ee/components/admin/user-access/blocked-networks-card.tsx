import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useUnblockNetwork, type AdminBlockedNetwork } from "@/ee/hooks/queries/use-admin-access"
import { AddNetworkBlockForm } from "./add-network-block-form"
import { formatBlockDate, formatBlockDateTime } from "./block-format"

/**
 * The network blocks still in force, and the form to add one by address or
 * range. A block made from an account's row shows as a short token — the
 * server never sends the address it was taken from.
 */
export function BlockedNetworksCard({
  networks,
  ready,
  truncated,
}: {
  readonly networks: readonly AdminBlockedNetwork[]
  readonly ready: boolean
  readonly truncated: boolean
}) {
  const lift = useUnblockNetwork()

  const doLift = async (n: AdminBlockedNetwork) => {
    try {
      await lift.mutateAsync({ id: n.id })
      toast.success("Network block lifted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to lift the network block")
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Blocked networks ({networks.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          A blocked network stops browser sign-ins and browser use from it until the block expires. Admins are never
          stopped, and connections from AI assistants and other servers are not affected. Someone on another network
          or a VPN gets around it — block the account too.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddNetworkBlockForm disabled={!ready} />

        {networks.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No blocked networks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Network</th>
                  <th className="py-2 pr-4 font-medium">Note</th>
                  <th className="py-2 pr-4 font-medium">Blocked by</th>
                  <th className="py-2 pr-4 font-medium">Since</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => {
                  const pending = lift.isPending && lift.variables?.id === n.id
                  return (
                    <tr key={n.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{n.range ?? n.token ?? "—"}</span>
                          {n.superAdminOnly && <Badge variant="outline">Super admin</Badge>}
                        </div>
                        {n.fromUser && (
                          <div className="text-xs text-muted-foreground">Signup network of {n.fromUser}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{n.label ?? "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{n.blockedBy ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                        {formatBlockDateTime(n.blockedAt)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{formatBlockDate(n.expiresAt)}</td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" disabled={lift.isPending} onClick={() => doLift(n)}>
                          {pending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
                          Lift
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
