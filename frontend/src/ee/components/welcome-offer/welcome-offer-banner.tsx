import { ArrowRight, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { creditUnits } from "@/lib/credit-units"
import { WelcomeCreditBadge } from "./welcome-credit-badge"
import { useWelcomeOffer, useWelcomeOfferClaim } from "./use-welcome-offer"
import { useWelcomeOfferStore } from "./welcome-offer-store"
import { formatNumber } from "@/lib/i18n/format"

/**
 * The companion banner at the top of the Continue tab. Three states:
 *  - offer:           "Get N free credits" + the CTA. No dismiss — it stays
 *                     until the user claims.
 *  - consent-pending: the account has the credits (extension) but owes the
 *                     email consent; creation is blocked until the CTA.
 *  - claimed:         the one-time "N credits added" strip with "Done".
 *
 * Cloud-only: mounted through `WelcomeOfferBannerSlot`. Renders nothing while
 * the offer is off or the account is settled.
 */
export function WelcomeOfferBanner() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const offer = useWelcomeOffer()
  const { run, pending, failed } = useWelcomeOfferClaim(offer)
  const claimedCredits = useWelcomeOfferStore((s) => s.claimedCredits)
  const dismissClaimed = useWelcomeOfferStore((s) => s.dismissClaimed)

  if (claimedCredits !== null) {
    return (
      <div
        role="status"
        className="mb-6 flex items-center justify-between gap-3 rounded-[14px] border border-[var(--welcome-line)] bg-[var(--welcome-card)] px-5 py-3.5"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          {t("welcome.claimed", { credits: formatNumber(creditUnits(claimedCredits)) })}
        </span>
        <button
          type="button"
          onClick={dismissClaimed}
          className="text-sm font-medium text-[var(--welcome-muted)] underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("welcome.done")}
        </button>
      </div>
    )
  }

  if (!offer.mode) return null

  const pendingConsent = offer.mode === "consent-pending"
  const params = { credits: offer.credits }

  return (
    <div
      role="region"
      aria-label={pendingConsent ? t("welcome.pending.title", params) : t("welcome.banner.title", params)}
      className="mb-6 rounded-[14px] bg-[linear-gradient(120deg,var(--welcome-accent),rgba(108,92,255,0.7)_55%,var(--welcome-line))] p-px shadow-[var(--welcome-banner-shadow)]"
    >
      <div className="flex flex-wrap items-center gap-4 rounded-[13px] bg-[var(--welcome-panel)] px-5 py-4">
        <WelcomeCreditBadge credits={offer.credits} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-foreground">
            {pendingConsent ? t("welcome.pending.title", params) : t("welcome.banner.title", params)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--welcome-muted)]">
            {pendingConsent ? t("welcome.pending.body") : t("welcome.banner.body")}
          </p>
          {failed && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {t("welcome.error")}
            </p>
          )}
        </div>
        <Button
          onClick={() => void run()}
          disabled={pending}
          size="sm"
          className="h-9 rounded-full bg-[var(--welcome-accent)] px-4 text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(255,42,127,0.3)] hover:bg-[var(--welcome-accent)] hover:brightness-110"
        >
          {pendingConsent ? t("welcome.pending.cta") : t("welcome.cta", params)}
          <ArrowRight className={cn("ms-1 h-3.5 w-3.5", isRtl && "rotate-180")} />
        </Button>
      </div>
    </div>
  )
}
