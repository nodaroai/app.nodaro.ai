import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  useAdminUser,
  useAdminUsers,
  useAdminChangeRoleMutation,
  USER_SORT_DEFAULT_DIR,
  type AdminUser,
  type SortDir,
  type UserSortBy,
} from "@/ee/hooks/queries/use-admin-queries"
import { useAdminBlocks } from "@/ee/hooks/queries/use-admin-access"
import { useAuth } from "@/hooks/use-auth"
import { UserExpandedRow } from "./user-expanded-row"
import { formatBytes, unitsOrDash, useDeploymentPayerMode } from "./user-admin-helpers"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<string, string> = {
  free: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  basic: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  standard: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  pro: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  business: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
}

// Platform owner whose super_admin row is protected in the UI. Configured via
// VITE_PLATFORM_OWNER_EMAIL; empty (self-host default) means no protected owner.
const OWNER_EMAIL = (import.meta.env.VITE_PLATFORM_OWNER_EMAIL as string) || ""

const ROLE_COLORS: Record<string, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  super_admin: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

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

  const handleSort = (field: UserSortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(field)
      setSortDir(USER_SORT_DEFAULT_DIR[field])
    }
    setPage(0)
  }

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId))
  }

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
    <div className="p-6 max-w-7xl mx-auto">
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

      {/* overflow-x-auto, NOT overflow-hidden: the 11-column table is wider
          than the container on smaller viewports — hidden silently clipped
          the Role/Joined columns with no scrollbar. */}
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
                <td colSpan={payerMode ? 10 : 11} className="px-4 py-2 text-xs text-muted-foreground">
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
              />
            )}
            {listedUsers.map((user) => {
              const isExpanded = expandedUserId === user.id
              return (
                <UserRow
                  key={user.id}
                  user={user}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(user.id)}
                  onCreditsAdjusted={loadUsers}
                  currentUserRole={currentUserRole}
                  currentUserId={currentUser?.id ?? ""}
                  isBlocked={blockedIds.has(user.id)}
                />
              )
            })}
            {listedUsers.length === 0 && !(linkedId && linked.data) && (
              <tr>
                <td colSpan={payerMode ? 10 : 11} className="px-4 py-8 text-center text-muted-foreground">
                  {debouncedSearch ? "No users match your search." : "No users found."}
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
          disabled={users.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Row Component
// ---------------------------------------------------------------------------

function UserRow({
  user,
  isExpanded,
  onToggle,
  onCreditsAdjusted,
  currentUserRole,
  currentUserId,
  isBlocked,
}: {
  readonly user: AdminUser
  readonly isExpanded: boolean
  readonly onToggle: () => void
  readonly onCreditsAdjusted: () => void
  readonly currentUserRole: string
  readonly currentUserId: string
  readonly isBlocked: boolean
}) {
  const [changingRole, setChangingRole] = useState(false)
  const { payerMode } = useDeploymentPayerMode()
  const total = (user.subscription_credits ?? 0) + (user.topup_credits ?? 0)
  const tierClass = TIER_COLORS[user.subscription_tier] ?? TIER_COLORS.free
  const roleClass = ROLE_COLORS[user.role] ?? ROLE_COLORS.user

  const isOwner = OWNER_EMAIL !== "" && user.email === OWNER_EMAIL
  const isSuperAdmin = currentUserRole === "super_admin"
  const isSelf = currentUserId === user.id
  const canChangeRole = isSuperAdmin && !isOwner && !isSelf

  const changeRoleMut = useAdminChangeRoleMutation()

  const handleRoleChange = async (newRole: string) => {
    setChangingRole(true)
    try {
      await changeRoleMut.mutateAsync({ userId: user.id, role: newRole })
      toast.success(`Role changed to ${newRole}`)
      onCreditsAdjusted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change role")
    } finally {
      setChangingRole(false)
    }
  }

  return (
    <>
      <tr
        className="border-t cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <td className="px-2 py-2 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="px-4 py-2 font-medium">
          {user.email}
          {isBlocked && (
            <Badge variant="destructive" className="ms-2">
              Blocked
            </Badge>
          )}
        </td>
        <td className="px-4 py-2 text-muted-foreground">
          {user.full_name ?? "-"}
        </td>
        <td className="px-4 py-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tierClass}`}>
            {user.subscription_tier}
          </span>
        </td>
        {payerMode ? (
          <>
            <td className="px-4 py-2 text-right font-mono">{unitsOrDash(user.sai_granted)}</td>
            <td className="px-4 py-2 text-right font-mono font-bold">{unitsOrDash(user.sai_remaining)}</td>
            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{unitsOrDash(user.sai_spent)}</td>
          </>
        ) : (
          <>
            <td className="px-4 py-2 text-right font-mono">{user.subscription_credits}</td>
            <td className="px-4 py-2 text-right font-mono">{user.topup_credits}</td>
            <td className="px-4 py-2 text-right font-mono font-bold">{total}</td>
            <td className="px-4 py-2 text-right font-mono text-muted-foreground">{user.daily_spent_credits}</td>
          </>
        )}
        <td className="px-4 py-2 text-right font-mono text-muted-foreground text-xs whitespace-nowrap">
          {formatBytes(user.storage_used_bytes)} / {formatBytes(user.storage_limit_bytes)}
        </td>
        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
          {isOwner ? (
            <Badge className="bg-red-600 text-white hover:bg-red-600">
              <Shield className="h-3 w-3 mr-1" />
              Owner
            </Badge>
          ) : canChangeRole ? (
            <Select
              value={user.role}
              onValueChange={handleRoleChange}
              disabled={changingRole}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs" aria-label="Change role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[9999]">
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="super_admin">super_admin</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleClass}`}>
              {user.role}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-muted-foreground">
          {new Date(user.created_at).toLocaleDateString()}
        </td>
      </tr>
      {isExpanded && (
        <UserExpandedRow
          user={user}
          onCreditsAdjusted={onCreditsAdjusted}
          adminUserId={currentUserId}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </>
  )
}
