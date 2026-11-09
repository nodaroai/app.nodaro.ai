import { useEffect, useState } from "react"
import { Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProviderSafety, useSaveProviderSafety } from "@/ee/hooks/queries/use-provider-safety"
import type {
  LeverValueLock,
  ProviderSafetyLever,
  ProviderSafetyOverrides,
  ProviderSafetyValueOption,
  SafetyValue,
} from "@/ee/lib/provider-safety-api"

/**
 * Admin → Provider safety: per model, what an admin can change about the
 * provider's own content filter (`backend/src/lib/provider-safety.ts`). Levers
 * and limits come from the server; this page only renders them and saves.
 *
 * DIRECTION: logical Tailwind properties only (see the review page's note).
 */
const AS_TODAY = "__today__"

/** Why this one setting is locked. Loosening being locked everywhere is said once, at the top of the page. */
const LOCK_TEXT: Partial<Record<LeverValueLock, string>> = {
  "never-loosen": "Never loosened: this model works from a real person, or always takes an input image or video.",
  "wire-unconfirmed": "Locked until a test run has confirmed this setting on the provider.",
}

function valueLabel(lever: ProviderSafetyLever, value: SafetyValue): string {
  if (lever.kind === "boolean") return value === lever.filterOnValue ? "Filter on" : "Filter off"
  return String(value)
}

function optionLabel(lever: ProviderSafetyLever, option: ProviderSafetyValueOption): string {
  const relation = option.relation === "today" ? " (today)" : option.relation === "stricter" ? " (stricter)" : " (looser)"
  return valueLabel(lever, option.value) + relation
}

function LeverControl({
  modelId,
  lever,
  value,
  onChange,
}: {
  modelId: string
  lever: ProviderSafetyLever
  value: SafetyValue | null
  onChange: (next: SafetyValue | null) => void
}) {
  const current = value === null ? AS_TODAY : String(value)
  const locks = [...new Set(lever.options.flatMap((o) => (o.lock && LOCK_TEXT[o.lock] ? [o.lock] : [])))]
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs text-muted-foreground">{lever.param}</span>
      <Select
        value={current}
        onValueChange={(next) => {
          if (next === AS_TODAY) return onChange(null)
          const option = lever.options.find((o) => String(o.value) === next)
          onChange(option ? option.value : null)
        }}
      >
        <SelectTrigger className="w-44" aria-label={`${modelId} ${lever.param}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AS_TODAY}>As today ({valueLabel(lever, lever.today)})</SelectItem>
          {lever.options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)} disabled={Boolean(option.lock)}>
              {optionLabel(lever, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {lever.probePending && <span className="text-xs text-muted-foreground">Documented; not yet confirmed by a test run.</span>}
      {locks.map((lock) => (
        <span key={lock} className="text-xs text-amber-600 dark:text-amber-400">
          {LOCK_TEXT[lock]}
        </span>
      ))}
    </div>
  )
}

export default function AdminProviderSafetyPage() {
  const { data, isLoading, isError } = useProviderSafety()
  const save = useSaveProviderSafety()
  const [draft, setDraft] = useState<ProviderSafetyOverrides>({})

  // The saved setting, as the page's editable copy.
  useEffect(() => {
    if (!data) return
    const next: ProviderSafetyOverrides = {}
    for (const group of data.groups) {
      for (const model of group.models) {
        const saved: Record<string, SafetyValue> = {}
        for (const lever of model.levers) if (lever.override !== null) saved[lever.param] = lever.override
        if (Object.keys(saved).length > 0) next[model.modelId] = saved
      }
    }
    setDraft(next)
  }, [data])

  function setValue(modelId: string, param: string, value: SafetyValue | null) {
    setDraft((prev) => {
      const nextModel = { ...(prev[modelId] ?? {}) }
      if (value === null) delete nextModel[param]
      else nextModel[param] = value
      const next = { ...prev, [modelId]: nextModel }
      if (Object.keys(nextModel).length === 0) delete next[modelId]
      return next
    })
  }

  async function onSave() {
    try {
      await save.mutateAsync(draft)
      toast.success("Saved. Workers use it within a few seconds.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save")
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (isError || !data) return <div className="p-6 text-sm text-destructive">Could not load the provider safety settings.</div>

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Provider safety</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          What an account can change about each provider&apos;s own content filter. A provider&apos;s model moderation that it does not expose as a
          setting cannot be changed from here. Requests that carry an input image or video always keep today&apos;s filter, and anything made on a
          loosened model stays out of the public gallery.
        </p>
      </header>

      {!(data.guardRegistered && data.resultCheckRegistered) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Loosening is locked until this deployment has both a content guard and a check of what models actually make. Filters can still be made stricter.</span>
        </div>
      )}

      {data.groups.map((group) => (
        <section key={group.provider} className="space-y-2">
          <h2 className="text-lg font-medium">{group.label}</h2>
          <div className="divide-y rounded-md border">
            {group.models.map((model) => (
              <div key={model.modelId} className="flex flex-wrap items-start justify-between gap-4 p-3">
                <div>
                  <div className="text-sm font-medium">{model.label}</div>
                  <div className="font-mono text-xs text-muted-foreground">{model.modelId}</div>
                </div>
                <div className="flex flex-wrap gap-4">
                  {model.levers.map((lever) => (
                    <LeverControl
                      key={lever.param}
                      modelId={model.modelId}
                      lever={lever}
                      value={draft[model.modelId]?.[lever.param] ?? null}
                      onChange={(next) => setValue(model.modelId, lever.param, next)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {group.withoutLever.length > 0 && (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">
                {group.withoutLever.length} models with no filter setting from {group.label}
              </summary>
              <p className="mt-1 font-mono text-xs">{group.withoutLever.join(", ")}</p>
            </details>
          )}
        </section>
      ))}

      <div className="flex items-center gap-3">
        <Button onClick={() => void onSave()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
        {data.updatedAt && <span className="text-xs text-muted-foreground">Last saved {new Date(data.updatedAt).toLocaleString()}</span>}
      </div>
    </div>
  )
}
