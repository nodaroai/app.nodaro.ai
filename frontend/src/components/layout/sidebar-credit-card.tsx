import { useNavigate } from "react-router-dom"
import { useT, tx } from "@/lib/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { surfaceBillingSelfServe, surfaceSidebarCreditCardHidden } from "@/lib/surface-selectors"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"
import { spendableCredits, type BalanceWithAllowance, type CreditAllowance } from "@/lib/spendable-credits"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { formatDate, formatNumber } from "@/lib/i18n/format"

/** Mono stack for the credit block, from the designer's Pricing mock. */
const MONO_FONT = "'JetBrains Mono Variable','JetBrains Mono',monospace"

function formatRenewalTime(periodEnd: string): string | null {
  const msLeft = new Date(periodEnd).getTime() - Date.now()
  if (msLeft <= 0) return null  // stale date — don't show misleading text
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
  if (daysLeft < 1) {
    const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60))
    if (hoursLeft >= 1) return tx(hoursLeft !== 1 ? "nav.renewal.hours" : "nav.renewal.hour", { n: hoursLeft })
    const minutesLeft = Math.floor(msLeft / (1000 * 60))
    if (minutesLeft >= 1) return tx(minutesLeft !== 1 ? "nav.renewal.minutes" : "nav.renewal.minute", { n: minutesLeft })
    return tx("nav.renewal.lessThanMinute")
  }
  if (daysLeft <= 14) return tx(daysLeft !== 1 ? "nav.renewal.days" : "nav.renewal.day", { n: daysLeft })
  return formatDate(periodEnd, { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Track A (D12, ruling R-A) — which figures the sidebar credit card renders.
 *
 * Extracted and exported so the decision is testable on its own: rendering
 * the whole sidebar needs a router, an auth session and four query hooks, and
 * a money figure should not be guarded only by a test that heavy.
 *
 * Under a deployment payer the requester's `total` is a FROZEN signup grant —
 * nothing debits it and nothing tops it up — so un-hiding the card as-is would
 * put a lie on screen permanently. The allowance is the number that WILL fall
 * as they generate once enforcement is on, and the one the billing account's
 * top-up lever actually moves, so it wins whenever the server sent one.
 *
 * THIS IS A DISPLAY, NOT A GATE, and that is why it takes `displayFigure`
 * rather than the `figure` the canvas precheck compares against. Under R-A the
 * allowance is VISIBLE from the moment a payer exists and only BINDS after the
 * `billing.allowances` flip; the card shows it through both windows, because
 * showing the frozen grant instead would be the lie this card was un-hidden to
 * stop telling. Only a refusal needs the enforcement bit — and in the window
 * where it is off, no client refuses at all (`gateApplies`), which is why every
 * other screen quotes this same figure.
 *
 * `null` and absent behave identically and mean "no allowance applies": the
 * caller IS the payer (D13 — it holds the real credits, not an allocation), or
 * the figure was unavailable. Both fall back to `total`, which for the payer is
 * a live wallet — reading null as "remaining 0" would render a zero balance for
 * the account that owns the pool.
 *
 * Everything here is RAW credits; `creditUnits` converts at render.
 */
export interface SidebarCreditFigures {
  readonly external?: boolean
  readonly unavailable?: boolean
  /** The headline figure, raw credits. */
  readonly headline: number
  /** Non-null only when a per-user allowance applies. */
  readonly allowance: CreditAllowance | null
}

export function sidebarCreditFigures(
  balance: BalanceWithAllowance,
  deploymentPayer: boolean,
): SidebarCreditFigures {
  // `deploymentPayer` reaches `spendableCredits` because that helper requires
  // every caller to have ASKED whether this is a payer instance — it is the
  // fact that separates the two meanings of `allowance: null`. It moves
  // `gateApplies` alone, which this card does not read: a display never
  // refuses, and passing the flag is what keeps that a decision rather than an
  // omission.
  const { displayFigure, allowance } = spendableCredits(balance, deploymentPayer)
  return { headline: displayFigure, allowance,
    ...(balance.externalWallet ? { external: true, unavailable: balance.externalWallet.available === null } : {}) }
}

/**
 * One pool inside the sidebar credit card: label and amount on a line, a thin
 * bar under them, and the expiry note below.
 *
 * The label and the amount sit on the SAME line on purpose — that is what frees
 * the full card width for the note underneath, which is what was being clipped
 * when the two pools were side-by-side columns.
 */
function CreditRow({
  label,
  value,
  pct,
  fill,
  subline,
}: {
  readonly label: string
  readonly value: number
  readonly pct: number
  readonly fill: string
  readonly subline: string | null
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--blg-t2-label)", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--blg-t1)", fontVariantNumeric: "tabular-nums" }}>
          {formatNumber(creditUnits(value))}
        </span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "var(--blg-track)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: 3, borderRadius: 2, background: fill }} />
      </div>
      {subline && <span style={{ fontSize: 11, color: "var(--blg-t3-head)" }}>{subline}</span>}
    </div>
  )
}

