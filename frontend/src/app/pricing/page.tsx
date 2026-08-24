import { useState, useEffect, useRef } from "react"
import { hasCredits } from "@/lib/edition"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import {
  PRICING_TIERS,
  getTierPrice,
  getTierPriceId,
  getAnnualSavingsDollars,
  type BillingCycle,
} from "@/lib/pricing-data"
import { startCheckout, startLoadCheckout } from "@/lib/checkout"
import { toast } from "sonner"
import { useSubscription, useChangePlanMutation } from "@/ee/hooks/queries/use-billing-queries"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { TopupSection } from "./topup-section"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * Theme-aware pricing page, ported 1:1 from the designer's Pricing mocks
 * (dark: sister folder `Pricing/`; light: pricing-lite, 2026-08-12). Colors
 * resolve through the `--blg-*` / `--prc-*` tokens in globals.css (`:root` =
 * light values from the lite mock, `.dark` = the original dark constants),
 * so the page follows the app theme.
 */

const PINK = "var(--blg-pink)"
const CYAN = "var(--blg-cyan)"
const MONO = "'JetBrains Mono Variable','JetBrains Mono',monospace"

/** Audience lines from the mock's plan data, keyed by tier id. */
const TIER_AUDIENCE_KEY: Record<string, MessageKey> = {
  basic: "pricing.audience.basic",
  standard: "pricing.audience.standard",
  pro: "pricing.audience.pro",
  business: "pricing.audience.business",
}

/** Credits get their own mono line on the card, so drop the feature restating them. */
const CREDITS_FEATURE_RE = /^\d[\d,]* credits \/ month/

interface SectionHeaderRowProps {
  readonly dotColor: string
  readonly labelColor: string
  readonly label: string
  readonly note: string
  readonly margin: string
}

/** "● LABEL  note ————" section-header row from the mock. */
function SectionHeaderRow({ dotColor, labelColor, label, note, margin }: SectionHeaderRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: dotColor }} />
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", color: labelColor }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--blg-t3-note)" }}>{note}</span>
      <span style={{ flex: 1, height: 1, background: "var(--prc-rule)" }} />
    </div>
  )
}

