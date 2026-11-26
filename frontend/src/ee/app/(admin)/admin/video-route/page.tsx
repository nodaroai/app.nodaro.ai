import { useEffect, useState } from "react"
import { Loader2, Route as RouteIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  useRevertVideoRoutePolicy,
  useSaveVideoRouteFactors,
  useSaveVideoRoutePolicy,
  useVideoRoute,
} from "@/ee/hooks/queries/use-video-route"
import type { VideoRouteChoice, VideoRoutePolicy, VideoRouteView } from "@/ee/lib/video-route-api"

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
              This environment's route cannot take this model: it runs on the default provider at the default price here.
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
  const [draft, setDraft] = useState<VideoRoutePolicy | null>(null)
  const [factors, setFactors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!data) return
    setDraft(data.policy)
    setFactors(Object.fromEntries(Object.entries(data.factors).map(([k, f]) => [k, String(f.factor)])))
  }, [data])

  if (isLoading || !draft) {
    return isError ? <p className="p-6 text-sm text-destructive">Could not load the video route setting.</p> : <Loader2 className="m-6 size-5 animate-spin" />
  }
  if (!data) return null
  const services = [...data.services.platform, ...data.services.plugin]

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p
      toast.success(ok)
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
            Which provider runs each Seedance model. A change applies to new jobs only, in every environment on this
            database. A run on the alternate route is charged what the route billed, with the same markup.
          </p>
          <p className="text-xs text-muted-foreground">
            This environment: {data.route.present ? (data.route.v2 ? "an alternate route is loaded" : "the loaded route predates per-model routing") : "no alternate route is loaded"}.
            {data.updatedAt ? ` Last saved ${new Date(data.updatedAt).toLocaleString()}.` : " Never saved: every model is on the default provider."}
          </p>
        </div>
      </header>

      {!data.routesPerModel && (
        <p className="rounded-md border border-amber-500/40 p-3 text-sm text-amber-700 dark:text-amber-300">
          This build cannot run a model on the alternate route yet: every model stays on the default provider.
        </p>
      )}

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
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run(savePolicy.mutateAsync(draft), "Saved. New jobs use it within a few seconds.")} disabled={savePolicy.isPending}>
          Save
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            if (window.confirm("Put every model back on the default provider for new jobs?")) void run(revert.mutateAsync(), "Every model is back on the default provider.")
          }}
          disabled={revert.isPending}
        >
          Revert all to default
        </Button>
      </div>

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
        {Object.keys(factors).length > 0 && (
          <div>
            <Button
              variant="outline"
              onClick={() =>
                run(
                  saveFactors.mutateAsync({
                    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, { factor: Math.max(1, numberOrNull(v) ?? 1) }])),
                    expectedUpdatedAt: data.factorsUpdatedAt,
                  }),
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
          <h2 className="font-medium">The route's listed prices (as charged)</h2>
          {Object.entries(data.prices).map(([model, rows]) => (
            <details key={model}>
              <summary className="cursor-pointer text-sm">{model} — {rows.length} prices</summary>
              <table className="mt-1 text-xs">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="pe-4 font-mono">{row.id}</td>
                      <td className="tabular-nums">{row.charged}</td>
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
