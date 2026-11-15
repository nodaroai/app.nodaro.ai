import { ArrowRight } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/query-keys"
import { spendableCredits } from "@/lib/spendable-credits"
import type { UserBalance } from "@/lib/api"
import { WelcomeCreditBadge } from "./welcome-credit-badge"
import { useWelcomeOffer, useWelcomeOfferClaim } from "./use-welcome-offer"
import { useWelcomeOfferStore } from "./welcome-offer-store"

/**
 * The welcome credits offered again inside the not-enough-credits dialog, in
 * the welcome banner's own words and look (`WelcomeOfferBanner`), so it reads
 * as the same offer. Renders only while the account's credits are unclaimed
 * (`useWelcomeOffer().mode === "offer"`): nothing when the offer is off, the
 * grant was withheld, or the deployment gives no free credits of one's own.
 *
 * The claim runs through `useWelcomeOfferClaim`, which keeps the result
 * handling the popup and the banner share: a failure keeps the button up with
 * `welcome.error`. A settled answer belongs to the ACCOUNT, not to this card:
 * it is recorded in the welcome-offer store (`recordClaimAnswer`), and
 * whichever dialog is open when it lands applies it against its own figures —
 * the dialog's content unmounts when it closes, and a claim can outlive the
 * opening that started it. While one is out, no opening's "yes" is live.
 *
 * The card never marks the welcome pop-up as seen: closing the dialog leaves
 * the offer as it was.
 */
export function WelcomeOfferCard() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()
  const { surface } = useBillingSurface()
  const offer = useWelcomeOffer()
  const { run, pending, failed } = useWelcomeOfferClaim(offer)
  const inFlightFor = useWelcomeOfferStore((s) => s.claimInFlightFor)
  const setInFlightFor = useWelcomeOfferStore((s) => s.setClaimInFlightFor)
  const recordClaimAnswer = useWelcomeOfferStore((s) => s.recordClaimAnswer)

  if (offer.mode !== "offer") return null

  const params = { credits: offer.credits }
  const title = t("welcome.banner.title", params)
  // A "yes" from an earlier opening is still on its way for this account.
  const earlierClaimOut = !pending && userId !== undefined && inFlightFor === userId

  async function claim() {
    if (earlierClaimOut || !userId) return
    setInFlightFor(userId)
    let result: Awaited<ReturnType<typeof run>>
    try {
      result = await run()
    } finally {
      if (useWelcomeOfferStore.getState().claimInFlightFor === userId) setInFlightFor(null)
    }
    // null: it did not go through — the button stays, with the error line.
    if (!result) return
    // The claim refreshed the balance before it resolved. That read counts as
    // the balance only once it says the grant happened; a failed or stale one
    // (still "unclaimed") is no figure at all.
    const balance = queryClient.getQueryData<UserBalance>(queryKeys.credits.balance(userId))
    const fresh = balance?.freeGrantState === "granted" ? spendableCredits(balance, surface.deploymentPayer === true).figure : null
    recordClaimAnswer({ userId, grant: result.grant === "withheld" ? "withheld" : "granted", credits: result.credits, readBack: fresh })
  }

  return (
    <div
      role="region"
      aria-label={title}
      className="rounded-[14px] bg-[linear-gradient(120deg,var(--welcome-accent),var(--welcome-purple)_55%,var(--welcome-line))] p-px shadow-[var(--welcome-banner-shadow)]"
    >
      {/* The row wraps, as the home banner's does, and the "Yes" wraps its
          words inside its column, as the pop-up's does: it is a long
          sentence in Portuguese and Japanese, and a one-line pill that cannot
          shrink widened the whole dialog past a phone's edge. */}
      <div className="flex flex-wrap items-start gap-4 rounded-[13px] bg-[var(--welcome-panel)] px-4 py-4">
        <WelcomeCreditBadge credits={offer.credits} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--welcome-muted)]">{t("welcome.banner.body")}</p>
          <Button
            onClick={() => void claim()}
            disabled={pending || earlierClaimOut}
            size="sm"
            className="mt-3 h-auto min-h-9 max-w-full shrink whitespace-normal rounded-full bg-[var(--welcome-accent)] px-4 py-2 text-[13px] font-bold leading-snug text-white hover:bg-[var(--welcome-accent)] hover:brightness-110"
          >
            {t("welcome.cta", params)}
            <ArrowRight className={cn("ms-1 h-3.5 w-3.5", isRtl && "rotate-180")} />
          </Button>
          {failed && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {t("welcome.error")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
