import { useVideoRouteDraft } from "@/ee/hooks/use-video-route-draft"
import { Loader2, Route as RouteIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  useDecideVideoRouteHold,
  useRevertVideoRoutePolicy,
  useSaveVideoRouteFactors,
  useSaveVideoRoutePolicy,
  useVideoRoute,
} from "@/ee/hooks/queries/use-video-route"
import { type VideoRouteChoice, type VideoRoutePolicy, type VideoRouteView } from "@/ee/lib/video-route-api"

/**
 * Admin → Video route: which route each Seedance 2.x model takes, per
 * service (backend/src/ee/routes/admin-video-route.ts). A change applies to
 * NEW jobs only, in every environment on this database; a job keeps the
 * route it was admitted on. A routed run is held from the route's quote and
 * charged what the route billed, marked up as the platform price is.
 *
 * DIRECTION: logical Tailwind properties only.
 */
const INHERIT = "__model__"

const CHOICE_LABEL: Record<VideoRouteChoice, string> = { default: "Default provider", alternate: "Alternate route" }

function usd(n: number): string {
  return "$" + n.toFixed(2)
}

function routeBalanceText(route: VideoRouteView["balances"]["route"]): string {
  return route ? usd(route.availableUsd) + " available, " + usd(route.heldUsd) + " held" : "Not available here"
}

function numberOrNull(raw: string): number | null {
  const n = Number(raw)
  return raw.trim() === "" || !Number.isFinite(n) ? null : n
}

