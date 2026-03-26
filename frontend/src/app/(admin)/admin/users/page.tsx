import { useState } from "react"
import {
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  History,
  Coins,
  Plus,
  Minus,
  HardDrive,
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
import {
  useAdminUsers,
  useAdminUserTransactions,
  useAdminAdjustCreditsMutation,
  useAdminChangeTierMutation,
  useAdminChangeStorageMutation,
  useAdminChangeRoleMutation,
  type AdminUser,
} from "@/hooks/queries/use-admin-queries"
import { useAuth } from "@/hooks/use-auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditTransaction {
  readonly id: string
  readonly amount: number
  readonly credit_type: "subscription" | "topup"
  readonly source: string
  readonly description: string | null
  readonly balance_after: number
  readonly created_at: string
}

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

const SOURCE_COLORS: Record<string, string> = {
  usage: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  refund: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  admin_adjustment: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  subscription_renewal: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  one_time_purchase: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  expiry: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const OWNER_EMAIL = "[email removed]"

const ROLE_COLORS: Record<string, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  super_admin: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
}

const STORAGE_LIMIT_OPTIONS: ReadonlyArray<{ readonly label: string; readonly bytes: number }> = [
  { label: "1 GB (Free)", bytes: 1 * 1024 * 1024 * 1024 },
  { label: "10 GB (Basic)", bytes: 10 * 1024 * 1024 * 1024 },
  { label: "25 GB (Standard)", bytes: 25 * 1024 * 1024 * 1024 },
  { label: "50 GB (Pro)", bytes: 50 * 1024 * 1024 * 1024 },
  { label: "200 GB (Business)", bytes: 200 * 1024 * 1024 * 1024 },
  { label: "500 GB (Enterprise)", bytes: 500 * 1024 * 1024 * 1024 },
]

// ---------------------------------------------------------------------------
// Expanded Row Component
// ---------------------------------------------------------------------------

