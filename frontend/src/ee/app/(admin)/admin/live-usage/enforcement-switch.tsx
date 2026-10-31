import { useId, useState } from "react"
import { Check, X } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { InlineConfirm } from "./inline-confirm"
import type { LaneConfig, UnmetPrecondition } from "./types"
import { useSetLanesEnforced } from "./use-live-usage"

export const ENFORCE_WARNING = "Turning this on makes jobs wait for a free slot instead of starting at once. Check every item below first."
export const TURN_OFF_WARNING = "Turning this off starts every waiting job now."
export const NOT_AVAILABLE_YET = "Not available yet — limits can't be turned on in this release."

/** The four items the switch lists, in the server's order. "available" is the release lock, said apart. */
type Item = Exclude<UnmetPrecondition, "available">

interface Line { item: Item; label: string; detail: string | null }

function lines(config: LaneConfig): Line[] {
  const p = config.preconditions
  const days = p.measureDays
  const plugins = p.pluginLoadFailed === true
    ? "The plugins failed to load in this process, so their job types were not checked."
    : !p.pluginTypesKnown
      ? "Not checked yet in this process."
      : p.undeclaredPluginTypes.length > 0 ? p.undeclaredPluginTypes.join(", ") : null
  // A count is only a finding once the plugins were read; until then (or when they failed to load) it would read as "none".
  const pluginCount = p.pluginLoadFailed === true || !p.pluginTypesKnown ? "not checked" : `${p.undeclaredPluginTypes.length} undeclared`
  return [
    { item: "columns", label: "Lane columns are in this database", detail: null },
    { item: "plugins", label: `Every plugin job type declares its lane (${pluginCount})`, detail: plugins },
    { item: "liveCeiling", label: "The live-wait ceiling has been measured", detail: null },
    { item: "measureDays", label: "At least 7 days of measure-only data", detail: `${days} ${days === 1 ? "day" : "days"} so far in this environment.` },
  ]
}

function Preconditions({ config }: { config: LaneConfig }) {
  const unmet = new Set(config.unmet)
  return (
    <ul aria-label="Preconditions" className="space-y-1.5">
      {lines(config).map(({ item, label, detail }) => {
        const met = !unmet.has(item)
        return (
          <li key={item} data-met={met} className="flex items-start gap-2 text-sm">
            {met
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              : <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
            <span className="sr-only">{met ? "Met: " : "Not met: "}</span>
            <div>
              <span className={cn(!met && "text-amber-700 dark:text-amber-500")}>{label}</span>
              {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** What the admin is being asked to confirm, or nothing. */
type Asking = "on" | "off" | null

function Confirm({ asking, unmetCount, pending, onConfirm, onCancel }: {
  asking: Exclude<Asking, null>
  unmetCount: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const on = asking === "on"
  return (
    <InlineConfirm
      title={on ? "Turn concurrency limits on?" : "Turn concurrency limits off?"}
      body={on
        ? unmetCount > 0
          ? `${unmetCount === 1 ? "1 item below is not met" : `${unmetCount} items below are not met`}. Jobs will wait for a free slot from now on.`
          : "Every item below is met. Jobs will wait for a free slot from now on."
        : TURN_OFF_WARNING}
      confirmLabel={on ? (unmetCount > 0 ? "Turn on anyway" : "Turn on") : "Turn off"}
      destructive={on && unmetCount > 0}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/**
 * This environment's `lanes_enforced` switch. Off is measure-only: every job
 * starts at once and the lanes only count. The switch never changes on a
 * click alone; it asks first, and with items unmet only "Turn on anyway"
 * turns it on. While this release cannot turn limits on, it is disabled
 * (turning them off stays possible) and offers nothing of the kind.
 */
export function EnforcementSwitch({ config }: { config: LaneConfig }) {
  const [asking, setAsking] = useState<Asking>(null)
  const set = useSetLanesEnforced()
  const locked = !config.available
  const unmetCount = config.unmet.filter((u) => u !== "available").length
  const switchId = useId()

  const confirm = () => {
    if (asking === null) return
    const on = asking === "on"
    set.mutate(on ? (unmetCount > 0 ? { on, confirmUnmet: true } : { on }) : { on }, { onSettled: () => setAsking(null) })
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Concurrency limits</h3>
      <div className="flex items-center gap-3">
        <Switch
          id={switchId}
          aria-label={`Concurrency limits in ${config.env}`}
          checked={config.enforced}
          disabled={(locked && !config.enforced) || set.isPending}
          onCheckedChange={(next) => {
            set.reset()
            setAsking(next ? "on" : "off")
          }}
        />
        <label htmlFor={switchId} className="text-sm">
          {config.enforced ? "On: jobs over a limit wait for a free slot." : "Off: measure-only. Every job starts at once; the lanes only count."}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        This switch is only for {config.env}: every environment keeps its own, even on a shared database.
      </p>
      {!config.enforced && (
        locked
          ? <p role="status" className="text-sm font-medium">{NOT_AVAILABLE_YET}</p>
          : <p className="text-sm">{ENFORCE_WARNING}</p>
      )}
      <Preconditions config={config} />
      {asking !== null && !(asking === "on" && locked) && (
        <Confirm asking={asking} unmetCount={unmetCount} pending={set.isPending} onConfirm={confirm} onCancel={() => setAsking(null)} />
      )}
      {set.error && <p className="text-xs text-destructive">{set.error.message}</p>}
    </section>
  )
}
