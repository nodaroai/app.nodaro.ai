import { useState } from "react"
import { Loader2, History, Coins, Plus, Minus, HardDrive } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useAdminUserTransactions,
  useAdminUserSubscription,
  useAdminAdjustCreditsMutation,
  useAdminChangeTierMutation,
  useAdminChangeStorageMutation,
  type AdminUser,
} from "@/ee/hooks/queries/use-admin-queries"
import { getScheduledCancelDate } from "@/ee/lib/subscription"
import { UserMessagesSection } from "@/ee/components/admin/user-messages/user-messages-section"
import { UserAccessPanel } from "@/ee/components/admin/user-access/user-access-panel"
import { SignalsDetail } from "@/ee/components/admin/users-linkage/signals-detail"
import type { LinkageCluster, LinkageUser } from "@/ee/components/admin/users-linkage/types"
import { hasCredits } from "@/lib/edition"
import { formatBytes, unitsOrDash, useDeploymentPayerMode } from "./user-admin-helpers"

interface CreditTransaction {
  readonly id: string
  readonly amount: number
  readonly credit_type: "subscription" | "topup"
  readonly source: string
  readonly description: string | null
  readonly balance_after: number
  readonly created_at: string
}

const SOURCE_COLORS: Record<string, string> = {
  usage: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  refund: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  admin_adjustment: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  subscription_renewal: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  one_time_purchase: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  expiry: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const STORAGE_LIMIT_OPTIONS: ReadonlyArray<{ readonly label: string; readonly bytes: number }> = [
  { label: "1 GB (Free)", bytes: 1 * 1024 * 1024 * 1024 },
  { label: "10 GB (Basic)", bytes: 10 * 1024 * 1024 * 1024 },
  { label: "25 GB (Standard)", bytes: 25 * 1024 * 1024 * 1024 },
  { label: "50 GB (Pro)", bytes: 50 * 1024 * 1024 * 1024 },
  { label: "200 GB (Business)", bytes: 200 * 1024 * 1024 * 1024 },
  { label: "500 GB (Enterprise)", bytes: 500 * 1024 * 1024 * 1024 },
]

export function UserExpandedRow({
  user,
  onCreditsAdjusted,
  adminUserId,
  isSuperAdmin,
  columnCount,
  linkage = null,
}: {
  readonly user: AdminUser
  readonly onCreditsAdjusted: () => void
  readonly adminUserId: string
  readonly isSuperAdmin: boolean
  /** The table's column count; the page adds a Signals column when the marking is on. */
  readonly columnCount?: number
  /** The account's claim-time signals and its cluster, when it has them. */
  readonly linkage?: { readonly user: LinkageUser; readonly cluster: LinkageCluster | null; readonly partial: boolean } | null
}) {
  const { data: txResult, isLoading: txLoading } = useAdminUserTransactions(user.id)
  const { data: subInfo } = useAdminUserSubscription(user.id)
  const scheduledCancelDate = getScheduledCancelDate(subInfo)
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

  const { payerMode } = useDeploymentPayerMode()

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

  const total = (user.subscription_credits ?? 0) + (user.topup_credits ?? 0)
  const subPercent = total > 0 ? ((user.subscription_credits ?? 0) / total) * 100 : 0

  return (
    <tr>
      <td colSpan={columnCount ?? (payerMode ? 10 : 11)} className="px-4 py-4 bg-muted/30">
        {linkage && <SignalsDetail user={linkage.user} cluster={linkage.cluster} partial={linkage.partial} />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Credit Management */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Coins className="h-4 w-4" />
              {payerMode ? "Allowance" : "Credit Management"}
            </div>

            {/* Balance breakdown. Under a payer the deployment's credits are
                not this admin's business and the server does not send them;
                the user's deployment allowance takes their place, read-only. */}
            {payerMode ? (
              <div className="border rounded-lg p-3 bg-card space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Granted</span>
                  <span className="font-mono font-medium">{unitsOrDash(user.sai_granted)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="font-mono font-medium">{unitsOrDash(user.sai_remaining)}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-mono font-medium">{unitsOrDash(user.sai_spent)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Read-only. Allowances are granted by the deployment&apos;s billing account.
                </p>
              </div>
            ) : (
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
            )}

            {/* Subscription status (incl. scheduled cancellation) */}
            {subInfo && (
              <div className="border rounded-lg p-3 bg-card space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subscription</span>
                  <span className="font-medium capitalize">
                    {subInfo.tier} · {subInfo.status}
                  </span>
                </div>
                {scheduledCancelDate ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cancels on</span>
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {new Date(scheduledCancelDate).toLocaleDateString()}
                    </span>
                  </div>
                ) : subInfo.status === "active" && subInfo.current_period_end ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Renews</span>
                    <span className="font-medium">
                      {new Date(subInfo.current_period_end).toLocaleDateString()}
                    </span>
                  </div>
                ) : null}
              </div>
            )}

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

            {/* Adjust form. Absent under a payer: an admin cannot move the
                deployment's credits, and cannot grant an allowance either —
                `grant_deployment_allowance` refuses any actor that is not the
                billing account. A control that always fails is worse than
                none. */}
            {!payerMode && (
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
            )}

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

          {/* Right: access controls, then transactions */}
          <div className="space-y-4">
            <UserAccessPanel
              user={user}
              isSuperAdmin={isSuperAdmin}
              showFreeCredits={hasCredits() && !payerMode}
              onChanged={onCreditsAdjusted}
            />

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

        {/* Full width: admin -> user email, and the shared log of everything
            any admin has already said to this person. */}
        <div className="mt-6 border-t pt-4">
          <UserMessagesSection userId={user.id} userEmail={user.email} />
        </div>
      </td>
    </tr>
  )
}
