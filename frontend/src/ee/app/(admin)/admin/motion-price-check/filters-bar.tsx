/**
 * Admin → Motion price check: the filter bar. Controlled: every change goes
 * out through `onChange` as a whole `MotionPriceFilters`, and the page goes
 * back to the first page (and, when the range moved, drops KIE's figures).
 *
 * A new sort takes the direction the API defaults it to: the margins worst
 * first, the other figures biggest first, the date newest first. The toggle
 * then flips it. Native controls, so a phone shows its own pickers; two to a
 * row on a phone, one wrapping row from 640 px. Every control is a 44 px
 * target (the Flagged only box through its whole label row).
 */
import { useId } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MotionEngine, MotionKind, MotionSort, MotionStyle } from "@/ee/lib/motion-price-check-api"

export interface MotionPriceFilters {
  fromDay: string
  toDay: string
  engine: MotionEngine | "all"
  style: MotionStyle | "all"
  kind: MotionKind | "all"
  resolution: "480p" | "720p" | "1080p" | "all"
  flaggedOnly: boolean
  sort: MotionSort
  dir: "asc" | "desc"
}

interface Option<T extends string> {
  value: T
  label: string
}

const ENGINES: readonly Option<MotionPriceFilters["engine"]>[] = [
  { value: "all", label: "All engines" },
  { value: "prism", label: "Prism" },
  { value: "pulse", label: "Pulse" },
]
const STYLES: readonly Option<MotionPriceFilters["style"]>[] = [
  { value: "all", label: "All styles" },
  { value: "precise", label: "Precise" },
  { value: "flex", label: "Flex" },
]
const KINDS: readonly Option<MotionPriceFilters["kind"]>[] = [
  { value: "all", label: "All runs" },
  { value: "trend", label: "Trend" },
  { value: "hand", label: "Hand" },
]
const RESOLUTIONS: readonly Option<MotionPriceFilters["resolution"]>[] = [
  { value: "all", label: "All resolutions" },
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
]
const SORTS: readonly Option<MotionSort>[] = [
  { value: "margin_usd", label: "Margin $" },
  { value: "margin_pct", label: "Margin %" },
  { value: "paid_usd", label: "Paid $" },
  { value: "taken", label: "Taken" },
  { value: "created_at", label: "Date" },
]

/** The direction a sort reads best in, as the API defaults it. */
const naturalDir = (sort: MotionSort): "asc" | "desc" => (sort === "margin_usd" || sort === "margin_pct" ? "asc" : "desc")

const FIELD = "flex min-w-0 flex-col gap-1"
const LABEL = "text-xs font-medium text-muted-foreground"
const SELECT =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

function Choice<T extends string>(p: {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange(next: T): void
}) {
  const id = useId()
  return (
    <div className={`${FIELD} sm:w-36`}>
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

export function FiltersBar({
  value,
  onChange,
  rangeError,
}: {
  value: MotionPriceFilters
  onChange(next: MotionPriceFilters): void
  rangeError: string | null
}) {
  const fromId = useId()
  const toId = useId()
  const set = (patch: Partial<MotionPriceFilters>) => onChange({ ...value, ...patch })
  const ascending = value.dir === "asc"

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
        <Choice label="Engine" value={value.engine} options={ENGINES} onChange={(engine) => set({ engine })} />
        <Choice label="Style" value={value.style} options={STYLES} onChange={(style) => set({ style })} />
        <Choice label="Kind" value={value.kind} options={KINDS} onChange={(kind) => set({ kind })} />
        <Choice
          label="Resolution"
          value={value.resolution}
          options={RESOLUTIONS}
          onChange={(resolution) => set({ resolution })}
        />
        <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:col-span-1">
          <input
            type="checkbox"
            className="size-4"
            checked={value.flaggedOnly}
            onChange={(e) => set({ flaggedOnly: e.target.checked })}
          />
          Flagged only
        </label>
        <Choice label="Sort" value={value.sort} options={SORTS} onChange={(sort) => set({ sort, dir: naturalDir(sort) })} />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          title="Flip the sort direction"
          onClick={() => set({ dir: ascending ? "desc" : "asc" })}
        >
          {ascending ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
          {ascending ? "Ascending" : "Descending"}
        </Button>
      </div>
      {rangeError !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {rangeError}
        </p>
      )}
    </div>
  )
}
