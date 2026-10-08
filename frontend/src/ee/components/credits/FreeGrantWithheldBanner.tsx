import { Link } from "react-router-dom"
import { Sparkles } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { FREE_TIER_CREDITS } from "@/lib/pricing-data"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { useT } from "@/lib/i18n"

/**
 * The banner for an account whose free signup grant was withheld.
 *
 * The account works; the credits did not arrive. They arrive with the first
 * purchase — any pack, any card — and the Stripe webhook activates them
 * (backend/src/ee/billing/provision-credits.ts). There is no activation step
 * of its own any more: the previous exit saved a card at $0 and read its
 * fingerprint as "a person we have not seen", which virtual cards made free
 * to mint. The copy says "with your first purchase", never "denied": most
 * people who see this are on a shared machine, not farming grants, and the
 * login page advertised the credits to them.
 *
 * Shown only to a FREE account. A withheld account that already pays (payg or
 * a plan) is not in the free-grant business — the paid-account ruling of
 * `revokeSignupGrant` — and "with your first purchase" would be false there.
 */
export function FreeGrantWithheldBanner() {
  const t = useT()
  const { user } = useAuth()
  const { data: balance } = useUserCredits(user?.id)

  if (balance?.freeGrantState !== "withheld" || balance.effectiveTier !== "free") return null

  return (
    <div
      role="status"
      data-testid="free-grant-withheld-banner"
      className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm"
      style={{ background: "var(--blg-card)", borderColor: "var(--blg-border-3)", color: "var(--blg-t1)" }}
    >
      <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#ff0073" }} />
      <span className="flex-1 min-w-[16rem]">
        {t("credits.freeGrantOnPurchase", { n: creditUnits(FREE_TIER_CREDITS), u: creditUnitLabel(t("credits.unitShort")) })}
      </span>
      <Link
        to="/pricing"
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white"
        style={{ background: "#ff0073" }}
      >
        {t("credits.seeCreditPacks")}
      </Link>
    </div>
  )
}
