import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import { Calendar, Loader2 } from "lucide-react"
import type { SubscriptionInfo, UserBalance } from "@/lib/api"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { getScheduledCancelDate } from "@/ee/lib/subscription"
import { creditUnits } from "@/lib/credit-units"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import {
  sectionCardSpaced,
  sectionIcon,
  sectionTitle,
  statLabel,
} from "./billing-styles"

interface CurrentPlanCardProps {
  balance: UserBalance | undefined
  subscription: SubscriptionInfo | null | undefined
  subLoading: boolean
  storageLimitBytes: number | undefined
  onManageSubscription: () => void
  managePending: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface PlanStat {
  label: string
  value: string
  accentColor?: string
}

const statValue: CSSProperties = {
  fontSize: 21,
  fontWeight: 700,
  letterSpacing: "-0.02em",
}

const planButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontFamily: "inherit",
  fontSize: 13.5,
  fontWeight: 600,
  padding: "10px 17px",
  borderRadius: 10,
  cursor: "pointer",
}

export function CurrentPlanCard({
  balance,
  subscription,
  subLoading,
  storageLimitBytes,
  onManageSubscription,
  managePending,
}: CurrentPlanCardProps) {
  const effectiveTier = balance?.effectiveTier ?? "free"
  const tierName =
    PRICING_TIERS.find((t) => t.id === effectiveTier)?.name ?? effectiveTier
  const scheduledCancelDate = getScheduledCancelDate(subscription)

  // payg has no paid period — the mock shows an em-dash; the pool's monthly
  // renewal stays visible on the SUBSCRIPTION bucket ("Renews in N days").
  const periodEndsValue =
    effectiveTier === "payg"
      ? "—"
      : balance?.periodEnd
        ? new Date(balance.periodEnd).toLocaleDateString()
        : "--"

  const stats: readonly PlanStat[] = [
    { label: "Plan", value: tierName },
    {
      label: scheduledCancelDate ? "Plan Ends" : "Period Ends",
      value: periodEndsValue,
      ...(scheduledCancelDate ? { accentColor: "#f59e0b" } : {}),
    },
    {
      label: "Credits / month",
      value: creditUnits(balance?.monthlyAllocation ?? 0).toLocaleString("en-US"),
    },
    ...(storageLimitBytes != null && storageLimitBytes > 0
      ? [{ label: "Storage", value: formatBytes(storageLimitBytes) }]
      : []),
  ]

  return (
    <section style={sectionCardSpaced}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={sectionIcon}>♛</span>
          <h2 style={sectionTitle}>Current Plan</h2>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--blg-t1-label)",
            background: "var(--blg-chip)",
            border: "1px solid var(--blg-border-chip)",
            borderRadius: 99,
            padding: "5px 13px",
          }}
        >
          {subLoading ? "..." : tierName}
        </span>
      </div>

      {scheduledCancelDate && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <Calendar className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Your subscription is scheduled to cancel on{" "}
            <strong>{new Date(scheduledCancelDate).toLocaleDateString()}</strong>. You keep
            your plan and remaining credits until then.
          </p>
        </div>
      )}

      {subLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 24,
          }}
        >
          {stats.map((stat) => (
            <div key={stat.label}>
              <div style={{ ...statLabel, marginBottom: 6 }}>{stat.label}</div>
              <div
                style={{
                  ...statValue,
                  ...(stat.accentColor ? { color: stat.accentColor } : {}),
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
        {/* The Stripe portal serves ANY customer — payg users (who have one
            from their first load) use it to change their card and browse
            invoices, so the button shows for them too (Billing-UX). */}
        {((subscription && subscription.status !== "canceled") || effectiveTier === "payg") && (
          <button
            onClick={onManageSubscription}
            disabled={managePending}
            className="bg-[var(--blg-chip)] hover:bg-[var(--blg-chip-hover)] disabled:pointer-events-none disabled:opacity-60"
            style={{
              ...planButton,
              border: "1px solid var(--blg-border-strong)",
              color: "var(--blg-t1-btn)",
            }}
          >
            ↗ {subscription && subscription.status !== "canceled" ? "Manage Subscription" : "Manage Billing"}
          </button>
        )}
        {/* Plan change is a self-serve purchase — withheld when the deployment
            turns self-serve off. */}
        {surfaceBillingSelfServe() && (
          <Link to="/pricing">
            <button
              className="bg-transparent text-[var(--blg-t1-label)] hover:bg-[var(--blg-hover)] hover:text-[var(--blg-t1)] dark:hover:text-white"
              style={{
                ...planButton,
                border: "1px solid var(--blg-border-strong)",
              }}
            >
              ⇅ {subscription ? "Change Plan" : "View Plans"}
            </button>
          </Link>
        )}
      </div>
    </section>
  )
}
