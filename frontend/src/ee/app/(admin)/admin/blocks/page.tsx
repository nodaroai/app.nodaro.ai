import { Loader2 } from "lucide-react"
import { hasAdmin } from "@/lib/edition"
import { useAdminBlocks } from "@/ee/hooks/queries/use-admin-access"
import { BlockedUsersCard } from "@/ee/components/admin/user-access/blocked-users-card"
import { BlockedNetworksCard } from "@/ee/components/admin/user-access/blocked-networks-card"
import { countOf, formatBlockDateTime } from "@/ee/components/admin/user-access/block-format"

/**
 * Blocked accounts and blocked networks in one place.
 *
 * The status line is THIS server's enforcement snapshot (refreshed every 30
 * seconds), so an admin can see that a block they just made is in force here —
 * other servers pick it up within the same 30 seconds.
 */
export default function AdminBlocksPage() {
  const { data, isLoading, error } = useAdminBlocks()

  if (!hasAdmin()) return null

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">Blocks</h1>
        <p className="text-sm text-muted-foreground">
          A blocked account cannot sign in or use anything; its scheduled runs and published apps stop.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error || !data ? (
        <p className="py-6 text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load blocks"}
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            {data.ready
              ? `In force on this server: ${countOf(data.status.users, "account", "accounts")} and ${countOf(data.status.networks, "network", "networks")}, read ${formatBlockDateTime(data.status.loadedAt)}.`
              : "Blocking becomes available after the next production release."}
          </p>
          <BlockedUsersCard users={data.users} truncated={data.usersTruncated} />
          <BlockedNetworksCard networks={data.networks} ready={data.ready} truncated={data.networksTruncated} />
        </>
      )}
    </div>
  )
}
