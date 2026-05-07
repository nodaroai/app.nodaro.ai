import { useState } from "react"
import { Sparkles, CreditCard, Crown, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createCheckoutSession } from "@/lib/api"
import {
  PRICING_TIERS,
  TOPUP_PACKAGES,
  getTierPrice,
  getTierPriceId,
  type BillingCycle,
} from "@/lib/pricing-data"
import { toast } from "sonner"

interface GetCreditsModalProps {
  open: boolean
  onClose: () => void
  tier: string
  balance: number
  required: number
}

export function GetCreditsModal({
  open,
  onClose,
  tier,
  balance,
  required,
}: GetCreditsModalProps) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual")
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const isFree = tier === "free"

  // Show tiers above current as upgrade options
  const currentTierIndex = PRICING_TIERS.findIndex((t) => t.id === tier)
  const upgradeTiers = PRICING_TIERS.filter(
    (_, i) => i > currentTierIndex && PRICING_TIERS[i].priceIdMonthly !== null,
  )

  async function handleCheckout(priceId: string, mode: "subscription" | "payment") {
    setLoadingId(priceId)
    try {
      const url = await createCheckoutSession({ priceId, mode })
      window.location.href = url
    } catch {
      toast.error("Failed to open checkout")
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-[#ff0073]" />
            Get More Credits
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            This app costs <strong>{required}</strong> credits per run.
            You have <strong>{balance}</strong> credits
            {required > 0 ? <> — enough for <strong>{Math.floor(balance / required)}</strong> more {Math.floor(balance / required) === 1 ? "run" : "runs"}</> : ""}.
          </p>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Section 1: Subscribe / Upgrade */}
          {upgradeTiers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#ff0073]" />
                  {isFree ? "Subscribe for Monthly Credits" : "Upgrade Your Plan"}
                </h3>
                <div className="flex items-center bg-muted rounded-full p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setBillingCycle("monthly")}
                    className={`px-2.5 py-1 rounded-full transition-colors ${
                      billingCycle === "monthly"
                        ? "bg-background shadow-sm font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingCycle("annual")}
                    className={`px-2.5 py-1 rounded-full transition-colors ${
                      billingCycle === "annual"
                        ? "bg-background shadow-sm font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    Annual
                  </button>
                </div>
              </div>

              <div className="grid gap-2">
                {upgradeTiers.slice(0, 3).map((t) => {
                  const price = getTierPrice(t, billingCycle)
                  const priceId = getTierPriceId(t, billingCycle)
                  const isHighlighted = t.highlighted
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                        isHighlighted
                          ? "border-[#ff0073]/30 bg-[#ff0073]/5"
                          : "border-border"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{t.name}</span>
                          {isHighlighted && (
                            <span className="text-[10px] font-medium text-[#ff0073] bg-[#ff0073]/10 px-1.5 py-0.5 rounded-full">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t.credits.toLocaleString()} credits/mo
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold">${price}/mo</span>
                        <button
                          type="button"
                          onClick={() => priceId && handleCheckout(priceId, "subscription")}
                          disabled={!priceId || loadingId === priceId}
                          className="h-8 px-3 rounded-full text-xs font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                        >
                          {loadingId === priceId && <Loader2 className="w-3 h-3 animate-spin" />}
                          Subscribe
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Section 3: Top-up packs */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Buy Credit Packs
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {TOPUP_PACKAGES.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => handleCheckout(pkg.priceId, "payment")}
                  disabled={loadingId === pkg.priceId}
                  className={`relative flex flex-col items-center rounded-lg border p-3 transition-all hover:border-[#ff0073]/50 hover:bg-[#ff0073]/5 ${
                    pkg.popular
                      ? "border-[#ff0073]/30 bg-[#ff0073]/5"
                      : "border-border"
                  } ${loadingId === pkg.priceId ? "opacity-60 pointer-events-none" : ""}`}
                >
                  {pkg.popular && (
                    <span className="absolute -top-2 right-2 rounded-full bg-[#ff0073] px-2 py-0.5 text-[10px] font-medium text-white">
                      Popular
                    </span>
                  )}
                  <span className="text-lg font-bold">{pkg.credits}</span>
                  <span className="text-xs text-muted-foreground">credits</span>
                  <span className="mt-1 text-sm font-semibold">${pkg.price}</span>
                  <span className="text-[10px] text-muted-foreground">{pkg.perCredit}/cr</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
