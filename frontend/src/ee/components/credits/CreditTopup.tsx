import { useState } from "react"
import { Coins, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { startCheckout, startLoadCheckout } from "@/lib/checkout"
import { TOPUP_PACKAGES, type TopupPackage, creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"

export function CreditTopup() {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [customUsd, setCustomUsd] = useState<string>("")

  const parsedUsd = /^\d+$/.test(customUsd) ? parseInt(customUsd, 10) : NaN
  const customCredits = Number.isNaN(parsedUsd) ? null : creditsForLoadUsd(parsedUsd)

  async function handleCustomLoad() {
    if (customCredits === null) return
    setLoadingId("custom")
    try {
      await startLoadCheckout(parsedUsd)
    } catch {
      toast.error("Failed to open checkout")
    } finally {
      setLoadingId(null)
    }
  }

  async function handlePurchase(pkg: TopupPackage) {
    setLoadingId(pkg.id)
    try {
      await startCheckout({ priceId: pkg.priceId, mode: "payment" })
    } catch {
      toast.error("Failed to open checkout")
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
            <span className="text-lg font-bold">{creditUnits(pkg.credits)}</span>
            <span className="text-xs text-muted-foreground">{creditUnitLabel("credits")}</span>
            <span className="mt-2 text-sm font-semibold">${pkg.price}</span>
            <span className="text-[10px] text-muted-foreground">
              ${(pkg.price / creditUnits(pkg.credits)).toFixed(4)} / {creditUnitLabel("credit")}
            </span>
          </button>
        ))}
      </div>

      {/* Pay-as-you-go: load any whole-dollar amount. Preview mirrors the
          backend rate function (pricing-data.ts, sync-pinned). */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Or load any amount:</span>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={customUsd}
              onChange={(e) => setCustomUsd(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={`${MIN_LOAD_USD}-${MAX_LOAD_USD}`}
              className="w-24 rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1.5 text-sm focus:border-[#ff0073]/60 focus:outline-none"
              aria-label="Load amount in dollars"
            />
          </div>
        </div>
        <span className="text-sm text-muted-foreground min-w-32">
          {customCredits !== null
            ? `= ${creditUnits(customCredits).toLocaleString()} credits`
            : customUsd
              ? `$${MIN_LOAD_USD}–$${MAX_LOAD_USD}, whole dollars`
              : "credits valid for 12 months"}
        </span>
        <button
          onClick={handleCustomLoad}
          disabled={customCredits === null || loadingId === "custom"}
          className={cn(
            "ml-auto rounded-md bg-[#ff0073] px-4 py-1.5 text-sm font-medium text-white transition-opacity",
            (customCredits === null || loadingId === "custom") && "opacity-40 pointer-events-none",
          )}
        >
          Load credits
        </button>
      </div>
    </div>
  )
}