export default function PricingPage() {
  const t = useT()

  // Editions without billing have nothing to sell here — and the ?plan=
  // effect below auto-starts a Stripe checkout with no click, which 404s on a
  // self-host and surfaces as a bare "Not Found" toast (community grind,
  // 2026-08-13). Every other billing surface self-gates the same way.
  if (!hasCredits()) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-xl font-semibold">{t("pricing.notPartOfEdition")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("pricing.selfHostNotice")}
        </p>
      </div>
    )
  }

  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual")
  const [searchParams] = useSearchParams()
  const autoCheckoutTriggered = useRef(false)

  const { data: subscription, isLoading: subLoading } = useSubscription(user?.id)
  const changePlanMutation = useChangePlanMutation()
  const { data: creditBalance } = useUserCredits(user?.id)
  const [loadingTopup, setLoadingTopup] = useState(false)

  async function handleLoadCredits(amountUsd: number) {
    if (!user) {
      navigate("/login?redirect=/pricing")
      return
    }
    setLoadingTopup(true)
    try {
      await startLoadCheckout(amountUsd)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pricing.failedOpenCheckout"))
      setLoadingTopup(false)
    }
  }

  // Derive current tier from active subscription
  const isActiveSub = subscription &&
    (subscription.status === "active" || subscription.status === "past_due")
  const currentTierId = isActiveSub
    ? PRICING_TIERS.find(
        (t) =>
          t.priceIdAnnual === subscription.stripe_price_id ||
          t.priceIdMonthly === subscription.stripe_price_id,
      )?.id ?? null
    : null

  // Auto-open Stripe checkout when redirected from login with ?plan= param
  useEffect(() => {
    if (authLoading || subLoading || autoCheckoutTriggered.current) return
    const planParam = searchParams.get("plan")
    if (!planParam || !user || isActiveSub) return

    const tier = PRICING_TIERS.find((t) => t.id === planParam)
    if (!tier) return

    const priceId = getTierPriceId(tier, billingCycle)
    if (!priceId) return

    autoCheckoutTriggered.current = true
    handleSubscribe(tier.id, priceId)
  }, [authLoading, subLoading, user, isActiveSub, searchParams, billingCycle])

  // Whether any paid tier has annual savings (for the toggle badge)
  const hasAnnualSavings = PRICING_TIERS.some((t) => t.priceMonthly > 0 && t.priceAnnual < t.priceMonthly)

  async function handleSubscribe(tierId: string, priceId: string | null) {
    if (!priceId) {
      navigate("/projects")
      return
    }

    if (!user) {
      navigate(`/login?plan=${tierId}`)
      return
    }

    setLoadingTier(tierId)
    try {
      if (isActiveSub) {
        await changePlanMutation.mutateAsync({ userId: user.id, priceId })
        toast.success(t("pricing.planChanged"))
        navigate("/billing?success=true")
      } else {
        // New subscription → Stripe Checkout (opens in a new tab when embedded,
        // since Stripe can't be iframed). See startCheckout.
        await startCheckout({ priceId, mode: "subscription" })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("pricing.somethingWentWrong")
      toast.error(message)
    } finally {
      setLoadingTier(null)
    }
  }

  function getButtonLabel(tierId: string): string {
    if (loadingTier === tierId) return t("pricing.processing")
    if (tierId === currentTierId) return t("pricing.currentPlan")
    if (currentTierId) return t("pricing.switchPlan")
    return PRICING_TIERS.find((tr) => tr.id === tierId)?.cta ?? t("pricing.cta.subscribe")
  }

  const annual = billingCycle === "annual"
  const paidTiers = PRICING_TIERS.filter((t) => t.priceMonthly > 0)
  const freeTier = PRICING_TIERS.find((t) => t.id === "free")

  // "You're on X" — effective tier from the balance endpoint (covers free,
  // payg, and subscribed states); hidden while signed out / not loaded.
  const effectiveTier = creditBalance?.effectiveTier
  const currentPlanName = effectiveTier
    ? PRICING_TIERS.find((t) => t.id === effectiveTier)?.name ??
      effectiveTier.charAt(0).toUpperCase() + effectiveTier.slice(1)
    : null

  return (
    <div className="min-h-full" style={{ background: "var(--prc-bg)", color: "var(--blg-t1)" }}>
      <div className="px-5 pt-10 pb-16 sm:px-14 sm:pt-14 sm:pb-[90px]">
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {/* Header: title + billing-cycle toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 32,
              flexWrap: "wrap",
              marginBottom: 34,
            }}
          >
            <div>
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>
                {t("pricing.pageTitle")}
              </h1>
              <p style={{ fontSize: 15, color: "var(--blg-t2)", margin: "8px 0 0", maxWidth: 560 }}>
                {currentPlanName && (
                  <>
                    {t("pricing.onPlanPrefix")}{" "}
                    <span style={{ color: "var(--blg-t1)", fontWeight: 600 }}>{currentPlanName}</span>
                    {t("pricing.onPlanSuffix")}{" "}
                  </>
                )}
                {t("pricing.subscribeSubtitle")}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  color: annual ? "var(--blg-t2-dim)" : "var(--blg-t1)",
                }}
              >
                {t("pricing.monthly")}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={annual}
                aria-label={t("pricing.billAnnuallyAria")}
                onClick={() => setBillingCycle(annual ? "monthly" : "annual")}
                style={{
                  width: 52,
                  height: 28,
                  borderRadius: 99,
                  border: "none",
                  cursor: "pointer",
                  padding: 3,
                  display: "flex",
                  justifyContent: annual ? "flex-end" : "flex-start",
                  background: annual ? PINK : "var(--prc-toggle-off)",
                  transition: "background .2s",
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 99, background: "#fff", display: "block" }} />
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("annual")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  color: annual ? "var(--blg-t1)" : "var(--blg-t2-dim)",
                }}
              >
                {t("pricing.annual")}
              </button>
              {hasAnnualSavings && (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    color: "var(--prc-pink-strong)",
                    border: "1px solid var(--prc-pink-border)",
                    background: "var(--prc-pink-chip)",
                    borderRadius: 99,
                    padding: "5px 11px",
                  }}
                >
                  {t("pricing.twoMonthsFreeBadge")}
                </span>
              )}
            </div>
          </div>

          {/* SUBSCRIPTION PLANS */}
          <SectionHeaderRow
            dotColor={PINK}
            labelColor="var(--blg-pink-text)"
            label={t("pricing.subscriptionPlansLabel")}
            note={t("pricing.subscriptionPlansNote")}
            margin="0 0 16px"
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
              gap: 18,
              alignItems: "stretch",
            }}
          >
            {paidTiers.map((tier) => {
              const isPopular = !!tier.highlighted
              const displayPrice = getTierPrice(tier, billingCycle)
              const priceId = getTierPriceId(tier, billingCycle)
              const savingsDollars = getAnnualSavingsDollars(tier)
              const disabled = tier.id === currentTierId || loadingTier === tier.id || subLoading
              const cardFeatures = tier.features.filter((f) => !CREDITS_FEATURE_RE.test(f))

              return (
                <div
                  key={tier.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "28px 26px 26px",
                    borderRadius: 18,
                    position: "relative",
                    ...(isPopular
                      ? {
                          border: `1px solid ${PINK}`,
                          background: "var(--prc-pop-bg)",
                          boxShadow: "var(--prc-pop-shadow)",
                        }
                      : {
                          border: "1px solid var(--prc-card-border)",
                          background: "var(--prc-card-bg)",
                        }),
                  }}
                >
                  {isPopular && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        letterSpacing: "0.16em",
                        color: PINK,
                        marginBottom: 14,
                        display: "block",
                      }}
                    >
                      {t("pricing.mostPopularBadge")}
                    </span>
                  )}
                  <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.02em" }}>{tier.name}</div>
                  <div style={{ fontSize: 13, color: "var(--blg-t2-dim)", marginTop: 5 }}>
                    {TIER_AUDIENCE_KEY[tier.id] ? t(TIER_AUDIENCE_KEY[tier.id]) : ""}
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 26 }}>
                    {annual && (
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "var(--prc-strike)",
                          textDecoration: "line-through",
                        }}
                      >
                        ${tier.priceMonthly}
                      </span>
                    )}
                    <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.04em" }}>
                      ${displayPrice}
                    </span>
                    <span style={{ fontSize: 14, color: "var(--blg-t2)" }}>{t("pricing.perMonthShort")}</span>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: "0.06em", marginTop: 10 }}>
                    <span style={{ color: PINK, fontWeight: 700 }}>{tier.credits.toLocaleString()}</span>
                    <span style={{ color: "var(--blg-t2-mono)" }}> {t("pricing.creditsPerMoBadge")}</span>
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      color: "var(--blg-t3)",
                      marginTop: 5,
                    }}
                  >
                    {annual
                      ? t("pricing.perYearSaveBadge", { amount: tier.priceAnnual * 12, savings: savingsDollars })
                      : t("pricing.billedMonthlyBadge")}
                  </div>

                  <div style={{ height: 1, background: "var(--prc-divider)", margin: "22px 0 20px" }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1 }}>
                    {cardFeatures.map((f) => (
                      <div
                        key={f}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          fontSize: 13.5,
                          color: "var(--blg-t1-body)",
                        }}
                      >
                        <span style={{ color: PINK, fontSize: 13, lineHeight: 1.4 }}>✓</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSubscribe(tier.id, priceId)}
                    style={{
                      marginTop: 24,
                      width: "100%",
                      fontFamily: "inherit",
                      fontSize: 14,
                      fontWeight: 700,
                      padding: 14,
                      borderRadius: 11,
                      cursor: disabled ? "default" : "pointer",
                      ...(isPopular
                        ? { background: PINK, border: "none", color: "#fff" }
                        : {
                            background: "transparent",
                            border: "1px solid var(--prc-border-strong)",
                            color: "var(--blg-t1-btn)",
                          }),
                      ...(disabled ? { opacity: 0.55 } : {}),
                    }}
                  >
                    {getButtonLabel(tier.id)}
                  </button>
                </div>
              )
            })}
          </div>

          {/* FREE TIER strip — acquisition pitch for guests; "you're on this
              plan" for signed-in free/payg; hidden for paid subscribers. */}
          {freeTier && !currentTierId && (
            <div
              style={{
                border: "1px dashed var(--prc-border-strong)",
                borderRadius: 16,
                padding: "24px 28px",
                marginTop: 18,
                display: "flex",
                alignItems: "center",
                gap: 28,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 340 }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: "0.16em",
                    color: "var(--prc-pink-strong)",
                    marginBottom: 9,
                  }}
                >
                  {t("pricing.freeTierBadge")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {user ? (
                    <>
                      {t("pricing.onThisPlanPrefix")}{" "}
                      <span style={{ fontWeight: 800 }}>
                        {t("pricing.freeCreditsCount", { credits: freeTier.credits.toLocaleString() })}
                      </span>{" "}
                      {t("pricing.includedAtSignup")}
                    </>
                  ) : (
                    <>
                      {t("pricing.tryEverythingPrefix")}{" "}
                      <span style={{ fontWeight: 800 }}>
                        {t("pricing.freeCreditsCount", { credits: freeTier.credits.toLocaleString() })}
                      </span>{" "}
                      {t("pricing.noCreditCardSuffix")}
                    </>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: "var(--blg-t3-dim)",
                    marginTop: 10,
                  }}
                >
                  {freeTier.features.join(" · ").toUpperCase()}
                </div>
              </div>
              {user ? (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    color: "var(--prc-pink-strong)",
                    border: "1px solid var(--prc-pink-border)",
                    background: "var(--prc-pink-chip)",
                    borderRadius: 99,
                    padding: "9px 18px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {t("pricing.currentPlanBadge")}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={loadingTier === "free" || subLoading}
                  onClick={() => handleSubscribe("free", null)}
                  className="bg-transparent border border-[var(--blg-pink)] text-[var(--blg-pink)] hover:bg-[var(--blg-pink)] hover:text-white"
                  style={{
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 700,
                    padding: "13px 34px",
                    borderRadius: 11,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    ...(loadingTier === "free" || subLoading ? { opacity: 0.55, cursor: "default" } : {}),
                  }}
                >
                  {getButtonLabel("free")}
                </button>
              )}
            </div>
          )}

          {/* TOP-UP CREDITS — header row from the mock; the card below keeps the
              founder's amended design (TopupSection). */}
          <SectionHeaderRow
            dotColor={CYAN}
            labelColor="var(--prc-cyan-text)"
            label={t("pricing.topupCreditsLabel")}
            note={t("pricing.topupCreditsNote")}
            margin="46px 0 16px"
          />
          <TopupSection
            topupBalance={user ? creditBalance?.topup : undefined}
            loading={loadingTopup}
            onLoad={handleLoadCredits}
          />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t("pricing.topupDeveloperNotice")}
          </p>

          {/* Legal links */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 22,
              marginTop: 44,
              fontSize: 12.5,
              color: "var(--blg-t3-dim)",
            }}
          >
            <a
              href="https://nodaro.ai/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--blg-t2-dim)", textDecoration: "none" }}
            >
              {t("pricing.terms")}
            </a>
            <span>·</span>
            <a
              href="https://nodaro.ai/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--blg-t2-dim)", textDecoration: "none" }}
            >
              {t("pricing.privacy")}
            </a>
            <span>·</span>
            <a
              href="https://nodaro.ai/refund"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--blg-t2-dim)", textDecoration: "none" }}
            >
              {t("pricing.refund")}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
