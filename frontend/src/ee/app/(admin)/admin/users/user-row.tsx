import { useState } from "react"
import { ChevronDown, ChevronRight, Shield } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAdminChangeRoleMutation, type AdminUser } from "@/ee/hooks/queries/use-admin-queries"
import { DecisionChip, FlagBadge, SharedChip } from "@/ee/components/admin/users-linkage/linkage-marker"
import { SignalPills } from "@/ee/components/admin/users-linkage/signal-pills"
import {
  isActiveAccount,
  isFlagged,
  isLinked,
  rowTone,
  sharedAxes,
  sharedLabel,
  shouldDim,
} from "@/ee/components/admin/users-linkage/linkage-model"
import { tierVar } from "@/ee/components/admin/users-linkage/linkage-styles"
import type {
  ActiveTarget,
  LinkageCluster,
  LinkageUser,
  UsersById,
} from "@/ee/components/admin/users-linkage/types"
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

/** Rows that are not part of what the admin points at step back this far — legible, not gone. */
const DIMMED_OPACITY = 0.75

/** What the page knows about this row's place among the linked-account clusters. */
export interface RowLinkage {
  readonly users: UsersById
  readonly mark: LinkageUser | undefined
  readonly cluster: LinkageCluster | null
  /** The walk was cut short: a lone key is "not checked", not "unique". */
  readonly partial: boolean
  readonly pointer: ActiveTarget | null
  readonly onPoint: (target: ActiveTarget | null) => void
  readonly onPin: (target: ActiveTarget) => void
}

// ---------------------------------------------------------------------------
// User Row Component
// ---------------------------------------------------------------------------

export function UserRow({
  user,
  isExpanded,
  onToggle,
  onCreditsAdjusted,
  currentUserRole,
  currentUserId,
  isBlocked,
  columnCount,
  linkage,
}: {
  readonly user: AdminUser
  readonly isExpanded: boolean
  readonly onToggle: () => void
  readonly onCreditsAdjusted: () => void
  readonly currentUserRole: string
  readonly currentUserId: string
  readonly isBlocked: boolean
  readonly columnCount: number
  /** null while the page is unmarked (no credits, a payer, or the RPC is not there yet). */
  readonly linkage: RowLinkage | null
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

  // The marking. A flagged row is tinted in its cluster's colour and carries a
  // 3px bar, a "#n" flag and the grant's state; pointing at it (or at a key, or
  // at a cluster pill) lights every row linked to it and steps the others back.
  const flagged = linkage !== null && isFlagged(linkage.mark)
  const pointer = linkage?.pointer ?? null
  const axes = linkage ? sharedAxes(pointer, user.id, linkage.users) : []
  const linked = linkage ? isLinked(pointer, user.id, linkage.users) : false
  const dim = linkage ? shouldDim(pointer, user.id, linkage.users) : false
  const tone = rowTone(flagged, linked, isActiveAccount(pointer, user.id))
  const tier = linkage?.cluster?.tier ?? "small"
  const clusterId = linkage?.mark?.clusterId ?? null

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
        className={`border-t cursor-pointer transition-[background-color,opacity] ${tone === "none" ? "hover:bg-muted/30" : ""}`}
        style={{
          background: tone === "none" ? undefined : tierVar(tier, tone),
          opacity: dim ? DIMMED_OPACITY : undefined,
        }}
        onClick={onToggle}
        onMouseEnter={flagged && linkage ? () => linkage.onPoint({ type: "account", userId: user.id }) : undefined}
        onMouseLeave={flagged && linkage ? () => linkage.onPoint(null) : undefined}
      >
        <td className="relative px-2 py-2 text-muted-foreground">
          {flagged && (
            <span aria-hidden className="absolute inset-y-0 start-0 w-[3px]" style={{ background: tierVar(tier, "color") }} />
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        {flagged ? (
          /* A fixed two-line cell: the flag and the email on the first line,
             the chips on a second line that is ALWAYS reserved and positioned
             out of the flow. The "shares …" chip comes and goes with the
             pointer, and if it took part in the layout every row below would
             jump each time the mouse moved. Anything too long is clipped. */
          <td className="relative overflow-hidden px-4 pb-7 pt-2 align-top font-semibold">
            <div className="flex items-center gap-2 whitespace-nowrap">
              {clusterId !== null && <FlagBadge clusterId={clusterId} tier={tier} />}
              <span>{user.email}</span>
            </div>
            <div className="absolute bottom-1.5 start-4 flex items-center gap-1.5 whitespace-nowrap">
              {isBlocked && <Badge variant="destructive">Blocked</Badge>}
              {user.free_grant_state && <DecisionChip decision={user.free_grant_state} />}
              {linked && pointer && <SharedChip axes={axes} label={sharedLabel(pointer, axes)} />}
            </div>
          </td>
        ) : (
          <td className="px-4 py-2 font-medium">
            <span>{user.email}</span>
            {isBlocked && (
              <Badge variant="destructive" className="ms-2">
                Blocked
              </Badge>
            )}
          </td>
        )}
        {/* Marked, the Name column caps at the mock's 130px so the Signals
            column fits without pushing Joined off the edge. */}
        <td
          className={`px-4 py-2 text-muted-foreground ${linkage ? "max-w-[130px] truncate" : ""}`}
          title={linkage ? (user.full_name ?? undefined) : undefined}
        >
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
        {linkage && (
          <td className="px-2 py-2">
            {flagged && linkage.mark && (
              <SignalPills
                userId={user.id}
                user={linkage.mark}
                users={linkage.users}
                active={pointer}
                onActive={linkage.onPoint}
                onPin={linkage.onPin}
              />
            )}
          </td>
        )}
        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap tabular-nums">
          {new Date(user.created_at).toLocaleDateString()}
          {/* The time, as the mock shows it, only on the marked page: unmarked, the page is its old self. */}
          {linkage && (
            <>
              {" "}
              <span className="text-muted-foreground/70">
                {new Date(user.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </>
          )}
        </td>
      </tr>
      {isExpanded && (
        <UserExpandedRow
          user={user}
          onCreditsAdjusted={onCreditsAdjusted}
          adminUserId={currentUserId}
          isSuperAdmin={isSuperAdmin}
          columnCount={columnCount}
          linkage={linkage?.mark?.signals ? { user: linkage.mark, cluster: linkage.cluster, partial: linkage.partial } : null}
        />
      )}
    </>
  )
}
