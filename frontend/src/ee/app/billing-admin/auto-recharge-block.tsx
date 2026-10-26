import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import {
  useDeploymentBalance,
  usePayerAutoRecharge,
  useSetPayerAutoRechargeMutation,
} from "@/ee/hooks/queries/use-deployment-billing"
import { dateOrDash, dollarsInputError, parseWhole } from "./units"

/** The stock route's bounds on the threshold (RAW credits). */
const MIN_THRESHOLD = 100
const MAX_THRESHOLD = 100_000

/**
 * Auto top-up — "when the pool drops below X credits, charge $Y to the saved
 * card". The billing account's own settings (the stock auto-recharge route),
 * charged to the card the first card purchase above saved.
 *
 * RAW Nodaro credits, like the pool block: the threshold is compared against
 * the pool, never against a user's allowance.
 *
 * WHAT TRIGGERS A CHARGE is stated in the note because it is the property the
 * payer is trusting: only work started in the product itself. API keys,
 * connected instances and triggers spend the pool but never charge the card;
 * a pool they drain below the threshold is topped up on the next in-app
 * generation.
 *
 * `active` comes from the server (`GET /balance`), which folds in the
 * instance switch Nodaro controls and the stop after three failed charges —
 * the page never re-derives it.
 */
export function AutoRechargeBlock({ stripeConfigured }: { stripeConfigured: boolean }) {
  const t = useT()
  const config = usePayerAutoRecharge(true)
  const balance = useDeploymentBalance(true)
  const save = useSetPayerAutoRechargeMutation()

  const [enabled, setEnabled] = useState(false)
  const [threshold, setThreshold] = useState("")
  const [amount, setAmount] = useState("")
  const [seeded, setSeeded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the form ONCE from the server; later refetches must not overwrite
  // what the payer is typing.
  useEffect(() => {
    if (seeded || !config.data) return
    setEnabled(config.data.enabled)
    setThreshold(config.data.thresholdCredits == null ? "" : String(config.data.thresholdCredits))
    setAmount(config.data.amountUsd == null ? "" : String(config.data.amountUsd))
    setSeeded(true)
  }, [config.data, seeded])

  const status = balance.data?.autoRecharge ?? null
  const parsedAmount = dollarsInputError(amount, MIN_LOAD_USD, MAX_LOAD_USD) === null ? parseWhole(amount) : null
  const quote = parsedAmount === null ? null : creditsForLoadUsd(parsedAmount)

  function submit() {
    const th = threshold.trim()
    const thresholdOk =
      /^\d+$/.test(th) && Number(th) >= MIN_THRESHOLD && Number(th) <= MAX_THRESHOLD
    const amountOk = parsedAmount !== null
    // Turning it OFF needs no values; turning it on needs both.
    if (enabled && (!thresholdOk || !amountOk)) {
      setError(
        t("billingAdmin.autoRechargeErrInvalid", {
          minT: MIN_THRESHOLD.toLocaleString(),
          maxT: MAX_THRESHOLD.toLocaleString(),
          min: MIN_LOAD_USD,
          max: MAX_LOAD_USD,
        }),
      )
      return
    }
    setError(null)
    save.mutate({
      enabled,
      ...(thresholdOk ? { thresholdCredits: Number(th) } : {}),
      ...(amountOk ? { amountUsd: parsedAmount } : {}),
    })
  }

  return (
    <section data-testid="auto-recharge-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.autoRechargeTitle")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("billingAdmin.autoRechargeNote")}</p>

      {config.isError && (
        <p className="mt-3 text-sm text-destructive">{t("billingAdmin.autoRechargeLoadFailed")}</p>
      )}

      {config.data && (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm" htmlFor="auto-recharge-enabled">
            <input
              id="auto-recharge-enabled"
              data-testid="auto-recharge-enabled"
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              disabled={!stripeConfigured}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t("billingAdmin.autoRechargeEnable")}
          </label>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-muted-foreground" htmlFor="auto-recharge-threshold">
                {t("billingAdmin.autoRechargeThreshold")}
              </label>
              <Input
                id="auto-recharge-threshold"
                data-testid="auto-recharge-threshold"
                className="mt-1 w-40 tabular-nums"
                inputMode="numeric"
                value={threshold}
                disabled={!stripeConfigured}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground" htmlFor="auto-recharge-amount">
                {t("billingAdmin.autoRechargeAmount")}
              </label>
              <Input
                id="auto-recharge-amount"
                data-testid="auto-recharge-amount"
                className="mt-1 w-32 tabular-nums"
                inputMode="numeric"
                value={amount}
                disabled={!stripeConfigured}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              data-testid="auto-recharge-save"
              disabled={!stripeConfigured || save.isPending}
              onClick={submit}
            >
              {t("billingAdmin.autoRechargeSave")}
            </Button>
            {quote !== null && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("billingAdmin.cardQuote", { credits: quote.toLocaleString() })}
              </span>
            )}
          </div>

          {/* Separately labelled facts, never one sentence: they invert around
              each other under RTL when they share a line. */}
          <dl data-testid="auto-recharge-status" className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingAdmin.autoRechargeStatus")}</dt>
              <dd className="text-xs">
                {status === null
                  ? "—"
                  : status.active
                    ? t("billingAdmin.autoRechargeActive")
                    : t("billingAdmin.autoRechargeInactive")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingAdmin.autoRechargeLastAttempt")}</dt>
              <dd className="text-xs tabular-nums">{dateOrDash(config.data.lastAttemptAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingAdmin.autoRechargeFailures")}</dt>
              <dd className="text-xs tabular-nums">{config.data.failureCount.toLocaleString()}</dd>
            </div>
          </dl>

          {!config.data.hasSavedCard && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("billingAdmin.autoRechargeNoCard")}</p>
          )}
          {config.data.failureCount >= 3 && (
            <p className="mt-2 text-xs text-destructive">{t("billingAdmin.autoRechargeStopped")}</p>
          )}
          {status !== null && status.enabled && !status.active && config.data.failureCount < 3 && (
            <p className="mt-2 text-xs text-muted-foreground">{t("billingAdmin.autoRechargeOffOnServer")}</p>
          )}
        </>
      )}

      {!stripeConfigured && (
        <p className="mt-2 text-sm text-muted-foreground">{t("billingAdmin.cardDisabled")}</p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {save.isError && !error && (
        <p className="mt-2 text-xs text-destructive">{t("billingAdmin.autoRechargeSaveFailed")}</p>
      )}
    </section>
  )
}
