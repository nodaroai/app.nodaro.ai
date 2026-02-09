"use client"

import { useState } from "react"
import { Coins, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { openCheckout } from "@/lib/paddle"
import { TOPUP_PACKAGES, type TopupPackage } from "@/lib/pricing-data"

interface CreditTopupProps {
  readonly userId: string
  readonly userEmail?: string
}

export function CreditTopup({ userId, userEmail }: CreditTopupProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handlePurchase(pkg: TopupPackage) {
    setLoadingId(pkg.id)
    try {
      await openCheckout({
        priceId: pkg.priceId,
        userId,
        userEmail,
        successUrl: `${window.location.origin}/billing?topup=true`,
      })
    } catch (err) {
      console.error("[topup] Checkout error:", err)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Plus className="h-4 w-4" />
        Buy Credit Packs
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TOPUP_PACKAGES.map((pkg) => (
          <button
            key={pkg.id}
            onClick={() => handlePurchase(pkg)}
            disabled={loadingId === pkg.id}
            className={cn(
              "relative flex flex-col items-center rounded-lg border p-4 transition-all",
              "hover:border-[#ff0073]/50 hover:bg-[#ff0073]/5",
              "dark:hover:border-[#ff0073]/40 dark:hover:bg-[#ff0073]/5",
              pkg.popular
                ? "border-[#ff0073]/30 bg-[#ff0073]/5 dark:border-[#ff0073]/20"
                : "border-zinc-200 dark:border-zinc-800",
              loadingId === pkg.id && "opacity-60 pointer-events-none",
            )}
          >
            {pkg.popular && (
              <span className="absolute -top-2 right-2 rounded-full bg-[#ff0073] px-2 py-0.5 text-[10px] font-medium text-white">
                Popular
              </span>
            )}
            <Coins className="h-5 w-5 text-[#ff0073] mb-2" />
            <span className="text-lg font-bold">{pkg.credits}</span>
            <span className="text-xs text-muted-foreground">credits</span>
            <span className="mt-2 text-sm font-semibold">${pkg.price}</span>
            <span className="text-[10px] text-muted-foreground">
              {pkg.perCredit} / credit
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
