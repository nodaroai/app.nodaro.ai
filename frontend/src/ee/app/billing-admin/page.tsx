import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "@/lib/pricing-data"
import { ConnectedInstances } from "@/ee/components/billing/ConnectedInstances"
import {
  useDeploymentBalance,
  useDeploymentBillingRefresh,
  useDeploymentBillingTransactions,
  useDeploymentCheckoutMutation,
  useDeploymentPayerViewer,
  useSetBalanceThresholdMutation,
  useSetDefaultAllowanceMutation,
  type DeploymentBillingOverview,
} from "@/ee/hooks/queries/use-deployment-billing"
import { UsersBlock, errorText } from "./users-block"
import { IntegrationsBlock } from "./integrations-block"
import { ListError } from "./list-error"
import {
  dollarsInputError,
  orDash,
  parseThreshold,
  parseWhole,
  thresholdInputError,
  unitsInputError,
  type DisplayUnit,
} from "./units"

/**
 * `/billing-admin` — the deployment BILLING ACCOUNT's own page (spec §9.3).
 *
 * On a deployment where one account pays for everyone there are three
 * principals, not two: the users, the customer's admins, and the account that
 * holds the credits everybody spends. This page is that third principal's, and
 * it is deliberately NOT under `/admin`, whose layout gates on `profiles.role`
 * — on such a deployment the CUSTOMER runs the identity provider and mints the
 * roles, so a role check is downstream of the party it would have to constrain.
 * What gates this page is IDENTITY: `requireDeploymentPayer` on every route it
 * reads, and `isDeploymentPayer` (the server's own 200-vs-403) for what it
 * renders.
 *
 * MAINLINE (R2): the billing surface answers `deploymentPayer: false`, so the
 * probe never fires, the flag is never true and this route — unreferenced by
 * any nav entry — renders the "this page belongs to the billing account"
 * state. Nothing else in the product changes.
 *
 * TWO CURRENCIES, NEVER BLURRED. Block 1 is RAW Nodaro credits (this is the
 * only surface in the whole product that renders them, and it says so in
 * words). Blocks 3 and 4 are the deployment's display unit, converted by the
 * SERVER — the page never multiplies by `unitRate` (R3); it only validates that
 * what the payer typed is a whole number of credits at that rate, which is the
 * same refusal the route makes.
 *
 * RTL (R5): logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`text-start`); the
 * `rtl:` variant is banned repo-wide. `null` renders as an em dash everywhere —
 * on an allowance a manufactured 0 means "exhausted", which reads as a refusal.
 */
export default function BillingAdminPage() {
  const t = useT()
  const [searchParams] = useSearchParams()
  const { probe, isPayer, overview, faulted } = useDeploymentPayerViewer()
  const refresh = useDeploymentBillingRefresh()

  const returnedFromStripe = searchParams.get("topup") === "true"

  // Stripe redirects here on success, and the WEBHOOK — not this redirect — is
  // what grants the credits, so the pool figure the page loaded with is stale
  // and the grant may not have landed yet. Refetch now (the webhook has often
  // already fired by the time the browser gets here) and again after the same
  // 3 s the stock billing page waits, which is the case this really covers.
  useEffect(() => {
    if (!returnedFromStripe) return
    refresh()
    const timer = setTimeout(refresh, 3000)
    return () => clearTimeout(timer)
  }, [returnedFromStripe, refresh])

  if (probe === "pending") {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isPayer || !overview) {
    // A READ FAULT is NOT "you are not the payer". Telling the billing account
    // it is not the billing account because a read failed is the worse of the
    // two wrong answers, so the fault gets its own sentence.
    //
    // `faulted`, not `errorStatus >= 500`: a rejected fetch — DNS, a killed
    // connection, a blocked preflight — never reaches a status at all, so a
    // status test silently classified the worst failures as "not the payer".
    // A 403 is a real answer and stays on the notPayer side.
    const failed = faulted || (isPayer && !overview)
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">
          {failed ? t("billingAdmin.loadError") : t("billingAdmin.notPayer")}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("billingAdmin.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("billingAdmin.subtitle")}</p>
      </header>

      {returnedFromStripe && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm text-green-700 dark:text-green-400">{t("billingAdmin.topupSuccess")}</p>
        </div>
      )}

      {/* Spec §9.3's five blocks, in its order. */}
      <PoolBlock overview={overview} />
      <TransactionsBlock />
      <DefaultBlock overview={overview} />
      <UsersBlock unit={overview.unit} />
      <CardBlock overview={overview} />

      {/* The credentials another system authenticates with. Mintable here and
          nowhere else: the route refuses a key that tries to mint a key, so the
          billing account's own browser is the only place one comes from. */}
      <IntegrationsBlock />

      {/* Track B: `/billing` is not registered on a `selfServe: false`
          deployment, so the ONE component that shows a relay key's spend, caps
          it and revokes it is unreachable there. The billing account is exactly
          who needs it — it is mounted here or nowhere. Self-hiding: it renders
          nothing when no instance is connected. */}
      <ConnectedInstances />
    </div>
  )
}

