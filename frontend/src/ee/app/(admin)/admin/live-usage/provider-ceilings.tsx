import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { boundsMessage, wholeIn } from "./format"
import { InlineConfirm } from "./inline-confirm"
import type { Bounds, LaneConfig } from "./types"
import { useSaveProviderCeiling } from "./use-live-usage"

/** The ids the server accepts for a provider (its PUT checks the same). */
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** One provider's ceiling: Save changes it, Remove deletes it after asking (the provider is then not limited). */
function CeilingRow({ provider, ceiling, bounds }: { provider: string; ceiling: number; bounds: Bounds }) {
  const [draft, setDraft] = useState(String(ceiling))
  const [dirty, setDirty] = useState(false)
  const save = useSaveProviderCeiling()
  /** Remove asks first: it lifts a limit the whole platform runs under. */
  const [removing, setRemoving] = useState(false)
  const [seen, setSeen] = useState(ceiling)
  if (seen !== ceiling) {
    setSeen(ceiling)
    if (!dirty) setDraft(String(ceiling))
  }
  const value = wholeIn(draft, bounds)

  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pe-3 font-medium">{provider}</td>
      <td className="py-1.5 pe-2">
        <Input
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          aria-label={`${provider} ceiling`}
          className="h-8 w-24 tabular-nums"
          value={draft}
          onChange={(e) => {
            setDirty(true)
            setDraft(e.target.value)
          }}
        />
      </td>
      <td className="space-y-1 py-1.5">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || value === null || save.isPending}
            onClick={() => value !== null && save.mutate({ provider, ceiling: value }, { onSuccess: () => setDirty(false) })}
          >
            {save.isPending && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={save.isPending || removing} onClick={() => {
            save.reset()
            setRemoving(true)
          }}>
            Remove
          </Button>
        </div>
        {removing && (
          <InlineConfirm
            title={`Remove the ${provider} ceiling?`}
            body="The platform then runs any number of jobs at it at once."
            confirmLabel="Remove ceiling"
            cancelLabel="Keep ceiling"
            destructive
            pending={save.isPending}
            onConfirm={() => save.mutate({ provider, ceiling: null }, { onSettled: () => setRemoving(false) })}
            onCancel={() => setRemoving(false)}
          />
        )}
        {value === null && <p className="text-xs text-destructive">{boundsMessage("Ceiling", bounds)}</p>}
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
        {save.data?.applied === false && <p className="text-xs text-amber-600">Saved; the servers pick it up within 30 seconds.</p>}
      </td>
    </tr>
  )
}

function AddCeiling({ bounds, taken }: { bounds: Bounds; taken: ReadonlySet<string> }) {
  const [provider, setProvider] = useState("")
  const [ceiling, setCeiling] = useState("")
  const save = useSaveProviderCeiling()
  const id = provider.trim()
  const value = wholeIn(ceiling, bounds)
  const badId = id !== "" && !PROVIDER_ID.test(id)
  const badCeiling = ceiling.trim() !== "" && value === null

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New provider"
          placeholder="provider id"
          dir="ltr"
          className="h-8 w-40"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          aria-label="New provider ceiling"
          placeholder="ceiling"
          className="h-8 w-24 tabular-nums"
          value={ceiling}
          onChange={(e) => setCeiling(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={id === "" || badId || value === null || taken.has(id) || save.isPending}
          onClick={() => value !== null && save.mutate({ provider: id, ceiling: value }, {
            onSuccess: () => {
              setProvider("")
              setCeiling("")
            },
          })}
        >
          Add ceiling
        </Button>
      </div>
      {badId && <p className="text-xs text-destructive">Provider: lowercase letters, digits, “.”, “_” or “-”, as the provider is named in jobs.</p>}
      {taken.has(id) && <p className="text-xs text-muted-foreground">{id} already has a ceiling; change it above.</p>}
      {badCeiling && <p className="text-xs text-destructive">{boundsMessage("Ceiling", bounds)}</p>}
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
    </div>
  )
}

/**
 * The most jobs the whole platform runs at once at one provider, whoever asks.
 * A provider with no ceiling is not limited across the platform.
 */
export function ProviderCeilings({ config }: { config: LaneConfig }) {
  const rows = Object.entries(config.providerCeilings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const bounds = config.bounds.providerCeiling
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Provider ceilings</h3>
      <p className="text-xs text-muted-foreground">
        The most jobs the whole platform runs at once at one provider, across every user. A provider with no ceiling is not limited.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No provider has a ceiling.</p>
      ) : (
        <table aria-label="Provider ceilings" className="text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 pe-3 text-start font-medium">Provider</th>
              <th className="py-1.5 pe-2 text-start font-medium">Ceiling</th>
              {config.editable && <th className="py-1.5 text-start font-medium"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([provider, ceiling]) => config.editable ? (
              <CeilingRow key={provider} provider={provider} ceiling={ceiling} bounds={bounds} />
            ) : (
              <tr key={provider} className="border-b last:border-0">
                <td className="py-2 pe-3 font-medium">{provider}</td>
                <td className="py-2 pe-2 tabular-nums">{ceiling}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {config.editable && <AddCeiling bounds={bounds} taken={new Set(rows.map(([p]) => p))} />}
    </section>
  )
}