function UserExpandedRow({
  user,
  onCreditsAdjusted,
  adminUserId,
}: {
  readonly user: AdminUser
  readonly onCreditsAdjusted: () => void
  readonly adminUserId: string
}) {
  const { data: txResult, isLoading: txLoading } = useAdminUserTransactions(user.id)
  const transactions = Array.isArray(txResult) ? txResult : (txResult?.data ?? []) as ReadonlyArray<CreditTransaction>
  const [adjustAmount, setAdjustAmount] = useState("")
  const [adjustType, setAdjustType] = useState<"subscription" | "topup">("topup")
  const [adjustDesc, setAdjustDesc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [changingTier, setChangingTier] = useState(false)
  const [storagePreset, setStoragePreset] = useState<string>(() => {
    const match = STORAGE_LIMIT_OPTIONS.find((o) => o.bytes === user.storage_limit_bytes)
    return match ? String(match.bytes) : "custom"
  })
  const [customStorageGB, setCustomStorageGB] = useState(() => {
    const match = STORAGE_LIMIT_OPTIONS.find((o) => o.bytes === user.storage_limit_bytes)
    return match ? "" : String(Math.round(user.storage_limit_bytes / (1024 * 1024 * 1024)))
  })
  const [savingStorage, setSavingStorage] = useState(false)

  const adjustCreditsMut = useAdminAdjustCreditsMutation()
  const changeTierMut = useAdminChangeTierMutation()
  const changeStorageMut = useAdminChangeStorageMutation()

  const handleAdjust = async () => {
    const amount = Number(adjustAmount)
    if (Number.isNaN(amount) || amount === 0) {
      toast.error("Amount must be a non-zero number")
      return
    }
    if (!adjustDesc.trim()) {
      toast.error("Description is required")
      return
    }

    setSubmitting(true)
    try {
      await adjustCreditsMut.mutateAsync({
        userId: user.id,
        amount,
        creditType: adjustType,
        description: adjustDesc.trim(),
        adminUserId,
      })
      toast.success(`Credits adjusted: ${amount > 0 ? "+" : ""}${amount} ${adjustType}`)
      setAdjustAmount("")
      setAdjustDesc("")
      onCreditsAdjusted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to adjust credits")
    } finally {
      setSubmitting(false)
    }
  }

  const handleTierChange = async (newTier: string) => {
    setChangingTier(true)
    try {
      const result = await changeTierMut.mutateAsync({ userId: user.id, tier: newTier })
      toast.success(`Tier changed to ${newTier} (credits reset to ${(result as Record<string,unknown>).subscription_credits ?? newTier})`)
      onCreditsAdjusted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change tier")
    } finally {
      setChangingTier(false)
    }
  }

  const handleStorageChange = async () => {
    const bytes = storagePreset === "custom"
      ? Math.round(Number(customStorageGB) * 1024 * 1024 * 1024)
      : Number(storagePreset)

    if (!bytes || bytes <= 0) {
      toast.error("Storage limit must be a positive number")
      return
    }

    setSavingStorage(true)
    try {
      await changeStorageMut.mutateAsync({ userId: user.id, storageLimitBytes: bytes })
      toast.success(`Storage limit updated to ${formatBytes(bytes)}`)
      onCreditsAdjusted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update storage limit")
    } finally {
      setSavingStorage(false)
    }
  }

  const total = user.subscription_credits + user.topup_credits
  const subPercent = total > 0 ? (user.subscription_credits / total) * 100 : 0

  return (
    <tr>
      <td colSpan={11} className="px-4 py-4 bg-muted/30">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Credit Management */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Coins className="h-4 w-4" />
              Credit Management
            </div>

            {/* Balance breakdown */}
            <div className="border rounded-lg p-3 bg-card space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subscription</span>
                <span className="font-mono font-medium">{user.subscription_credits}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Top-up</span>
                <span className="font-mono font-medium">{user.topup_credits}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="font-medium">Total</span>
                <span className="font-mono font-bold">{total}</span>
              </div>
              {/* Visual bar */}
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                  style={{ width: `${Math.min(subPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Subscription ({Math.round(subPercent)}%)</span>
                <span>Top-up ({Math.round(100 - subPercent)}%)</span>
              </div>
            </div>

            {/* Change Tier */}
            <div className="border rounded-lg p-3 bg-card space-y-2">
              <div className="text-sm font-medium">Change Tier</div>
              <Select
                value={user.subscription_tier}
                onValueChange={handleTierChange}
                disabled={changingTier}
              >
                <SelectTrigger className="w-full" aria-label="Change tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
              {changingTier && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating...
                </div>
              )}
            </div>

            {/* Adjust form */}
            <div className="border rounded-lg p-3 bg-card space-y-3">
              <div className="text-sm font-medium">Adjust Credits</div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Amount (+/-)"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="flex-1"
                />
                <Select value={adjustType} onValueChange={(v) => setAdjustType(v as "subscription" | "topup")}>
                  <SelectTrigger className="w-[130px]" aria-label="Credit adjustment type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    <SelectItem value="subscription">Subscription</SelectItem>
                    <SelectItem value="topup">Top-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Description (required)"
                value={adjustDesc}
                onChange={(e) => setAdjustDesc(e.target.value)}
              />
              <Button
                size="sm"
                disabled={submitting || !adjustAmount || !adjustDesc.trim()}
                onClick={handleAdjust}
                className="w-full"
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : Number(adjustAmount) >= 0 ? (
                  <Plus className="h-3 w-3 mr-1" />
                ) : (
                  <Minus className="h-3 w-3 mr-1" />
                )}
                {submitting ? "Adjusting..." : "Apply"}
              </Button>
            </div>

            {/* Storage Management */}
            <div className="border rounded-lg p-3 bg-card space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="h-4 w-4" />
                Storage Management
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Usage</span>
                <span className="font-mono font-medium">
                  {formatBytes(user.storage_used_bytes)} / {formatBytes(user.storage_limit_bytes)}
                </span>
              </div>
              {/* Usage bar */}
              {(() => {
                const usagePercent = user.storage_limit_bytes > 0
                  ? Math.min(100, (user.storage_used_bytes / user.storage_limit_bytes) * 100)
                  : 0
                return (
                  <>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          usagePercent > 90
                            ? "bg-red-500"
                            : usagePercent > 70
                            ? "bg-amber-500"
                            : "bg-gradient-to-r from-cyan-500 to-blue-500"
                        }`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{Math.round(usagePercent)}% used</span>
                      <span>{formatBytes(Math.max(0, user.storage_limit_bytes - user.storage_used_bytes))} remaining</span>
                    </div>
                  </>
                )
              })()}
              {/* Limit selector */}
              <div className="text-sm font-medium pt-1">Set Limit</div>
              <Select value={storagePreset} onValueChange={setStoragePreset}>
                <SelectTrigger className="w-full" aria-label="Storage limit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  {STORAGE_LIMIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.bytes} value={String(opt.bytes)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {storagePreset === "custom" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="GB"
                    value={customStorageGB}
                    onChange={(e) => setCustomStorageGB(e.target.value)}
                    className="flex-1"
                    min={1}
                  />
                  <span className="text-sm text-muted-foreground">GB</span>
                </div>
              )}
              <Button
                size="sm"
                disabled={savingStorage || (storagePreset === "custom" && (!customStorageGB || Number(customStorageGB) <= 0))}
                onClick={handleStorageChange}
                className="w-full"
              >
                {savingStorage ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <HardDrive className="h-3 w-3 mr-1" />
                )}
                {savingStorage ? "Updating..." : "Apply"}
              </Button>
            </div>
          </div>

          {/* Right: Transactions */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              Recent Transactions
            </div>

            <div className="border rounded-lg overflow-hidden bg-card">
              {txLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No transactions yet.
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium">Date</th>
                        <th className="text-right px-3 py-1.5 font-medium">Amount</th>
                        <th className="text-left px-3 py-1.5 font-medium">Type</th>
                        <th className="text-left px-3 py-1.5 font-medium">Source</th>
                        <th className="text-left px-3 py-1.5 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="border-t">
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                            {new Date(tx.created_at).toLocaleDateString()}{" "}
                            {new Date(tx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono font-medium ${tx.amount > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {tx.amount > 0 ? "+" : ""}{tx.amount}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="capitalize">{tx.credit_type}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[tx.source] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
                              {tx.source.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">
                            {tx.description ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AdminUsersPage() {
  const { user: currentUser, role: currentUserRole } = useAuth()
  const [page, setPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const { data: users = [], isLoading: loading, refetch: loadUsers } = useAdminUsers(page)

  const filteredUsers = searchQuery.trim()
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      )
    : users

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId))
  }

  if (loading && users.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Users</h1>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by email or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Tier</th>
              <th className="text-right px-4 py-2 font-medium">Sub CR</th>
              <th className="text-right px-4 py-2 font-medium">Topup CR</th>
              <th className="text-right px-4 py-2 font-medium">Total</th>
              <th className="text-right px-4 py-2 font-medium">Daily Spent</th>
              <th className="text-right px-4 py-2 font-medium">Storage</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => {
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
                />
              )
            })}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                  {searchQuery.trim() ? "No users match your search." : "No users found."}
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
}: {
  readonly user: AdminUser
  readonly isExpanded: boolean
  readonly onToggle: () => void
  readonly onCreditsAdjusted: () => void
  readonly currentUserRole: string
  readonly currentUserId: string
}) {
  const [changingRole, setChangingRole] = useState(false)
  const total = user.subscription_credits + user.topup_credits
  const tierClass = TIER_COLORS[user.subscription_tier] ?? TIER_COLORS.free
  const roleClass = ROLE_COLORS[user.role] ?? ROLE_COLORS.user

  const isOwner = user.email === OWNER_EMAIL
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
        <td className="px-4 py-2 font-medium">{user.email}</td>
        <td className="px-4 py-2 text-muted-foreground">
          {user.full_name ?? "-"}
        </td>
        <td className="px-4 py-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tierClass}`}>
            {user.subscription_tier}
          </span>
        </td>
        <td className="px-4 py-2 text-right font-mono">{user.subscription_credits}</td>
        <td className="px-4 py-2 text-right font-mono">{user.topup_credits}</td>
        <td className="px-4 py-2 text-right font-mono font-bold">{total}</td>
        <td className="px-4 py-2 text-right font-mono text-muted-foreground">{user.daily_spent_credits}</td>
        <td className="px-4 py-2 text-right font-mono text-muted-foreground text-xs">
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
        <UserExpandedRow user={user} onCreditsAdjusted={onCreditsAdjusted} adminUserId={currentUserId} />
      )}
    </>
  )
}