// ── Block 1 — the pool, in RAW Nodaro credits ───────────────────────────────

function PoolBlock({ overview }: { overview: DeploymentBillingOverview }) {
  const t = useT()
  const { payer, burn, users } = overview
  const unprovisioned = users.total == null ? null : Math.max(users.total - users.provisioned, 0)

  return (
    <section data-testid="pool-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.poolTitle")}</h2>
      {/* The label is the point of this block: these are Nodaro's credits, not
          the customer's unit, and no conversion is applied to them anywhere. */}
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("billingAdmin.poolNote")}</p>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          testId="pool-balance"
          label={t("billingAdmin.poolBalance")}
          value={orDash(payer.balanceCredits)}
          strong
        />
        <Figure label={t("billingAdmin.poolSubscription")} value={orDash(payer.subscriptionCredits)} />
        <Figure label={t("billingAdmin.poolTopup")} value={orDash(payer.topupCredits)} />
        <Figure label={t("billingAdmin.poolTier")} value={payer.tier ?? "—"} />
      </dl>

      <div className="mt-5 border-t border-border/60 pt-4">
        <h3 className="text-sm font-medium">{t("billingAdmin.burnTitle")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("billingAdmin.burnSince", { date: new Date(burn.periodStart).toLocaleDateString() })}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label={t("billingAdmin.burnCredits")} value={orDash(burn.credits)} />
          <Figure label={t("billingAdmin.burnGenerations")} value={orDash(burn.generations)} />
          <Figure label={t("billingAdmin.usersTotal")} value={orDash(users.total)} />
          <Figure label={t("billingAdmin.usersProvisioned")} value={orDash(users.provisioned)} />
        </dl>
        {burn.capped && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("billingAdmin.burnCapped", { n: (burn.generations ?? 0).toLocaleString() })}
          </p>
        )}
        {unprovisioned !== null && unprovisioned > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("billingAdmin.usersUnprovisioned", { n: unprovisioned.toLocaleString() })}
          </p>
        )}
      </div>

      <ThresholdField />

      <p className="mt-4 text-xs text-muted-foreground">
        {overview.allowancesEnforced ? t("billingAdmin.enforcementOn") : t("billingAdmin.enforcementOff")}
      </p>
    </section>
  )
}

/**
 * The low-balance warning, beside the pool figure it is judged against.
 *
 * RAW Nodaro credits, like the rest of block 1 — the pool is the deployment's
 * real money, and a threshold in the display unit would be wrong by the unit
 * rate in the expensive direction.
 *
 * THE FLAG IS THE SERVER'S. `lowBalance` is computed against the stored
 * threshold, so the page renders it rather than comparing two numbers itself:
 * a client-side comparison would disagree with the same judgement made for the
 * integration's `GET /balance`, and the two must never differ.
 *
 * A READ THAT FAILED SAYS SO, and offers the retry every other list on this
 * page offers. An empty field over an unread threshold invites the payer to
 * "save" a clear they never asked for, and a missing warning would read as an
 * all-clear nobody established — but rendering NOTHING at all made a failed
 * read indistinguishable from a deployment that has no threshold field, with
 * no way back except reloading the page.
 */