interface SidebarCreditCardProps {
  readonly isCollapsed: boolean
  readonly isRtl: boolean
}

/**
 * The sidebar's credit card: a compact meter when the rail is collapsed, the
 * designer's gradient card when expanded. A deployment surface can suppress it
 * wholesale (billing.sidebarCard "hidden") — a prepaid instance whose users
 * read their balance on /usage instead.
 */
export function SidebarCreditCard({ isCollapsed, isRtl }: SidebarCreditCardProps) {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: creditBalance } = useUserCredits(user?.id)
  // Track A — resolved once for both card layouts (see sidebarCreditFigures).
  // Deployment grain ("does this instance have a payer"), not "is that me".
  // Same query key as the probe's own surface read, so this costs no extra request.
  const { surface: billingSurface } = useBillingSurface()
  const creditFigures = creditBalance
    ? sidebarCreditFigures(creditBalance, billingSurface.deploymentPayer === true)
    : null
  // Self-serve purchase off (a prepaid instance): the credit card is a plain
  // readout — no hop to /billing.
  const selfServe = surfaceBillingSelfServe()

  if (!(hasCredits() && creditBalance && creditFigures && !surfaceSidebarCreditCardHidden())) return null

  if (isCollapsed) {
    return (
      <div className="px-2 pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={selfServe ? () => navigate("/billing") : undefined}
              className={cn(
                "w-full flex flex-col items-center gap-1.5",
                selfServe && "hover:opacity-90 transition-opacity",
              )}
              style={{
                padding: "10px 6px",
                borderRadius: 12,
                border: "1px solid var(--blg-border-3)",
                background: "var(--blg-card)",
                cursor: selfServe ? undefined : "default",
              }}
            >
              <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--blg-t1)" }}>
                {creditFigures.unavailable ? "—" : creditUnits(creditFigures.headline) >= 1000
                  ? `${(creditUnits(creditFigures.headline) / 1000).toFixed(1).replace(/\.0$/, "")}K`
                  : creditUnits(creditFigures.headline)}
              </span>
              <span className="flex flex-col gap-[3px] w-full px-1">
                {creditFigures.external ? null : creditFigures.allowance ? (
                  // One pot, one bar: the subscription/top-up split is a
                  // personal-wallet shape and has no meaning against an
                  // allocation the operator granted.
                  <span
                    style={{
                      display: "block",
                      height: 4,
                      borderRadius: 99,
                      background: "var(--blg-pink)",
                      width: `${creditFigures.allowance.granted > 0 ? Math.max(12, (creditFigures.allowance.remaining / creditFigures.allowance.granted) * 100) : 12}%`,
                    }}
                  />
                ) : (
                  <>
                    <span
                      style={{
                        display: "block",
                        height: 4,
                        borderRadius: 99,
                        background: "var(--blg-pink)",
                        width: `${creditBalance.total > 0 ? Math.max(12, (creditBalance.subscription / creditBalance.total) * 100) : 12}%`,
                      }}
                    />
                    <span
                      style={{
                        display: "block",
                        height: 4,
                        borderRadius: 99,
                        background: "var(--blg-cyan)",
                        width: `${creditBalance.total > 0 ? Math.max(12, (creditBalance.topup / creditBalance.total) * 100) : 12}%`,
                      }}
                    />
                  </>
                )}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent
            side={isRtl ? "left" : "right"}
            className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
          >
            <p>{creditFigures.unavailable ? "—" : t("nav.creditsLeft", { n: creditUnits(creditFigures.headline) })}</p>
            {creditFigures.external ? null : creditFigures.allowance ? (
              // The pair is one interpolated key, never a bare "X / Y":
              // the operands invert under RTL and the line then lies.
              <p className="text-zinc-500 dark:text-zinc-400">
                {t("credits.allowanceOfGranted", { granted: formatNumber(creditUnits(creditFigures.allowance.granted)) })}
              </p>
            ) : creditBalance.effectiveTier === "free" ? (
              creditBalance.dailyLimit != null && (
                <p className="text-zinc-500 dark:text-zinc-400">{t("nav.dailyLimitCreditsLeft", { n: creditUnits(Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent)) })}</p>
              )
            ) : creditBalance.periodEnd && formatRenewalTime(creditBalance.periodEnd) ? (
              <p className="text-zinc-500 dark:text-zinc-400">
                {t("nav.renewsAt", { time: formatRenewalTime(creditBalance.periodEnd) ?? "" })}
              </p>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  const tierName = PRICING_TIERS.find((tier) => tier.id === creditBalance.effectiveTier)?.name
  const planLabel = (tierName ?? creditBalance.effectiveTier).toUpperCase()
  const subPct = creditBalance.total > 0 ? (creditBalance.subscription / creditBalance.total) * 100 : 0
  const topupPct = creditBalance.total > 0 ? (creditBalance.topup / creditBalance.total) * 100 : 0
  const dailyLeft = creditBalance.dailyLimit != null
    ? Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent)
    : null
  const isDailyTier = creditBalance.effectiveTier === "free" || creditBalance.effectiveTier === "payg"
  const renewal = creditBalance.periodEnd ? formatRenewalTime(creditBalance.periodEnd) : null
  // "renews" is a PAID-tier fact only — free/payg credits are a
  // one-time signup grant, nothing refreshes (verified 2026-08-12).
  const subscriptionSubline = isDailyTier
    ? dailyLeft != null
      ? t("nav.dailyLeft", { n: creditUnits(dailyLeft) })
      : t("nav.oneTimeGrant")
    : renewal
      ? t("nav.renewsLower", { time: renewal })
      : null

  // Credit block from the designer's Pricing mocks (2026-08-12):
  // gradient card themed via the --blg-* tokens in globals.css
  // (light values from the lite mock, dark = original constants).
  return (
    <div
      className={cn("mx-2 mt-2 text-start", selfServe ? "cursor-pointer" : "cursor-default")}
      style={{
        border: "1px solid var(--blg-border-3)",
        borderRadius: 14,
        background: "var(--blg-card)",
        overflow: "hidden",
        // The sidebar is a flex column, so this card was a shrinkable
        // item: when vertical space got tight it compressed and the
        // `overflow: hidden` above silently cut the bottom row off —
        // TOP-UP's bar and expiry note simply vanished. The nav below
        // scrolls instead (see its min-h-0 + overflow-y-auto).
        flexShrink: 0,
      }}
      onClick={selfServe ? () => navigate("/billing") : undefined}
    >
      <div style={{ padding: "14px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--blg-t2-dim)", fontWeight: 600 }}>
            {creditFigures.allowance ? t("credits.allowanceTitle") : t("nav.totalCredits")}
          </span>
          <span style={{ fontSize: 10, color: "var(--blg-t3-dim)", fontFamily: MONO_FONT }}>
            {planLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              color: "var(--blg-t1)",
            }}
          >
            {creditFigures.unavailable ? "—" : formatNumber(creditUnits(creditFigures.headline))}
          </span>
          <span style={{ fontSize: 13, color: "var(--blg-t2-dim)" }}>{creditUnitLabel(t("nav.credits"))}</span>
        </div>
        {/* Two stacked rows, each with its own bar — replaces the
            side-by-side columns from the first pass. Splitting the
            sidebar's width in two left each subline ~70px and clipped
            "renews Mar 8, 2027"; full-width rows give it the whole
            card. Colours stay on the --blg-* tokens rather than the
            mock's literals so both themes follow. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {creditFigures.external ? null : creditFigures.allowance ? (
            // One row, because there is one pot. The bar tracks what
            // is LEFT of the grant; the headline above already shows
            // the remaining figure, so this row names the total it
            // came out of and nothing repeats.
            <CreditRow
              label={t("credits.allowanceGranted")}
              value={creditFigures.allowance.granted}
              pct={creditFigures.allowance.granted > 0 ? (creditFigures.allowance.remaining / creditFigures.allowance.granted) * 100 : 0}
              fill="var(--blg-pink)"
              subline={null}
            />
          ) : (
            <>
              <CreditRow
                label={t("nav.subscription")}
                value={creditBalance.subscription}
                pct={subPct}
                fill="var(--blg-pink)"
                subline={subscriptionSubline}
              />
              <CreditRow
                label={t("nav.topup")}
                value={creditBalance.topup}
                pct={topupPct}
                fill="var(--blg-cyan)"
                subline={t("nav.validTwelveMonths")}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
