import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getAutoRecharge, updateAutoRecharge, type AutoRechargeConfig } from "@/lib/api"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import { creditUnits } from "@/lib/credit-units"

/**
 * Auto-recharge settings — "when my balance drops below X credits, load $Y".
 *
 * Designer-mock behavior (2026-08-12, "without too many saves"): there is NO
 * save button. The toggle persists immediately; the two value fields persist
 * via a short debounce once valid. The green status line is the only state
 * feedback: "Active — settings saved." / "Paused." / "Saving…".
 *
 * The failure state doubles as the in-app notification surface: declined
 * attempts show here, and three failures auto-disable until the user
 * re-saves a card (any manual load does) and re-enables.
 */

const SAVE_DEBOUNCE_MS = 900

export function AutoRechargeCard({ frameless = false }: { frameless?: boolean } = {}) {
  const [config, setConfig] = useState<AutoRechargeConfig | null>(null)
  const [threshold, setThreshold] = useState("")
  const [amount, setAmount] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const lastSavedRef = useRef<string>("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    getAutoRecharge()
      .then((c) => {
        setConfig(c)
        setEnabled(c.enabled)
        const th = c.thresholdCredits ? String(c.thresholdCredits) : ""
        const am = c.amountUsd ? String(c.amountUsd) : ""
        setThreshold(th)
        setAmount(am)
        lastSavedRef.current = JSON.stringify([c.enabled, th, am])
      })
      .catch(() => setConfig(null))
  }, [])

  const parsedThreshold = /^\d+$/.test(threshold) ? parseInt(threshold, 10) : NaN
  const parsedAmount = /^\d+$/.test(amount) ? parseInt(amount, 10) : NaN
  const previewCredits = Number.isNaN(parsedAmount) ? null : creditsForLoadUsd(parsedAmount)
  const valuesValid =
    parsedThreshold >= 100 && parsedThreshold <= 100000 && previewCredits !== null

  async function persist(nextEnabled: boolean, th: number | undefined, am: number | undefined) {
    const key = JSON.stringify([nextEnabled, th ? String(th) : "", am ? String(am) : ""])
    if (key === lastSavedRef.current) return
    setSaving(true)
    try {
      await updateAutoRecharge({
        enabled: nextEnabled,
        ...(th === undefined ? {} : { thresholdCredits: th }),
        ...(am === undefined ? {} : { amountUsd: am }),
      })
      lastSavedRef.current = key
      setConfig((c) => (c ? { ...c, enabled: nextEnabled, failureCount: 0 } : c))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save auto-recharge")
    } finally {
      setSaving(false)
    }
  }

  function handleToggle() {
    const next = !enabled
    if (next && !valuesValid) {
      setEnabled(next)
      return // persists once the fields become valid (debounced effect below)
    }
    setEnabled(next)
    void persist(
      next,
      Number.isNaN(parsedThreshold) ? undefined : parsedThreshold,
      Number.isNaN(parsedAmount) ? undefined : parsedAmount,
    )
  }

  // Debounced field auto-save — fires only for valid values, never on mount.
  useEffect(() => {
    if (!config) return
    if (!valuesValid) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void persist(enabled, parsedThreshold, parsedAmount)
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, amount, enabled])

  if (!config) return null

  const statusText = saving
    ? "Saving…"
    : enabled
      ? valuesValid
        ? "Active — settings saved."
        : `Enter a threshold (100–100,000) and an amount ($${MIN_LOAD_USD}–$${MAX_LOAD_USD}).`
      : "Paused."

  const inputStyle: React.CSSProperties = {
    background: "var(--blg-field-2)",
    border: "1px solid var(--blg-border-input)",
    borderRadius: 10,
    color: "var(--blg-t1)",
    fontSize: 15,
    fontWeight: 600,
    padding: "10px 14px",
    outline: "none",
  }

  return (
    <div className={cn("space-y-4", !frameless && "rounded-lg border border-zinc-200 dark:border-zinc-800 p-4")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 style={{ fontSize: 19, fontWeight: 700, color: "var(--blg-t1)", letterSpacing: "-0.01em" }}>
            Auto-recharge
          </h3>
          <p style={{ fontSize: 13.5, color: "var(--blg-t2-dim)", marginTop: 2 }}>
            Tops up your <span style={{ color: "var(--blg-cyan-text)", fontWeight: 600 }}>top-up balance</span> when
            the total drops low.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className="relative shrink-0 transition-colors"
          style={{
            width: 52,
            height: 28,
            borderRadius: 99,
            background: enabled ? "var(--blg-pink)" : "var(--blg-toggle-off)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <span
            className="absolute transition-transform"
            style={{
              top: 3,
              left: 3,
              width: 22,
              height: 22,
              borderRadius: 99,
              background: "#fff",
              transform: enabled ? "translateX(24px)" : "translateX(0)",
            }}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3" style={{ fontSize: 15.5, color: "var(--blg-t1-body)" }}>
        <span>When my balance drops below</span>
        <input
          type="text"
          inputMode="numeric"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="3000"
          style={{ ...inputStyle, width: 110 }}
          aria-label="Threshold in credits"
        />
        <span>credits, load</span>
        <span
          className="flex items-center gap-2"
          style={{ ...inputStyle, width: 110, display: "inline-flex" }}
        >
          <span style={{ color: "var(--blg-t2-dim)", fontWeight: 500 }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={`${MIN_LOAD_USD}-${MAX_LOAD_USD}`}
            aria-label="Recharge amount in dollars"
            style={{ background: "transparent", border: "none", outline: "none", color: "var(--blg-t1)", fontSize: 15, fontWeight: 600, width: "100%" }}
          />
        </span>
        {previewCredits !== null && (
          <span style={{ color: "var(--blg-t2-dim)" }}>= {creditUnits(previewCredits).toLocaleString()} credits</span>
        )}
      </div>

      <p style={{ fontSize: 13.5, color: enabled && !valuesValid && !saving ? "var(--blg-warn)" : "var(--blg-good)" }}>
        {statusText}
      </p>

      {!config.hasSavedCard && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No saved card yet — make one credit load first and your card is saved
          automatically for future recharges.
        </p>
      )}
      {config.failureCount > 0 && (
        <p className="text-xs text-red-500">
          {config.failureCount >= 3
            ? "Auto-recharge was disabled after 3 failed charges. Check your card, make a manual load, then re-enable."
            : `Last charge attempt failed (${config.failureCount}/3). At 3 failures auto-recharge disables itself.`}
        </p>
      )}
    </div>
  )
}