function ModelRow({
  model,
  services,
  policy,
  routesPerModel,
  onChange,
}: {
  model: VideoRouteView["models"][number]
  services: string[]
  policy: VideoRoutePolicy
  routesPerModel: boolean
  onChange: (next: VideoRoutePolicy) => void
}) {
  const entry = policy.models[model.id] ?? { route: "default" as const }
  const set = (next: typeof entry) => {
    const models = { ...policy.models }
    const overrides = Object.keys(next.services ?? {}).length > 0
    if (next.route === "default" && !overrides) delete models[model.id]
    else models[model.id] = overrides ? next : { route: next.route }
    onChange({ ...policy, models })
  }
  const setService = (service: string, value: string) => {
    const servicesNext = { ...(entry.services ?? {}) }
    if (value === INHERIT) delete servicesNext[service]
    else servicesNext[service] = value as VideoRouteChoice
    set({ ...entry, services: servicesNext })
  }
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{model.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{model.id}</div>
          {!model.capable && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              This environment's alternate route cannot take this model. Requests selecting it are refused.
            </div>
          )}
        </div>
        <Select value={entry.route} onValueChange={(v) => set({ ...entry, route: v as VideoRouteChoice })}>
          <SelectTrigger className="w-48" aria-label={`${model.id} route`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{CHOICE_LABEL.default}</SelectItem>
            <SelectItem value="alternate" disabled={(!model.capable || !routesPerModel) && entry.route !== "alternate"}>
              {CHOICE_LABEL.alternate}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">Per service</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {services.map((service) => (
            <label key={service} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-mono text-xs">{service}</span>
              <Select value={entry.services?.[service] ?? INHERIT} onValueChange={(v) => setService(service, v)}>
                <SelectTrigger className="w-44" aria-label={`${model.id} ${service} route`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>As the model</SelectItem>
                  <SelectItem value="default">{CHOICE_LABEL.default}</SelectItem>
                  <SelectItem value="alternate">{CHOICE_LABEL.alternate}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
      </details>
    </div>
  )
}

export default function AdminVideoRoutePage() {
  const { data, isLoading, isError } = useVideoRoute()
  const savePolicy = useSaveVideoRoutePolicy()
  const revert = useRevertVideoRoutePolicy()
  const saveFactors = useSaveVideoRouteFactors()
  const decideHold = useDecideVideoRouteHold()
  // The edits, and the saved setting they were started from (hooks/use-video-route-draft.ts).
  const { draft, setDraft, baseUpdatedAt, staleChanges, reset, factors, setFactors, factorsBaseUpdatedAt, factorsStale, resetFactors } = useVideoRouteDraft(data)

  if (isLoading || !draft) {
    return isError ? <p className="p-6 text-sm text-destructive">Could not load the video route setting.</p> : <Loader2 className="m-6 size-5 animate-spin" />
  }
  if (!data) return null
  const services = [...data.services.platform, ...data.services.plugin]

  async function run(p: Promise<unknown>, ok: string) {
    try {
      const view = (await p) as VideoRouteView | undefined
      // A decision that is saved but not applied yet says so, instead of claiming the charge or the release.
      const decided = view?.decided
      if (decided?.heldForTotal) toast.info("Not charged: with its billed parts this run's total is far above its quote. It now waits as a held bill, to be confirmed or rejected on its own.")
      else if (decided && !decided.settled) toast.success("Decision saved. It is applied when this run's settlement next runs.")
      // The amount the settlement computed and charged at that moment.
      else if ((decided?.decision === "confirmed" || decided?.decision === "quote") && decided.chargedCredits !== null) toast.success(`Confirmed. The run was charged ${decided.chargedCredits} credits.`)
      else toast.success(ok)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save")
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-start gap-3">
        <RouteIcon className="mt-1 size-5" />
        <div>
          <h1 className="text-xl font-semibold">Video route</h1>
          <p className="text-sm text-muted-foreground">
            Which provider runs each Seedance model. A change applies to new jobs in this environment only.
            Routed runs settle from the route's verified bill. A bill far above its quote waits here for a decision.
          </p>
          <p className="text-xs text-muted-foreground">
            This environment: {data.route.present ? (data.route.v2 ? "an alternate route is loaded" : "the loaded route predates per-model routing") : "no alternate route is loaded"}.
            {data.updatedAt ? ` Last saved ${new Date(data.updatedAt).toLocaleString()}.` : " Never saved: every model is on the default provider."}
          </p>
        </div>
      </header>

      {data.updatedAt === null && data.route.present && (
        <p className="rounded-md border border-amber-500/40 p-3 text-sm text-amber-700 dark:text-amber-300">
          Nothing has been saved here yet. From the first save on, these settings alone decide the route, for every model and service.{" "}
          {data.legacyRouting === null
            ? "The alternate route loaded here does not report what it runs today, so this form cannot show it. Anything it runs today without a setting (for example a feature's own edit steps) moves to the default provider at the first save, unless you choose the alternate route for that model and service below. Check what runs there today before saving."
            : data.legacyRouting.length === 0 && data.legacyRoutingUnrecognised.length === 0
              ? "The alternate route reports that it runs nothing today without a setting."
              : data.legacyRouting.length === 0
                ? ""
              : `On the alternate route today, and pre-selected below so a first save keeps them: ${data.legacyRouting.map((l) => `${l.model} for ${l.service}`).join(", ")}. Change them only if you mean to move that traffic.`}
          {data.legacyRoutingUnrecognised.length > 0 && (
            <span className="mt-1 block">
              Unrecognised, will move to the default provider at the first save: {data.legacyRoutingUnrecognised.map((l) => `${l.model} for ${l.service}`).join(", ")}.
            </span>
          )}
        </p>
      )}
      {!data.routesPerModel && (
        <p className="rounded-md border border-amber-500/40 p-3 text-sm text-amber-700 dark:text-amber-300">
          This build cannot run a model on the alternate route. Select the default provider to admit new runs here.
        </p>
      )}
      <section className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-muted-foreground">Alternate route balance</div>
          <div className="tabular-nums">{routeBalanceText(data.balances.route)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Default provider balance (its credits)</div>
          <div className="tabular-nums">{data.balances.defaultProviderCredits ?? "No snapshot yet"}</div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {data.models.map((model) => (
          <ModelRow key={model.id} model={model} services={services} policy={draft} routesPerModel={data.routesPerModel} onChange={setDraft} />
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Alert when the route's balance is below (USD)
          <Input
            inputMode="decimal"
            value={draft.routeBalanceAlertUsd ?? ""}
            placeholder="No alert"
            onChange={(e) => setDraft({ ...draft, routeBalanceAlertUsd: numberOrNull(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Alert when the default provider's balance is below (its credits)
          <Input
            inputMode="decimal"
            value={draft.defaultProviderBalanceAlertCredits ?? ""}
            placeholder="No alert"
            onChange={(e) => setDraft({ ...draft, defaultProviderBalanceAlertCredits: numberOrNull(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Alert when the route's real spend exceeds the recorded cost by more than (%)
          <Input
            inputMode="decimal"
            value={draft.spendDriftAlertPercent}
            onChange={(e) => setDraft({ ...draft, spendDriftAlertPercent: numberOrNull(e.target.value) ?? 0 })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Alert after this many route failures of one model within {draft.failureAlert.windowMinutes} minutes
          <Input
            inputMode="numeric"
            value={draft.failureAlert.failures}
            onChange={(e) => setDraft({ ...draft, failureAlert: { ...draft.failureAlert, failures: Math.max(1, Math.round(numberOrNull(e.target.value) ?? 1)) } })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hold a bill for a decision when it is more than this many times its quote
          <Input
            inputMode="decimal"
            aria-label="Bill anomaly multiple"
            value={draft.billAnomalyMultiple}
            onChange={(e) => setDraft({ ...draft, billAnomalyMultiple: Math.max(1, numberOrNull(e.target.value) ?? 1) })}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Enforce unpaid charges"
            disabled={!data.environmentNameable && !draft.enforceUnpaidCharges}
            checked={draft.enforceUnpaidCharges}
            onChange={(e) => setDraft({ ...draft, enforceUnpaidCharges: e.target.checked })}
          />
          <span>
            Enforce unpaid charges
            <span className="block text-xs text-muted-foreground">
              Off: a charge the payer could not cover is recorded and alerted, and nothing else changes. On: it blocks that payer's new paid
              runs, later funding repays it first, and an external wallet must support the routed-debt contract.
            </span>
          </span>
        </label>
      </section>

      {staleChanges.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 p-3 text-sm" role="alert">
          <span>This setting was saved by someone else since you started editing. Changed: {staleChanges.join(", ")}. A save from here is refused; reload to see it (your unsaved edits are dropped).</span>
          <Button size="sm" variant="outline" onClick={reset}>Reload</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const dropped = data.updatedAt === null ? data.legacyRoutingUnrecognised : []
            if (dropped.length > 0 && !window.confirm(`The alternate route reports it runs these today, but this server does not recognise them, so they cannot be kept: ${dropped.map((l) => `${l.model} for ${l.service}`).join(", ")}. After this save they run on the default provider. Save anyway?`)) return
            // The setting the DRAFT was started from, never the newest one the page holds.
            void run(savePolicy.mutateAsync({ policy: draft, expectedUpdatedAt: baseUpdatedAt }).then((view) => (reset(), view)), "Saved. New jobs use it within a few seconds.")
          }}
          disabled={savePolicy.isPending}
        >
          Save
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            if (window.confirm("Put every model back on the default provider for new jobs?")) void run(revert.mutateAsync().then((view) => (reset(), view)), "Every model is back on the default provider.")
          }}
          disabled={revert.isPending}
        >
          Revert all to default
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">What the route took (last 7 days)</h2>
        <p className="text-sm text-muted-foreground">
          Requests per model and service: accepted by the alternate route, refused, or previously run on the default provider.
        </p>
        {data.outcomes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routed jobs yet.</p>
        ) : (
          <table className="text-xs">
            <thead>
              <tr className="text-start text-muted-foreground">
                <th className="pe-4 text-start">Model</th>
                <th className="pe-4 text-start">Service</th>
                <th className="pe-4 text-start">On the route</th>
                <th className="pe-4 text-start">Refused (why)</th>
                <th className="text-start">Historical default (why)</th>
              </tr>
            </thead>
            <tbody>
              {data.outcomes.map((o) => (
                <tr key={`${o.model}:${o.service}`}>
                  <td className="pe-4 font-mono">{o.model}</td>
                  <td className="pe-4 font-mono">{o.service}</td>
                  <td className="pe-4 tabular-nums">{o.alternate}</td>
                  <td className="pe-4">{Object.entries(o.refused).map(([why, n]) => `${why}: ${n}`).join(", ") || "—"}</td>
                  <td>{Object.entries(o.kept).map(([why, n]) => `${why}: ${n}`).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Held settlements">
        <h2 className="font-medium">Held settlements</h2>
        <p className="text-sm text-muted-foreground">
          A run whose verified bill is more than {data.policy.billAnomalyMultiple} times its quote is delivered but not charged until it is
          decided here: confirm charges it in full, reject releases the hold and records the loss. A run the route never billed is listed
          too, once every re-read is spent: settle it at its quote, or release it.
        </p>
        {data.holds.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is held.</p> : (
          <ul className="flex flex-col gap-2">
            {data.holds.map((hold) => (
              <li key={hold.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <div>
                  <p className="font-mono text-xs">Job {hold.jobId}</p>
                  {hold.kind === "unbilled" ? (
                    <p>The route never reported a bill for part of this run. Settle it at its quote, or release it.</p>
                  ) : (
                    <p className="tabular-nums">
                      Billed {hold.billedUsd === null ? "-" : usd(hold.billedUsd)} against a quote of {hold.quotedUsd === null ? "-" : usd(hold.quotedUsd)}
                      {hold.credits === null ? "" : ` · ${hold.credits} credits`}
                    </p>
                  )}
                  <p className="tabular-nums">
                    {hold.wouldCharge === null
                      ? "What a charge would take cannot be computed yet."
                      : hold.kind === "unbilled"
                        ? `Settling now charges ${hold.wouldCharge} credits (real bills where there are any, the quote for the rest). Releasing records ${hold.wouldCharge} credits as a loss.`
                        : `Confirming now charges ${hold.wouldCharge} credits. Rejecting records ${hold.wouldCharge} credits as a loss.`}
                  </p>
                  {hold.kind === "unbilled" && hold.totalAnomalous && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      That total is far above this run's quote: settling will not charge it, it will hold it for a separate confirmation.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{new Date(hold.heldAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    // A charge is decided for the total shown: with none to show, there is nothing to decide on yet.
                    disabled={decideHold.isPending || hold.wouldCharge === null}
                    title={hold.wouldCharge === null ? "Its total cannot be computed right now" : undefined}
                    onClick={() => {
                      if (hold.kind === "unbilled") {
                        if (window.confirm(hold.wouldCharge === null ? "Charge this run's unbilled parts at their quote?" : `Charge this run ${hold.wouldCharge} credits (real bills, and the quote for what the route never billed)?`)) void run(decideHold.mutateAsync({ jobId: hold.jobId, decision: "quote", ...(hold.wouldCharge !== null ? { expectedChargedCredits: hold.wouldCharge } : {}) }), "Settled at its quote.")
                      } else if (window.confirm(`Charge this run ${hold.wouldCharge ?? hold.credits ?? "its"} credits in full?`)) void run(decideHold.mutateAsync({ jobId: hold.jobId, decision: "confirm", ...(hold.wouldCharge !== null ? { expectedChargedCredits: hold.wouldCharge } : {}) }), "Confirmed. The run is charged in full.")
                    }}
                  >
                    {hold.kind === "unbilled" ? "Settle at quote" : "Confirm charge"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideHold.isPending}
                    onClick={() => {
                      if (window.confirm("Release this run's hold and record the bill as a loss?")) void run(decideHold.mutateAsync({ jobId: hold.jobId, decision: "reject" }), "Rejected. The hold is released.")
                    }}
                  >
                    {hold.kind === "unbilled" ? "Release" : "Reject"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Routing alerts">
        <h2 className="font-medium">Routing alerts</h2>
        <p className="text-sm text-muted-foreground">Internal price, balance and settlement alerts. These are never sent to customers.</p>
        {data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No alerts.</p> : (
          <ul className="flex flex-col gap-2">
            {data.alerts.map((alert) => (
              <li key={alert.key} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p>{alert.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(alert.updatedAt).toLocaleString()}{alert.model ? ` · ${alert.model}` : ""}{alert.jobId ? ` · Job ${alert.jobId}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Daily spend check</h2>
        <p className="text-sm text-muted-foreground">
          Each day, the cost recorded on routed jobs, and the known losses (jobs that failed after the route billed them), against
          what the route itself reports it spent. What is left beyond the threshold raises an alert: the route's rates may be wrong.
        </p>
        {data.spendDays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No day checked yet.</p>
        ) : (
          <table className="text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pe-4 text-start">Day</th>
                <th className="pe-4 text-start">Jobs</th>
                <th className="pe-4 text-start">Recorded</th>
                <th className="pe-4 text-start">Known losses</th>
                <th className="pe-4 text-start">Route reports</th>
                <th className="text-start">Unexplained</th>
              </tr>
            </thead>
            <tbody>
              {data.spendDays.map((d) => (
                <tr key={d.day}>
                  <td className="pe-4 font-mono">{d.day}</td>
                  <td className="pe-4 tabular-nums">{d.jobs}</td>
                  <td className="pe-4 tabular-nums">{usd(d.recordedUsd)}</td>
                  <td className="pe-4 tabular-nums">{d.failedJobs > 0 ? `${usd(d.lossesUsd)} (${d.failedJobs})` : "-"}</td>
                  <td className="pe-4 tabular-nums">{d.actualUsd === null ? "-" : usd(d.actualUsd)}</td>
                  <td className="tabular-nums">{d.unexplainedUsd === null ? "-" : usd(d.unexplainedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Price correction factors</h2>
        <p className="text-sm text-muted-foreground">
          A routed price is multiplied by its factor. Factors rise on their own when the route bills more than it quoted (one
          capped step at a time, with an alert), and never fall on their own. Set one to 1 to reset it.
        </p>
        {Object.keys(factors).length === 0 && <p className="text-sm text-muted-foreground">No factors: every routed price is the route's own.</p>}
        {Object.entries(factors).map(([key, value]) => (
          <label key={key} className="flex items-center justify-between gap-2 text-sm">
            <span className="font-mono text-xs">
              {key}
              {data.factors[key] ? ` (${data.factors[key]!.by}, ${new Date(data.factors[key]!.updatedAt).toLocaleDateString()})` : ""}
            </span>
            <Input className="w-28" inputMode="decimal" value={value} onChange={(e) => setFactors({ ...factors, [key]: e.target.value })} />
          </label>
        ))}
        {factorsStale && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 p-3 text-sm" role="alert">
            <span>The factors changed since you started editing them (a save, or an automatic raise). A save from here is refused; reload to see them.</span>
            <Button size="sm" variant="outline" onClick={resetFactors}>Reload</Button>
          </div>
        )}
        {Object.keys(factors).length > 0 && (
          <div>
            <Button
              variant="outline"
              onClick={() =>
                run(
                  saveFactors.mutateAsync({
                    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, { factor: Math.max(1, numberOrNull(v) ?? 1) }])),
                    // The table these inputs were started from, never the newest one the page holds.
                    expectedUpdatedAt: factorsBaseUpdatedAt,
                  }).then((view) => (resetFactors(), view)),
                  "Factors saved.",
                )
              }
              disabled={saveFactors.isPending}
            >
              Save factors
            </Button>
          </div>
        )}
      </section>

      {Object.keys(data.prices).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">The route's listed prices (as charged), beside the default provider's</h2>
          <p className="text-sm text-muted-foreground">A route price above the default one is highlighted. A reference-video row is the price of a reference as long as the output; a run with a shorter reference settles lower.</p>
          {Object.entries(data.prices).map(([model, rows]) => (
            <details key={model}>
              <summary className="cursor-pointer text-sm">{model} — {rows.length} prices</summary>
              <table className="mt-1 text-xs">
                <tbody>
                  <tr className="text-muted-foreground">
                    <th className="pe-4 text-start">Price id</th>
                    <th className="pe-4 text-start">Route</th>
                    <th className="text-start">Default provider</th>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="pe-4 font-mono">{row.id}</td>
                      <td className={row.defaultCharged !== null && row.charged > row.defaultCharged ? "pe-4 tabular-nums text-amber-600 dark:text-amber-400" : "pe-4 tabular-nums"}>{row.charged}</td>
                      <td className="tabular-nums">{row.defaultCharged ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      )}
    </div>
  )
}
