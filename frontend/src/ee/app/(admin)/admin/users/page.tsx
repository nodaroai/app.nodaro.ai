import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SortHeader } from "@/components/ui/sort-header"
import {
  useAdminUser,
  useAdminUsers,
  USER_SORT_DEFAULT_DIR,
  type SortDir,
  type UserSortBy,
} from "@/ee/hooks/queries/use-admin-queries"
import { useAdminBlocks } from "@/ee/hooks/queries/use-admin-access"
import { useAuth } from "@/hooks/use-auth"
import { hasCredits } from "@/lib/edition"
import { ClusterToolbar } from "@/ee/components/admin/users-linkage/cluster-toolbar"
import { ClusterDetailCard } from "@/ee/components/admin/users-linkage/cluster-detail-card"
import { useUsersLinkage } from "@/ee/components/admin/users-linkage/use-users-linkage"
import { sameTarget, visibleUsers } from "@/ee/components/admin/users-linkage/linkage-model"
import type { ActiveTarget, LinkageCluster } from "@/ee/components/admin/users-linkage/types"
import "@/ee/components/admin/users-linkage/users-linkage.css"
import { UserRow, type RowLinkage } from "./user-row"
import { useDeploymentPayerMode } from "./user-admin-helpers"

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AdminUsersPage() {
  const { user: currentUser, role: currentUserRole } = useAuth()
  const { payerMode, ready: surfaceReady } = useDeploymentPayerMode()
  // The badge only: the expanded row reads each account's real state itself.
  const { data: blocks } = useAdminBlocks()
  const blockedIds = new Set((blocks?.users ?? []).map((b) => b.userId))
  const [page, setPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  // The search runs on the server over every user, so wait for a pause in
  // typing rather than querying on each keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<UserSortBy>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  // The source is decided here, not inside the hook: under a payer the rows
  // come from the service-role route (payer row omitted, credit columns
  // withheld), and until the surface has answered we fetch from neither —
  // `deploymentPayer` reads false while it loads, and acting on that default
  // would flash the wrong source at a deployment admin.
  const {
    data: users = [],
    isLoading: loading,
    isFetching,
    refetch: loadUsers,
  } = useAdminUsers(
    page,
    50,
    sortBy,
    sortDir,
    { viaRoute: payerMode, ready: surfaceReady },
    debouncedSearch,
  )

  // A direct link (`?user=<id>`, e.g. from "Signed in now") pins that person
  // above the list, open — whichever page of the list they are on.
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedId = searchParams.get("user")
  const linked = useAdminUser(linkedId, { viaRoute: payerMode, ready: surfaceReady })
  useEffect(() => {
    if (linkedId) setExpandedUserId(linkedId)
  }, [linkedId])
  const showAll = () =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete("user")
      return next
    })
  const listedUsers = linkedId ? users.filter((u) => u.id !== linkedId) : users

  // Linked-account marking. Only where the free signup grant exists (credits
  // on, nobody paying for everyone); and the page stays exactly as it was
  // until the marks are here and the clusters RPC exists on this database.
  // A cluster is selected by its KEY, never by its "#n": the number is a
  // position by size and moves when a cluster grows between refreshes.
  const [pointer, setPointer] = useState<ActiveTarget | null>(null)
  const [pinned, setPinned] = useState<ActiveTarget | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null)
  const linkageOn = hasCredits() && surfaceReady && !payerMode
  // The linked row is on screen too, whichever page it belongs to: mark it as well.
  const linkedUser = linked.data ?? null
  const markedIds = useMemo(
    () => [...users.map((u) => u.id), ...(linkedUser && !users.some((u) => u.id === linkedUser.id) ? [linkedUser.id] : [])],
    [users, linkedUser],
  )
  const { data: linkageData } = useUsersLinkage(markedIds, linkageOn)
  const linkage = linkageOn && linkageData && !linkageData.unavailable ? linkageData : null
  const marks = linkage?.users ?? {}
  const active = pointer ?? pinned
  const clusterById = useMemo(
    () => new Map<number, LinkageCluster>((linkage?.clusters ?? []).map((c) => [c.id, c])),
    [linkage],
  )
  const selectedCluster = linkage?.clusters.find((c) => c.key === selectedClusterKey) ?? null

  // What the admin was pointing at belongs to the rows that were on screen.
  const forgetPointer = () => {
    setPointer(null)
    setPinned(null)
  }

  const handleSort = (field: UserSortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(field)
      setSortDir(USER_SORT_DEFAULT_DIR[field])
    }
    setPage(0)
    forgetPointer()
  }

  const turnPage = (delta: number) => {
    setPage((p) => p + delta)
    forgetPointer()
  }

  const filteredUsers = visibleUsers(listedUsers, marks, {
    onlyFlagged: linkage ? onlyFlagged : false,
    clusterId: selectedCluster ? selectedCluster.id : null,
  })
  const filtering = linkage !== null && (onlyFlagged || selectedCluster !== null)
  const columnCount = payerMode ? 10 : linkage ? 12 : 11

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId))
  }
  const togglePin = (target: ActiveTarget) => {
    setPinned((prev) => (prev && sameTarget(prev, target) ? null : target))
  }
  const selectCluster = (clusterKey: string) => {
    setSelectedClusterKey((prev) => (prev === clusterKey ? null : clusterKey))
  }
  const rowLinkage = (userId: string): RowLinkage | null => {
    if (!linkage) return null
    const mark = marks[userId]
    return {
      users: marks,
      mark,
      cluster: (mark?.clusterId != null && clusterById.get(mark.clusterId)) || null,
      partial: linkage.partial,
      pointer: active,
      onPoint: setPointer,
      onPin: togglePin,
    }
  }

  // `!surfaceReady` too: with the query disabled until the surface answers,
  // react-query reports isLoading false, and the table would flash "No users
  // found." at an admin who has users.
  if ((loading || !surfaceReady) && users.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    // Marked, the page takes the mock's wider main area: twelve columns do not
    // fit 1280px, and the admin would otherwise scroll to reach Joined.
    <div className={`p-6 mx-auto ${linkage ? "max-w-[1560px]" : "max-w-7xl"}`}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Users</h1>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by email or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {isFetching && searchQuery.trim() && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {linkage && (
        <>
          <ClusterToolbar
            linkage={linkage}
            users={marks}
            active={active}
            onActive={setPointer}
            selectedKey={selectedCluster?.key ?? null}
            onSelect={selectCluster}
            onlyFlagged={onlyFlagged}
            onToggleFlagged={() => setOnlyFlagged((v) => !v)}
            pinned={pinned}
            onUnpin={() => setPinned(null)}
          />
          {selectedCluster && (
            <ClusterDetailCard
              cluster={selectedCluster}
              onPage={users.filter((u) => marks[u.id]?.clusterId === selectedCluster.id).length}
              active={active}
              pinned={pinned}
              onActive={setPointer}
              onPin={togglePin}
              onClose={() => setSelectedClusterKey(null)}
              canBlock={currentUserRole === "super_admin"}
              blockedIds={blockedIds}
              viewerId={currentUser?.id ?? ""}
              onBlocked={() => void loadUsers()}
            />
          )}
        </>
      )}

      {/* overflow-x-auto, NOT overflow-hidden: the table is wider than the
          container on smaller viewports — hidden silently clipped the
          Role/Joined columns with no scrollbar. */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {payerMode ? (
              /* Under a payer the rows come from GET /v1/admin/users, which
                 orders by join date and takes no sort parameter — so these are
                 plain headers, not arrows that would do nothing when clicked.
                 The three allowance columns replace the four credit columns. */
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Tier</th>
                <th className="text-right px-4 py-2 font-medium">Granted</th>
                <th className="text-right px-4 py-2 font-medium">Remaining</th>
                <th className="text-right px-4 py-2 font-medium">Spent</th>
                <th className="text-right px-4 py-2 font-medium">Storage</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Joined</th>
              </tr>
            ) : (
            <tr>
              <th className="w-8 px-2 py-2" />
              <SortHeader
                label="Email"
                field="email"
                active={sortBy === "email"}
                dir={sortDir}
                onSort={handleSort}
              />
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <SortHeader
                label="Tier"
                field="tier"
                active={sortBy === "tier"}
                dir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Sub CR"
                field="subscription_credits"
                align="right"
                active={sortBy === "subscription_credits"}
                dir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Topup CR"
                field="topup_credits"
                align="right"
                active={sortBy === "topup_credits"}
                dir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Total"
                field="total_credits"
                align="right"
                active={sortBy === "total_credits"}
                dir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Daily Spent"
                field="daily_spent_credits"
                align="right"
                active={sortBy === "daily_spent_credits"}
                dir={sortDir}
                onSort={handleSort}
              />
              <th className="text-right px-4 py-2 font-medium">Storage</th>
              <SortHeader
                label="Role"
                field="role"
                active={sortBy === "role"}
                dir={sortDir}
                onSort={handleSort}
              />
              {linkage && <th className="text-left px-2 py-2 font-medium">Signals</th>}
              <SortHeader
                label="Joined"
                field="created_at"
                active={sortBy === "created_at"}
                dir={sortDir}
                onSort={handleSort}
              />
            </tr>
            )}
          </thead>
          <tbody>
            {linkedId && (
              <tr className="bg-muted/40">
                <td colSpan={columnCount} className="px-4 py-2 text-xs text-muted-foreground">
                  {linked.isLoading
                    ? "Opening the user from your link…"
                    : linked.data
                      ? "Opened from a link."
                      : "No user with that id, or not one you may see."}{" "}
                  <button type="button" className="underline" onClick={showAll}>
                    Show all users
                  </button>
                </td>
              </tr>
            )}
            {linkedId && linked.data && (
              <UserRow
                key={`linked-${linked.data.id}`}
                user={linked.data}
                isExpanded={expandedUserId === linked.data.id}
                onToggle={() => toggleExpand(linked.data!.id)}
                onCreditsAdjusted={() => {
                  void linked.refetch()
                  void loadUsers()
                }}
                currentUserRole={currentUserRole}
                currentUserId={currentUser?.id ?? ""}
                isBlocked={blockedIds.has(linked.data.id)}
                columnCount={columnCount}
                linkage={rowLinkage(linked.data.id)}
              />
            )}
            {filteredUsers.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isExpanded={expandedUserId === user.id}
                onToggle={() => toggleExpand(user.id)}
                onCreditsAdjusted={loadUsers}
                currentUserRole={currentUserRole}
                currentUserId={currentUser?.id ?? ""}
                isBlocked={blockedIds.has(user.id)}
                columnCount={columnCount}
                linkage={rowLinkage(user.id)}
              />
            ))}
            {filteredUsers.length === 0 && !(linkedId && linked.data) && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                  {debouncedSearch
                    ? "No users match your search."
                    : filtering
                      ? "No users match your filter."
                      : "No users found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linkage && linkage.clusters.length > 0 && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          Each cluster has a number; the colour is its size tier. Click a cluster to filter the table and see its
          shared keys. Point at a cluster, a flagged row or a key to see every account sharing that device, browser
          profile or network; click a key to keep it lit. Open a row for the details.
        </p>
      )}

      <div className="flex gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => turnPage(-1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={users.length < 50}
          onClick={() => turnPage(1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