function ThresholdField() {
  const t = useT()
  const balance = useDeploymentBalance(true)
  const save = useSetBalanceThresholdMutation()
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const data = balance.data
  if (balance.isError) {
    return (
      <div className="mt-5 border-t border-border/60 pt-4">
        <ListError retryTestId="threshold-retry" onRetry={() => void balance.refetch()} />
      </div>
    )
  }
  // Still loading: no field yet, and no sentence claiming anything either.
  if (!data) return null

  // The stored figure until the payer types; `null` means "no warning", which
  // is an EMPTY field and never a zero.
  const shown = value ?? (data.threshold == null ? "" : String(data.threshold))

  function submit() {
    if (thresholdInputError(shown) !== null) {
      setError(t("billingAdmin.errInvalidThreshold"))
      return
    }
    setError(null)
    save.mutate({ credits: parseThreshold(shown) })
  }

  return (
    <div className="mt-5 border-t border-border/60 pt-4">
      {data.lowBalance && (
        <p
          role="status"
          data-testid="low-balance"
          className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("billingAdmin.lowBalanceOn")}
        </p>
      )}
      <label className="block text-xs text-muted-foreground" htmlFor="billing-admin-threshold">
        {t("billingAdmin.thresholdLabel")}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          id="billing-admin-threshold"
          data-testid="threshold-input"
          className="w-48 tabular-nums"
          inputMode="numeric"
          value={shown}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          data-testid="threshold-save"
          disabled={save.isPending}
          onClick={submit}
        >
          {t("billingAdmin.thresholdSave")}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("billingAdmin.thresholdNote")}</p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function Figure({
  label,
  value,
  strong,
  testId,
}: {
  label: string
  value: string
  strong?: boolean
  testId?: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        data-testid={testId}
        className={strong ? "text-xl font-semibold tabular-nums" : "text-sm tabular-nums"}
      >
        {value}
      </dd>
    </div>
  )
}

// ── Block 3 — the default allocation ────────────────────────────────────────

