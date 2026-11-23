/**
 * Admin → Remake faults: the filter bar. Controlled: every change goes out
 * through `onChange` as a whole `RemakeFaultFilters`, and the page goes back
 * to the first page.
 *
 * The kinds offered are the ones the range's runs recorded (the server's
 * `kinds`, the severity and kind filters not applied), so a new kind appears
 * without a release; a picked kind the range no longer has stays offered, so
 * the select never shows a value it lacks. Native controls, 44 px targets,
 * two to a row on a phone, one wrapping row from 640 px (the price check's).
 */
import { useId } from "react"
import { Input } from "@/components/ui/input"
import type { CastSwapFaultSeverity } from "@/lib/api"
import type { RemakeEngine } from "@/ee/lib/remake-faults-api"

export interface RemakeFaultFilters {
  fromDay: string
  toDay: string
  severity: CastSwapFaultSeverity | "all"
  /** A recorded kind, or "" for every kind. */
  kind: string
  engine: RemakeEngine | "all"
}

interface Option<T extends string> {
  value: T
  label: string
}

const SEVERITIES: readonly Option<RemakeFaultFilters["severity"]>[] = [
  { value: "all", label: "All severities" },
  { value: "blocked", label: "Blocked" },
  { value: "recovered", label: "Recovered" },
  { value: "warning", label: "Warning" },
]
const ENGINES: readonly Option<RemakeFaultFilters["engine"]>[] = [
  { value: "all", label: "All engines" },
  { value: "prism", label: "Prism" },
  { value: "pulse", label: "Pulse" },
]

const FIELD = "flex min-w-0 flex-col gap-1"
const LABEL = "text-xs font-medium text-muted-foreground"
const SELECT =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

function Choice<T extends string>(p: {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange(next: T): void
  width?: string
}) {
  const id = useId()
  return (
    <div className={`${FIELD} ${p.width ?? "sm:w-40"}`}>
      <label htmlFor={id} className={LABEL}>
        {p.label}
      </label>
      <select
        id={id}
        value={p.value}
        onChange={(e) => p.onChange(p.options.find((o) => o.value === e.target.value)?.value ?? p.value)}
        className={SELECT}
      >
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The kind select's options: every kind, then the range's kinds, with a picked one the range lacks kept. */
export function kindOptions(kinds: readonly string[], picked: string): Option<string>[] {
  const all = picked !== "" && !kinds.includes(picked) ? [...kinds, picked] : [...kinds]
  return [{ value: "", label: "All kinds" }, ...all.map((k) => ({ value: k, label: k }))]
}

export function FiltersBar({
  value,
  kinds,
  onChange,
  rangeError,
}: {
  value: RemakeFaultFilters
  kinds: readonly string[]
  onChange(next: RemakeFaultFilters): void
  rangeError: string | null
}) {
  const fromId = useId()
  const toId = useId()
  const set = (patch: Partial<RemakeFaultFilters>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <div className={`${FIELD} sm:w-40`}>
          <label htmlFor={fromId} className={LABEL}>
            From
          </label>
          <Input
            id={fromId}
            type="date"
            className="h-11"
            value={value.fromDay}
            max={value.toDay || undefined}
            onChange={(e) => set({ fromDay: e.target.value })}
            aria-invalid={rangeError !== null || undefined}
          />
        </div>
        <div className={`${FIELD} sm:w-40`}>
          <label htmlFor={toId} className={LABEL}>
            To
          </label>
          <Input
            id={toId}
            type="date"
            className="h-11"
            value={value.toDay}
            min={value.fromDay || undefined}
            onChange={(e) => set({ toDay: e.target.value })}
            aria-invalid={rangeError !== null || undefined}
          />
        </div>
        <Choice label="Severity" value={value.severity} options={SEVERITIES} onChange={(severity) => set({ severity })} />
        <Choice label="Kind" value={value.kind} options={kindOptions(kinds, value.kind)} onChange={(kind) => set({ kind })} width="sm:w-56" />
        <Choice label="Engine" value={value.engine} options={ENGINES} onChange={(engine) => set({ engine })} />
      </div>
      {rangeError !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {rangeError}
        </p>
      )}
    </div>
  )
}
