import { useState } from "react"
import { toast } from "sonner"
import { startLoadCheckout } from "@/lib/checkout"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"
import {
  CYAN_TEXT,
  MONO_FONT,
  PINK,
  formatCredits,
  inputShell,
  monoInput,
  mutedParagraph,
  sectionCardSpaced,
  sectionTitle,
} from "./billing-styles"

/** The four fixed pack amounts — all routed through startLoadCheckout(usd). */
const PACK_USD_AMOUNTS = [10, 25, 50, 100] as const
const POPULAR_PACK_USD = 25

/**
 * "Buy Credit Packs" + "Or load any amount" card, ported from the mock.
 * Packs are plain USD loads (no Stripe price ids): credits and the per-credit
 * rate label both derive from creditsForLoadUsd so the tiles can never drift
 * from the real load rate.
 */
export function BuyPacksSection() {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [customUsd, setCustomUsd] = useState("")

  const parsedUsd = /^\d+$/.test(customUsd) ? parseInt(customUsd, 10) : NaN
  const customCredits = Number.isNaN(parsedUsd) ? null : creditsForLoadUsd(parsedUsd)

  const packs = PACK_USD_AMOUNTS.map((usd) => {
    const credits = creditsForLoadUsd(usd)
    return {
      usd,
      credits: credits ?? 0,
      perCredit: credits ? `$${(usd / creditUnits(credits)).toFixed(4)} / ${creditUnitLabel("credit")}` : "",
      popular: usd === POPULAR_PACK_USD,
    }
  })

  async function handleLoad(id: string, usd: number) {
    setLoadingId(id)
    try {
      await startLoadCheckout(usd)
    } catch {
      toast.error("Failed to open checkout")
    } finally {
      setLoadingId(null)
    }
  }

  const amountHint =
    customCredits !== null
      ? `≈ ${formatCredits(creditUnits(customCredits))} credits · added to top-up`
      : customUsd
        ? `$${MIN_LOAD_USD}–$${MAX_LOAD_USD}, whole dollars`
        : "goes to top-up · valid for 12 months"

  return (
    <section style={sectionCardSpaced}>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}
      >
        <h2 style={sectionTitle}>Buy Credit Packs</h2>
        <span style={{ fontSize: 12, fontWeight: 600, color: CYAN_TEXT }}>
          → adds to Top-up
        </span>
      </div>
      <p style={{ ...mutedParagraph, margin: "0 0 20px" }}>
        Purchased packs land in your top-up balance and are valid for 12 months.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {packs.map((pack) => (
          <button
            key={pack.usd}
            onClick={() => handleLoad(`pack_${pack.usd}`, pack.usd)}
            disabled={loadingId === `pack_${pack.usd}`}
            style={{
              position: "relative",
              textAlign: "center",
              fontFamily: "inherit",
              color: "var(--blg-t1)",
              cursor: "pointer",
              padding: "22px 14px 18px",
              borderRadius: 14,
              ...(pack.popular
                ? {
                    border: `1px solid ${PINK}`,
                    background: "var(--blg-pop-bg)",
                  }
                : {
                    border: "1px solid var(--blg-pack-border)",
                    background: "var(--blg-pack-bg)",
                  }),
              ...(loadingId === `pack_${pack.usd}`
                ? { opacity: 0.6, pointerEvents: "none" }
                : {}),
            }}
          >
            {pack.popular && (
              <span
                style={{
                  position: "absolute",
                  top: -10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: PINK,
                  color: "#fff",
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "3px 11px",
                  borderRadius: 99,
                  letterSpacing: "0.03em",
                }}
              >
                Popular
              </span>
            )}
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCredits(creditUnits(pack.credits))}
            </div>
            <div style={{ fontSize: 12, color: "var(--blg-t2-dim)", marginTop: 2 }}>{creditUnitLabel("credits")}</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 14 }}>
              ${pack.usd}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--blg-t3-pack)",
                marginTop: 3,
                fontFamily: MONO_FONT,
              }}
            >
              {pack.perCredit}
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          border: "1px solid var(--blg-border)",
          borderRadius: 12,
          background: "var(--blg-inset)",
          padding: "16px 18px",
          marginTop: 16,
        }}
      >
        <span style={{ fontSize: 14, color: "var(--blg-t1-label)", fontWeight: 500 }}>
          Or load any amount
        </span>
        <div style={inputShell}>
          <span style={{ color: "var(--blg-t2-dim)", fontSize: 14 }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder={`${MIN_LOAD_USD}–${MAX_LOAD_USD}`}
            value={customUsd}
            onChange={(e) => setCustomUsd(e.target.value.replace(/[^0-9]/g, ""))}
            className="placeholder:text-[var(--blg-placeholder)]"
            style={{ ...monoInput, width: 90 }}
            aria-label="Load amount in dollars"
          />
        </div>
        <span style={{ fontSize: 13, color: "var(--blg-t2-dim)" }}>{amountHint}</span>
        <button
          onClick={() => handleLoad("custom", parsedUsd)}
          disabled={customCredits === null || loadingId === "custom"}
          className="bg-[var(--blg-pink)] hover:bg-[var(--blg-pink-hover)] disabled:pointer-events-none disabled:opacity-70"
          style={{
            marginLeft: "auto",
            border: "none",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 13.5,
            fontWeight: 700,
            padding: "11px 22px",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          Load credits
        </button>
      </div>
    </section>
  )
}