function DefaultBlock({ overview }: { overview: DeploymentBillingOverview }) {
  const t = useT()
  const unit: DisplayUnit | null = overview.unit
  const [value, setValue] = useState(
    overview.defaultAllowance.units == null ? "" : String(overview.defaultAllowance.units),
  )
  const [error, setError] = useState<string | null>(null)
  const save = useSetDefaultAllowanceMutation()

  function submit() {
    const reason = unitsInputError(value, unit)
    if (reason !== null) {
      setError(errorText(t, reason, unit))
      return
    }
    setError(null)
    save.mutate({ units: parseWhole(value) })
  }

  return (
    <section data-testid="default-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.defaultTitle")}</h2>
      {/* D7, in the payer's own words: the default is what a user who has NOT
          generated yet will be provisioned with. It does not retro-apply and it
          moves no existing row. */}
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("billingAdmin.defaultNote")}</p>

      <label className="mt-4 block text-xs text-muted-foreground" htmlFor="billing-admin-default">
        {t("billingAdmin.defaultLabel", { unit: unit?.label ?? "" })}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          id="billing-admin-default"
          className="w-48 tabular-nums"
          inputMode="numeric"
          value={value}
          disabled={unit === null}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={save.isPending || unit === null} onClick={submit}>
          {t("billingAdmin.defaultSave")}
        </Button>
      </div>
      {unit === null && (
        <p className="mt-2 text-xs text-muted-foreground">{t("billingAdmin.errUnitNotConfigured")}</p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}

// ── Block 5 — the card ──────────────────────────────────────────────────────

function CardBlock({ overview }: { overview: DeploymentBillingOverview }) {
  const t = useT()
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const checkout = useDeploymentCheckoutMutation()

  // The quote is in RAW Nodaro credits, from the frontend mirror of the
  // canonical load rate — this purchase buys the POOL, not an allowance, so a
  // figure in the customer's unit would be the wrong currency entirely.
  const parsed = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : null
  const quote = parsed === null ? null : creditsForLoadUsd(parsed)

  function submit() {
    const reason = dollarsInputError(amount, MIN_LOAD_USD, MAX_LOAD_USD)
    if (reason !== null) {
      setError(t("billingAdmin.errInvalidAmount"))
      return
    }
    setError(null)
    checkout.mutate({ amountUsd: parseWhole(amount) })
  }

  return (
    <section data-testid="card-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.cardTitle")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("billingAdmin.cardNote")}</p>

      <label className="mt-4 block text-xs text-muted-foreground" htmlFor="billing-admin-amount">
        {t("billingAdmin.cardAmount")}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          id="billing-admin-amount"
          className="w-32 tabular-nums"
          inputMode="numeric"
          value={amount}
          disabled={!overview.stripeConfigured}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button size="sm" disabled={!overview.stripeConfigured || checkout.isPending} onClick={submit}>
          {t("billingAdmin.cardSubmit")}
        </Button>
        {quote !== null && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("billingAdmin.cardQuote", { credits: quote.toLocaleString() })}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("billingAdmin.cardRange", { min: MIN_LOAD_USD, max: MAX_LOAD_USD })}
      </p>
      {/* R4's product half: `stripeConfigured` is read from the config, never by
          calling getStripe() (which throws) — so a deployment whose operator has
          not set the key degrades honestly instead of erroring. */}
      {!overview.stripeConfigured && (
        <p className="mt-2 text-sm text-muted-foreground">{t("billingAdmin.cardDisabled")}</p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}

// ── Block 2 — the payer's own purchases and credit movements ────────────────

function TransactionsBlock() {
  const t = useT()
  const { data, isLoading, isError, refetch } = useDeploymentBillingTransactions(true)
  const purchases = data?.purchases ?? []
  const ledger = data?.ledger ?? []

  return (
    <section data-testid="transactions-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.txTitle")}</h2>
      {isLoading && <p className="text-sm text-muted-foreground">{t("billingAdmin.loading")}</p>}
      {/* ONE query feeds both lists, so one failure line covers both — and
          both empty sentences are withheld, not just the first. */}
      {isError && <ListError retryTestId="transactions-retry" onRetry={() => void refetch()} />}
      {!isError && !isLoading && purchases.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">{t("billingAdmin.txEmpty")}</p>
      )}
      <ul className="mt-3 space-y-1 text-sm">
        {purchases.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-4">
            <span className="text-xs text-muted-foreground">
              {new Date(p.created_at).toLocaleDateString()}
            </span>
            <span className="tabular-nums">{p.amount_usd == null ? "—" : `$${p.amount_usd}`}</span>
            <span className="tabular-nums text-muted-foreground">{orDash(p.credits_granted)}</span>
            {p.receipt_url && (
              <a
                className="text-xs underline"
                href={p.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("billingAdmin.txReceipt")}
              </a>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-medium">{t("billingAdmin.ledgerTitle")}</h3>
      {!isError && !isLoading && ledger.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">{t("billingAdmin.ledgerEmpty")}</p>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {ledger.map((l) => (
          <li key={l.id} className="flex flex-wrap items-baseline gap-x-4">
            <span className="text-xs text-muted-foreground">
              {new Date(l.created_at).toLocaleDateString()}
            </span>
            <span className="tabular-nums">{orDash(l.amount)}</span>
            <span className="text-xs text-muted-foreground">{l.description ?? l.source ?? ""}</span>
            <span className="tabular-nums text-xs text-muted-foreground">{orDash(l.balance_after)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
