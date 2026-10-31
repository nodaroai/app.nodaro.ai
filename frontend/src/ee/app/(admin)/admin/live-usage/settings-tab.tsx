import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EnforcementSwitch } from "./enforcement-switch"
import { boundsMessage, wholeIn } from "./format"
import { PlanSizesTable } from "./plan-sizes-table"
import { ProviderCeilings } from "./provider-ceilings"
import type { Bounds, LaneConfig } from "./types"
import { useLaneConfig, useSaveLaneSettings } from "./use-live-usage"

type LimitsDraft = { queue: string; live: string }

const draftOf = (c: LaneConfig): LimitsDraft => ({ queue: String(c.settings.queueTimeoutMinutes), live: String(c.settings.liveWaitMinutes) })

function MinutesField({ id, label, hint, value, bounds, readOnly, onChange }: {
  id: string
  label: string
  hint: string
  value: string
  bounds: Bounds
  readOnly: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label} (minutes)</Label>
      {readOnly ? (
        <p id={id} className="text-sm tabular-nums">{value}</p>
      ) : (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          className="h-8 w-28 tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">{hint} {bounds.min} to {bounds.max} minutes.</p>
    </div>
  )
}

/**
 * The queue timeout and the live-wait limit, saved together. The live-wait
 * limit's maximum is what the server allows today (`liveWaitMaxMinutes`).
 */
function WaitingLimits({ config }: { config: LaneConfig }) {
  const [draft, setDraft] = useState<LimitsDraft>(() => draftOf(config))
  const [dirty, setDirty] = useState(false)
  const save = useSaveLaneSettings()
  const serverKey = JSON.stringify(config.settings)
  const [seenKey, setSeenKey] = useState(serverKey)
  if (serverKey !== seenKey) {
    setSeenKey(serverKey)
    if (!dirty) setDraft(draftOf(config))
  }

  const queueBounds = config.bounds.queueTimeoutMinutes
  const liveBounds: Bounds = { min: config.bounds.liveWaitMinutes.min, max: config.settings.liveWaitMaxMinutes }
  const queue = wholeIn(draft.queue, queueBounds)
  const live = wholeIn(draft.live, liveBounds)
  const edit = (patch: Partial<LimitsDraft>) => {
    setDirty(true)
    setDraft({ ...draft, ...patch })
  }

  return (
    <fieldset aria-label="Waiting limits" className="space-y-3">
      <h3 className="text-sm font-semibold">Waiting limits</h3>
      <div className="flex flex-wrap gap-6">
        <MinutesField
          id="lanes-queue-timeout"
          label="Queue timeout"
          hint="How long a queued job may wait for a free slot; past it the job fails and is refunded."
          value={draft.queue}
          bounds={queueBounds}
          readOnly={!config.editable}
          onChange={(v) => edit({ queue: v })}
        />
        <MinutesField
          id="lanes-live-wait"
          label="Live-wait limit"
          hint="How long a request answered while you wait may wait for a free slot; past it the request answers that the server is busy."
          value={draft.live}
          bounds={liveBounds}
          readOnly={!config.editable}
          onChange={(v) => edit({ live: v })}
        />
      </div>
      {queue === null && <p className="text-xs text-destructive">{boundsMessage("Queue timeout", queueBounds, "minutes")}</p>}
      {live === null && <p className="text-xs text-destructive">{boundsMessage("Live-wait limit", liveBounds, "minutes")}</p>}
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      {save.isSuccess && !dirty && <p className="text-xs text-muted-foreground">Saved.</p>}
      {config.editable && (
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || queue === null || live === null || save.isPending}
          onClick={() => queue !== null && live !== null && save.mutate({ queueTimeoutMinutes: queue, liveWaitMinutes: live }, { onSuccess: () => setDirty(false) })}
        >
          {save.isPending && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
          Save limits
        </Button>
      )}
    </fieldset>
  )
}

/**
 * Admin → Live usage → Settings: each plan's sizes, the providers' ceilings,
 * the two waiting limits, and this environment's switch. All but the switch
 * live in the shared database, so they apply to every environment that reads
 * it; the switch is this environment's own. Read-only where there are no plans
 * (`editable: false`); the switch there still works.
 */
export function SettingsTab() {
  const { data: config, error, isLoading } = useLaneConfig()

  return (
    <section aria-label="Lane settings" className="space-y-8">
      {isLoading && !config ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : !config ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load the lane configuration."}</p>
      ) : (
        <>
          <p role="note" className="rounded-lg border px-4 py-3 text-sm">
            {config.editable && config.sharedAcrossEnvironments
              ? "Plan sizes, user overrides, provider ceilings and the waiting limits are shared by every environment that uses this database (staging and production alike): a change here applies to all of them. Only the switch below is set per environment."
              : "Lane sizes and the waiting limits come from each server's environment variables here. The switch below is set per environment."}
          </p>
          <EnforcementSwitch config={config} />
          <PlanSizesTable config={config} />
          <ProviderCeilings config={config} />
          <WaitingLimits config={config} />
        </>
      )}
    </section>
  )
}
