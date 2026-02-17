import { useEffect, useState, useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  Coins,
  CreditCard,
  Crown,
  ExternalLink,
  Calendar,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  HardDrive,
  FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/components/credits/CreditBalance"
import { CreditTopup } from "@/components/credits/CreditTopup"
import {
  getSubscription,
  getTransactions,
  getManageSubscriptionUrl,
  type SubscriptionInfo,
  type TransactionRecord,
} from "@/lib/api"
import { PRICING_TIERS, getBillingCycleFromPriceId } from "@/lib/pricing-data"
import { createClient } from "@/lib/supabase"
import { toast } from "sonner"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function BillingPage() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const { balance, isLoading: creditsLoading, refetch: refetchCredits } = useUserCredits(user?.id)

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [subLoading, setSubLoading] = useState(true)
  const [txLoading, setTxLoading] = useState(true)
  const [manageLoading, setManageLoading] = useState(false)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(0)

  const loadBillingData = useCallback(async () => {
    if (!user?.id) return

    setSubLoading(true)
    setTxLoading(true)

    const supabase = createClient()
    const [sub, txs, profileRes] = await Promise.all([
      getSubscription(user.id),
      getTransactions(user.id),
      supabase
        .from("profiles")
        .select("storage_used_bytes, storage_limit_bytes")
        .eq("id", user.id)
        .single(),
    ])

    setSubscription(sub)
    setSubLoading(false)
    setTransactions(txs)
    setTxLoading(false)

    if (profileRes.data) {
      setStorageUsed(profileRes.data.storage_used_bytes ?? 0)
      setStorageLimit(profileRes.data.storage_limit_bytes ?? 0)
    }
  }, [user?.id])

  useEffect(() => {
    loadBillingData()
  }, [loadBillingData])

  // Handle success redirect from Paddle checkout
  useEffect(() => {
    const isSuccess = searchParams.get("success") === "true"
    const isTopup = searchParams.get("topup") === "true"
    if (isSuccess || isTopup) {
      toast.success(
        isTopup ? "Credits added to your account!" : "Subscription activated!",
      )
      // Refresh data after a short delay to allow webhook processing
      const timer = setTimeout(() => {
        loadBillingData()
        refetchCredits()
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [searchParams, loadBillingData, refetchCredits])

  async function handleManageSubscription() {
    if (!user?.id) return
    setManageLoading(true)
    try {
      const url = await getManageSubscriptionUrl(user.id)
      if (url) {
        window.open(url, "_blank")
      } else {
        toast.error("Unable to open subscription management portal")
      }
    } catch {
      toast.error("Failed to open subscription management")
    } finally {
      setManageLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!hasCredits()) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-muted-foreground">Billing is not available in this edition.</p>
      </div>
    )
  }

  const currentTier = PRICING_TIERS.find((t) => t.id === (balance?.tier ?? "free"))
  const subBillingCycle = getBillingCycleFromPriceId(subscription?.paddle_price_id)
  const displayPrice = currentTier
    ? subBillingCycle === "monthly" ? currentTier.priceMonthly : currentTier.priceAnnual
    : 0

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Success banner */}
      {(searchParams.get("success") === "true" || searchParams.get("topup") === "true") && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700 dark:text-green-400">
            {searchParams.get("topup") === "true"
              ? "Your credit top-up has been processed. Credits will appear shortly."
              : "Your subscription is now active. Welcome aboard!"}
          </p>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription, credits, and payment history.
        </p>
      </div>

      {/* Current Plan Card */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown className="h-5 w-5 text-[#ff0073]" />
            <h2 className="text-lg font-semibold">Current Plan</h2>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "capitalize text-xs",
              subscription?.status === "active" && "bg-green-500/10 text-green-600 dark:text-green-400",
              subscription?.status === "past_due" && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
              subscription?.status === "canceled" && "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {subLoading ? "..." : (subscription?.status ?? "free")}
          </Badge>
        </div>

        {subLoading ? (
          <div className="h-20 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Plan</p>
              <p className="text-lg font-semibold capitalize">
                {currentTier?.name ?? "Free"}
              </p>
              {currentTier && displayPrice > 0 && (
                <p className="text-sm text-muted-foreground">
                  ${displayPrice}/mo{" "}
                  <span className="text-xs">
                    ({subBillingCycle === "annual" ? "billed annually" : "billed monthly"})
                  </span>
                </p>
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Period Ends</p>
              <p className="text-lg font-semibold">
                {subscription?.current_period_end
                  ? new Date(subscription.current_period_end).toLocaleDateString()
                  : "--"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Monthly Credits</p>
              <p className="text-lg font-semibold">
                {currentTier?.credits ?? 50}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Storage</p>
              <p className="text-lg font-semibold">
                {formatBytes(storageLimit)}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          {subscription && subscription.status !== "canceled" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleManageSubscription}
              disabled={manageLoading}
            >
              {manageLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-2" />
              )}
              Manage Subscription
            </Button>
          )}
          <Link to="/pricing">
            <Button
              variant="outline"
              size="sm"
            >
              <ArrowUpRight className="h-4 w-4 mr-2" />
              {subscription ? "Change Plan" : "View Plans"}
            </Button>
          </Link>
        </div>
      </section>

      {/* Credit Balance */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Coins className="h-5 w-5 text-[#ff0073]" />
          <h2 className="text-lg font-semibold">Credit Balance</h2>
        </div>

        {creditsLoading ? (
          <div className="h-16 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : balance ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold font-mono">{balance.total}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Subscription</p>
              <p className="text-2xl font-bold font-mono">{balance.subscription}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Top-up</p>
              <p className="text-2xl font-bold font-mono">{balance.topup}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Used Today</p>
              <p className="text-2xl font-bold font-mono">
                {balance.dailySpent}
                {balance.dailyLimit != null && (
                  <span className="text-sm text-muted-foreground font-normal">
                    /{balance.dailyLimit}
                  </span>
                )}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Unable to load credit balance.</p>
        )}

        <Separator />

        {user && <CreditTopup userId={user.id} userEmail={user.email ?? undefined} />}
      </section>

      {/* Storage */}
      {(() => {
        const usagePercent = storageLimit > 0 ? Math.min(100, Math.round((storageUsed / storageLimit) * 100)) : 0
        return (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-[#ff0073]" />
              <h2 className="text-lg font-semibold">Storage</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Used</p>
                <p className="text-2xl font-bold font-mono">{formatBytes(storageUsed)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Limit</p>
                <p className="text-2xl font-bold font-mono">{formatBytes(storageLimit)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available</p>
                <p className="text-2xl font-bold font-mono">{formatBytes(Math.max(0, storageLimit - storageUsed))}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${usagePercent}%`,
                    backgroundColor: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#3b82f6",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">{usagePercent}% used</p>
            </div>

            <div className="flex justify-end">
              <Link to="/library">
                <Button variant="outline" size="sm">
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Manage Files
                </Button>
              </Link>
            </div>

            {usagePercent > 70 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {usagePercent >= 90 ? "Storage almost full! Upgrade for more space." : "Running low on storage. Consider upgrading."}
                </p>
                <Link to="/pricing">
                  <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    Upgrade
                  </Button>
                </Link>
              </div>
            )}
          </section>
        )
      })()}

      {/* Transaction History */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-[#ff0073]" />
          <h2 className="text-lg font-semibold">Transaction History</h2>
        </div>

        {txLoading ? (
          <div className="h-16 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center",
                    tx.type === "subscription"
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-[#ff0073]/10 text-[#ff0073]",
                  )}>
                    {tx.type === "subscription" ? (
                      <Calendar className="h-4 w-4" />
                    ) : (
                      <Coins className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {tx.type === "subscription" ? `${tx.tier ?? "subscription"} plan` : "Credit top-up"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    ${tx.amount_usd.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    +{tx.credits_granted} credits
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Legal links */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
        <a href="https://scenenode.ai/terms" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Terms of Service
        </a>
        <span>&middot;</span>
        <a href="https://scenenode.ai/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Privacy Policy
        </a>
        <span>&middot;</span>
        <a href="https://scenenode.ai/refund" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Refund Policy
        </a>
      </div>
    </div>
  )
}
