import type { CSSProperties, ReactNode } from "react"
import { Loader2 } from "lucide-react"
import type { TransactionRecord, UserBalance } from "@/lib/api"
import { AutoRechargeCard } from "@/ee/components/credits/AutoRechargeCard"
import { BuyPacksSection } from "./BuyPacksSection"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import {
  CYAN,
  CYAN_BADGE_TEXT,
  CYAN_TEXT,
  PINK,
  formatCredits,
  formatShortDate,
  mutedParagraph,
  sectionCardSpaced,
  sectionIcon,
  sectionTitle,
  statLabel,
} from "./billing-styles"

interface CreditBalanceCardProps {
  balance: UserBalance | undefined
  creditsLoading: boolean
  transactions: readonly TransactionRecord[]
  showAutoRecharge: boolean
}

const bucketBottomRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginTop: 10,
  fontSize: 12,
  color: "var(--blg-t2-dim)",
}

interface BalanceBucketProps {
  accent: string
  borderColor: string
  background: string
  labelColor: string
  label: string
  badge: string
  badgeColor: string
  badgeBackground: string
  amount: number
  amountSuffix: string
  barBackground: string
  barPercent: number
  footerLeft: ReactNode
  footerRight: ReactNode
}

/** One of the two split balance buckets (SUBSCRIPTION / TOP-UP) from the mock. */
function BalanceBucket(props: BalanceBucketProps) {
  return (
    <div
      style={{
        border: `1px solid ${props.borderColor}`,
        borderRadius: 14,
        background: props.background,
        padding: "20px 22px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: 3,
          background: props.accent,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 99,
              background: props.accent,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: props.labelColor,
            }}
          >
            {props.label}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: props.badgeColor,
            background: props.badgeBackground,
            borderRadius: 99,
            padding: "4px 10px",
          }}
        >
          {props.badge}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginTop: 14,
        }}
      >
        <span
          style={{
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: "-0.035em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatCredits(creditUnits(props.amount))}
        </span>
        <span style={{ fontSize: 13, color: "var(--blg-t2-soft)" }}>{props.amountSuffix}</span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 99,
          background: props.barBackground,
          marginTop: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${props.barPercent}%`,
            height: "100%",
            background: props.accent,
          }}
        />
      </div>
      <div style={bucketBottomRow}>
        <span>{props.footerLeft}</span>
        <span>{props.footerRight}</span>
      </div>
    </div>
  )
}

function renewalText(periodEnd: string | null): string {
  if (!periodEnd) return ""
  const msLeft = new Date(periodEnd).getTime() - Date.now()
  const days = Math.max(0, Math.ceil(msLeft / 86_400_000))
  if (days === 0) return "Renews today"
  return `Renews in ${days} ${days === 1 ? "day" : "days"}`
}

function BalanceSection({
  balance,
  creditsLoading,
  transactions,
}: Omit<CreditBalanceCardProps, "showAutoRecharge">) {
  const total = balance?.total ?? 0
  const subscriptionCredits = balance?.subscription ?? 0
  const topup = balance?.topup ?? 0
  const allocation = balance?.monthlyAllocation ?? 0
  const usedThisCycle =
    allocation > 0 ? Math.max(0, allocation - subscriptionCredits) : null
  // Cycle start ≈ periodEnd minus one month; burn = cycle spend / days elapsed.
  const avgDailyBurn = (() => {
    if (usedThisCycle === null || !balance?.periodEnd) return null
    const end = new Date(balance.periodEnd)
    const start = new Date(end)
    start.setMonth(start.getMonth() - 1)
    const daysElapsed = Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000))
    return Math.round(usedThisCycle / daysElapsed)
  })()
  const subPercent =
    allocation > 0
      ? Math.min(100, Math.max(0, (subscriptionCredits / allocation) * 100))
      : 0

  const lastTopupTx = [...transactions]
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .find((tx) => tx.type === "topup")

  return (
    <section style={sectionCardSpaced}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={sectionIcon}>◎</span>
          <h2 style={sectionTitle}>Credit Balance</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--blg-t2-dim)", letterSpacing: "0.06em" }}>
            TOTAL REMAINING
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatCredits(creditUnits(total))}
          </div>
        </div>
      </div>
      <p style={{ ...mutedParagraph, margin: "0 0 22px", maxWidth: 620 }}>
        Subscription credits are spent first each month. Top-up credits are used only
        once the subscription pool runs out.
      </p>

      {creditsLoading && !balance ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <BalanceBucket
              accent={PINK}
              borderColor="var(--blg-pink-border)"
              background="var(--blg-pink-bg)"
              labelColor="var(--blg-pink-text)"
              label="SUBSCRIPTION"
              badge={allocation > 0 ? "resets monthly" : "one-time grant"}
              badgeColor="var(--blg-pink-badge-text)"
              badgeBackground="var(--blg-pink-chip)"
              amount={subscriptionCredits}
              amountSuffix={
                allocation > 0 ? `of ${formatCredits(creditUnits(allocation))} left` : `${creditUnitLabel("credits")} left`
              }
              barBackground="var(--blg-pink-track)"
              barPercent={subPercent}
              footerLeft={
                usedThisCycle !== null
                  ? `${formatCredits(creditUnits(usedThisCycle))} used this cycle`
                  : "No monthly allocation"
              }
              footerRight={allocation > 0 ? renewalText(balance?.periodEnd ?? null) : ""}
            />
            <BalanceBucket
              accent={CYAN}
              borderColor="var(--blg-cyan-border)"
              background="var(--blg-cyan-bg)"
              labelColor={CYAN_TEXT}
              label="TOP-UP"
              badge="valid 12 months"
              badgeColor={CYAN_BADGE_TEXT}
              badgeBackground="var(--blg-cyan-chip)"
              amount={topup}
              amountSuffix={`${creditUnitLabel("credits")} banked`}
              barBackground="var(--blg-cyan-track)"
              barPercent={topup > 0 ? 100 : 0}
              footerLeft={
                lastTopupTx
                  ? `Last purchase ${formatShortDate(lastTopupTx.created_at)} · ${formatCredits(creditUnits(lastTopupTx.credits_granted))}`
                  : ""
              }
              footerRight="Used after subscription"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 24,
              borderTop: "1px solid var(--blg-border-2)",
              marginTop: 24,
              paddingTop: 20,
            }}
          >
            <div>
              <div style={statLabel}>Used today</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {formatCredits(creditUnits(balance?.dailySpent ?? 0))}
              </div>
            </div>
            <div>
              <div style={statLabel}>Used this cycle</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {usedThisCycle !== null ? formatCredits(creditUnits(usedThisCycle)) : "—"}
              </div>
            </div>
            <div>
              <div style={statLabel}>Avg. daily burn</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {avgDailyBurn !== null ? formatCredits(creditUnits(avgDailyBurn)) : "—"}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * The mock's "Credit Balance" + "Buy Credit Packs" + "Auto-recharge" section
 * cards. AutoRechargeCard is the existing component (dirty-state save bar and
 * all) — only its wrapper is restyled to the mock's card chrome; it renders
 * null until its config loads, so the wrapper hides itself while empty.
 */
export function CreditBalanceCard({
  balance,
  creditsLoading,
  transactions,
  showAutoRecharge,
}: CreditBalanceCardProps) {
  // Buying packs and auto-recharge both charge a card for the platform's
  // credits — withheld on a deployment without self-serve purchase (a prepaid
  // instance). The balance section stays.
  const selfServe = surfaceBillingSelfServe()
  return (
    <>
      <BalanceSection
        balance={balance}
        creditsLoading={creditsLoading}
        transactions={transactions}
      />
      {selfServe && <BuyPacksSection />}
      {selfServe && showAutoRecharge && (
        <section style={sectionCardSpaced} className="empty:hidden">
          <AutoRechargeCard />
        </section>
      )}
    </>
  )
}
