import { useState } from "react"
import { cn } from "@/lib/utils"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"

/**
 * "API / Pay-as-you-go" top-up section, styled per the designer's Pricing
 * mocks (dark: sister folder `Pricing/`; light: pricing-lite, 2026-08-12):
 * cyan developer-lane accent, per-credit rate above each pack, live top-up
 * balance, one Load button for both a selected pack and a custom amount.
 * Colors resolve through the `--tps-*` tokens in globals.css — light is the
 * lite mock's cyan-tinted card, dark keeps the founder's neutral zinc
 * values. The pack tiles are the rate function's own anchors, so everything
 * checks out through the single arbitrary-amount lane — no pack price ids.
 */

const PACK_USD = [10, 25, 50, 100] as const

interface TopupSectionProps {
  /** Current top-up balance; undefined hides the badge (logged out). */
  topupBalance?: number
  /** Kick off checkout for a whole-dollar amount (page handles auth). */
  onLoad: (amountUsd: number) => void
  loading?: boolean
}

export function TopupSection({ topupBalance, onLoad, loading }: TopupSectionProps) {
  const [selectedUsd, setSelectedUsd] = useState<number | null>(25)
  const [customUsd, setCustomUsd] = useState("")

  const parsedCustom = /^\d+$/.test(customUsd) ? parseInt(customUsd, 10) : NaN
  const customValid =
    !Number.isNaN(parsedCustom) && parsedCustom >= MIN_LOAD_USD && parsedCustom <= MAX_LOAD_USD
  const effectiveUsd = customUsd ? (customValid ? parsedCustom : null) : selectedUsd

  // The "● TOP-UP CREDITS" section-header row lives in page.tsx (ported from
  // the designer's mock) — this component is just the card below it.
  return (
    <div>
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "var(--tps-border)", background: "var(--tps-bg)" }}
      >
        <div className="flex flex-wrap justify-between gap-4 p-8">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold">API / Pay-as-you-go</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Build with the API, SDK, CLI and MCP without a subscription. All
              models unlocked from your first load, no watermark, no daily cap.
              Outputs are public — private mode is a subscription feature.
            </p>
          </div>
          {topupBalance !== undefined && (
            <div className="text-right">
              <div className="font-mono text-xs tracking-[0.2em] text-muted-foreground">
                YOUR TOP-UP BALANCE
              </div>
              <div className="font-mono text-3xl font-bold text-[var(--tps-cyan)]">
                {creditUnits(topupBalance).toLocaleString()}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-[var(--tps-border)]">
          {PACK_USD.map((usd) => {
            // The anchors are always within load bounds — null is unreachable.
            const credits = creditsForLoadUsd(usd) ?? 0
            const selected = !customUsd && selectedUsd === usd
            return (
              <button
                key={usd}
                type="button"
                onClick={() => {
                  setSelectedUsd(usd)
                  setCustomUsd("")
                }}
                aria-pressed={selected}
                className={cn(
                  "relative p-6 text-left border-r last:border-r-0 border-[var(--tps-border)] transition-colors",
                  selected
                    ? "bg-[var(--tps-tile-active)]"
                    : "hover:bg-[var(--tps-tile-hover)]"
                )}
              >
                {selected && (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--tps-cyan)]" />
                )}
                <div className="font-mono text-xs tracking-widest text-muted-foreground">
                  ${(usd / creditUnits(credits)).toFixed(4)} / {creditUnitLabel()}
                </div>
                <div className="mt-3 text-4xl font-bold tracking-tight">
                  {creditUnits(credits).toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">{creditUnitLabel("credits")}</div>
                <div className="mt-3 text-2xl font-semibold">${usd}</div>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--tps-border)] p-6 bg-[var(--tps-inset)]">
          <label className="text-sm font-medium" htmlFor="topup-custom-usd">
            Or load any whole-dollar amount
          </label>
          <div className="flex items-center gap-1 rounded-md border border-[var(--tps-input-border)] px-3 py-2 font-mono text-sm">
            <span className="text-muted-foreground">$</span>
            <input
              id="topup-custom-usd"
              type="text"
              inputMode="numeric"
              value={customUsd}
              onChange={(e) => setCustomUsd(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={`${MIN_LOAD_USD}-${MAX_LOAD_USD}`}
              className="w-20 bg-transparent focus:outline-none"
            />
          </div>
          <span className="text-sm text-muted-foreground">
            {customUsd && customValid
              ? `= ${creditUnits(creditsForLoadUsd(parsedCustom)).toLocaleString()} credits`
              : "credits valid for 12 months"}
          </span>
          <button
            type="button"
            disabled={effectiveUsd === null || loading}
            onClick={() => effectiveUsd !== null && onLoad(effectiveUsd)}
            className={cn(
              "ml-auto rounded-lg bg-[var(--tps-cyan)] px-6 py-2.5 text-sm font-semibold text-[var(--tps-on-cyan)] shadow-sm transition-opacity",
              (effectiveUsd === null || loading) && "opacity-40 pointer-events-none"
            )}
          >
            {loading ? "Opening checkout…" : "Load credits"}
          </button>
        </div>
      </div>
    </div>
  )
}
