/**
 * The admin Jobs page's filter bar: one wrapping row of controls, the active
 * filters as chips below it, and Clear all. Controlled — every change goes
 * out through `onChange` as a whole `AdminJobFilters`, which the page writes
 * to the URL. A pick is a step of its own (a new history entry); a search,
 * sent as the admin types, says `replace` so it does not add one per pause.
 *
 * Every list this bar builds stays inside what `GET /v1/admin/jobs` accepts
 * (`LIST_ITEM`, at most `LIST_MAX` items — `MODEL_PICK_MAX` exact models, which
 * grow by their stored values on the way), so a pick or a typed value can
 * never turn the list into a 400.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { otherJobTypes, typesOfKind, type JobKind } from "./job-kinds"
import { modelLines } from "./model-lines"
import {
  DEFAULT_JOB_FILTERS,
  LIST_ITEM,
  LIST_MAX,
  MODEL_PICK_MAX,
  serverParams,
  type AdminJobFilters,
  type JobKindFilter,
} from "./jobs-filters"

export interface JobsFilterBarProps {
  filters: AdminJobFilters
  /** `replace`: this change refines the last one (a search being typed) rather than being a step of its own. */
  onChange: (next: AdminJobFilters, how?: { replace: true }) => void
  sources: ReadonlyArray<{ key: string; label: string; count: number }>
}

const KINDS: ReadonlyArray<{ value: JobKindFilter; label: string }> = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "music", label: "Music" },
  { value: "text", label: "Text" },
  { value: "other", label: "Other" },
]
const FIVE_KINDS: readonly JobKind[] = ["video", "image", "audio", "music", "text"]
/** Radix Select refuses an empty item value: "no filter" needs a value of its own. */
const ANY = "__any"
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_MIN_CHARS = 3
const SEARCH_MAX_CHARS = 200
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/

interface Option {
  value: string
  label: string
  hint?: string
}

let allTypes: string[] | null = null
/** Every type the Type control knows, for an exact pick with no kind chosen. */
function everyKnownType(): string[] {
  allTypes ??= [...new Set([...FIVE_KINDS.flatMap(typesOfKind), ...otherJobTypes()])].sort()
  return allTypes
}

function typeOptions(kind: JobKindFilter | undefined): Option[] {
  const types = kind === "other" ? otherJobTypes() : kind ? typesOfKind(kind) : everyKnownType()
  return types.map((t) => ({ value: t, label: t }))
}

function modelOptions(line: string | undefined): Option[] {
  const seen = new Set<string>()
  const out: Option[] = []
  for (const l of modelLines()) {
    if (line && l.line !== line) continue
    for (const m of l.models) {
      if (seen.has(m.id) || !LIST_ITEM.test(m.id)) continue
      seen.add(m.id)
      out.push({ value: m.id, label: m.label, hint: m.label === m.id ? undefined : m.id })
    }
  }
  return out
}

function kindLabel(kind: JobKindFilter): string {
  return KINDS.find((k) => k.value === kind)?.label ?? kind
}

/** A list in a chip: the first few, then a count. */
function summary(items: readonly string[]): string {
  return items.length <= 3 ? items.join(", ") : `${items.slice(0, 3).join(", ")} +${items.length - 3}`
}

/** A minimum-credits draft as a filter: a positive whole number, else no filter. */
function creditsValue(draft: string): number | undefined {
  const text = draft.trim()
  if (!/^\d{1,9}$/.test(text)) return undefined
  const n = Number(text)
  return n > 0 ? n : undefined
}

/** The search a draft stands for: 3+ characters or a job id; anything shorter (empty included) is no search. */
function searchValue(draft: string): string | undefined {
  const q = draft.trim()
  return q.length >= SEARCH_MIN_CHARS || UUID_TEXT.test(q) ? q : undefined
}

/** A searchable multi-pick (Popover + Command). `allowTyped` offers the typed text as a value of its own. */
function MultiSelect({
  label,
  emptyLabel,
  placeholder,
  options,
  selected,
  onChange,
  allowTyped = false,
  normalizeTyped = (text) => text,
  max = LIST_MAX,
}: {
  label: string
  emptyLabel: string
  placeholder: string
  options: readonly Option[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  allowTyped?: boolean
  /** How a typed value is stored (row types are lower case; model ids keep their case). */
  normalizeTyped?: (text: string) => string
  /** The most values it takes. */
  max?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const chosen = new Set(selected)
  const known = new Set(options.map((o) => o.value))
  // A chosen value the list does not offer (typed, or from another kind) stays visible so it can be removed.
  const shown: Option[] = [...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })), ...options]
  const full = selected.length >= max
  const typed = normalizeTyped(search.trim())
  const offerTyped = allowTyped && LIST_ITEM.test(typed) && !known.has(typed) && !chosen.has(typed) && !full

  const toggle = (value: string) => {
    if (chosen.has(value)) onChange(selected.filter((v) => v !== value))
    else if (!full && LIST_ITEM.test(value)) onChange([...selected, value])
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch("") }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="h-8 max-w-[180px] justify-between font-normal">
          <span className="truncate">{selected.length === 0 ? emptyLabel : selected.length === 1 ? selected[0] : `${selected.length} selected`}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {!offerTyped && <CommandEmpty>Nothing matches.</CommandEmpty>}
            {offerTyped && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`__typed ${typed}`} onSelect={() => { toggle(typed); setSearch("") }}>
                  {`Use "${typed}"`}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {shown.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label]}
                  disabled={full && !chosen.has(o.value)}
                  onSelect={() => toggle(o.value)}
                >
                  <Check className={cn("h-4 w-4", chosen.has(o.value) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function JobsFilterBar({ filters, onChange, sources }: JobsFilterBarProps) {
  const set = (patch: Partial<AdminJobFilters>) => onChange({ ...filters, ...patch })

  // The latest props, for the debounced search: a filter changed inside the
  // 300 ms window must not be overwritten by the copy the timer captured.
  const latest = useRef({ filters, onChange })
  latest.current = { filters, onChange }

  const [creditsDraft, setCreditsDraft] = useState(filters.minCredits === undefined ? "" : String(filters.minCredits))
  useEffect(() => {
    setCreditsDraft(filters.minCredits === undefined ? "" : String(filters.minCredits))
  }, [filters.minCredits])
  const commitCredits = () => {
    const next = creditsValue(creditsDraft)
    setCreditsDraft(next === undefined ? "" : String(next))
    if (next !== filters.minCredits) set({ minCredits: next })
  }

  const [searchDraft, setSearchDraft] = useState(filters.q ?? "")
  const sentQ = useRef(filters.q)
  useEffect(() => {
    // Follow a q set from outside (a chip, Clear all, the URL), not the one this box just sent.
    if (filters.q !== sentQ.current) {
      sentQ.current = filters.q
      setSearchDraft(filters.q ?? "")
    }
  }, [filters.q])
  useEffect(() => {
    // The box shows the applied search (a link's, even a short one): nothing to send.
    if (searchDraft.trim() === (latest.current.filters.q ?? "")) return
    // A draft cut below 3 characters clears an applied search, after the same wait.
    const q = searchValue(searchDraft)
    if (q === latest.current.filters.q) return
    const timer = setTimeout(() => {
      sentQ.current = q
      latest.current.onChange({ ...latest.current.filters, q }, { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchDraft])

  // A text search with no `from` runs over the server's default window: show it.
  const effectiveFrom = useMemo(() => filters.from ?? serverParams(filters, new Date()).get("from") ?? "", [filters])
  const setDay = (key: "from" | "to", value: string) => set({ [key]: DAY_TEXT.test(value) ? value : undefined })

  const types = useMemo(() => typeOptions(filters.kind), [filters.kind])
  const models = useMemo(() => modelOptions(filters.line), [filters.line])
  const lines = useMemo(() => modelLines().map((l) => l.line), [])
  const sourceOptions = useMemo<Option[]>(
    () => sources.filter((s) => LIST_ITEM.test(s.key)).map((s) => ({ value: s.key, label: s.label, hint: String(s.count) })),
    [sources],
  )
  const sourceLabel = (key: string) => sources.find((s) => s.key === key)?.label ?? key

  const chips: Array<{ label: string; clear: Partial<AdminJobFilters> }> = []
  if (filters.status) chips.push({ label: `Status: ${filters.status}`, clear: { status: undefined } })
  if (filters.userEmail) chips.push({ label: `User: ${filters.userEmail}`, clear: { userEmail: undefined, excludeAdmins: false } })
  else if (filters.excludeAdmins) chips.push({ label: "Admins hidden", clear: { excludeAdmins: false } })
  if (filters.kind || filters.types.length > 0) {
    const parts = [filters.kind ? kindLabel(filters.kind) : null, filters.types.length > 0 ? summary(filters.types) : null]
    chips.push({ label: `Type: ${parts.filter(Boolean).join(" · ")}`, clear: { kind: undefined, types: [] } })
  }
  if (filters.line || filters.models.length > 0) {
    const parts = [filters.line ?? null, filters.models.length > 0 ? summary(filters.models) : null]
    chips.push({ label: `Model: ${parts.filter(Boolean).join(" · ")}`, clear: { line: undefined, models: [] } })
  }
  if (filters.minCredits !== undefined) chips.push({ label: `Credits ≥ ${filters.minCredits}`, clear: { minCredits: undefined } })
  if (filters.sources.length > 0) chips.push({ label: `Source: ${summary(filters.sources.map(sourceLabel))}`, clear: { sources: [] } })
  if (filters.from || filters.to) {
    chips.push({ label: `Dates: ${filters.from ?? "…"} – ${filters.to ?? "…"}`, clear: { from: undefined, to: undefined } })
  }
  if (filters.q) chips.push({ label: `Search: ${filters.q}`, clear: { q: undefined } })

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.kind ?? ANY}
          onValueChange={(v) => set({ kind: v === ANY ? undefined : (v as JobKindFilter), types: [] })}
        >
          <SelectTrigger size="sm" aria-label="Type" className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any type</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MultiSelect
          label="Exact types"
          emptyLabel={filters.kind ? `Every ${kindLabel(filters.kind).toLowerCase()} type` : "Exact types"}
          placeholder="Search or type a type"
          options={types}
          selected={filters.types}
          onChange={(next) => set({ types: next })}
          allowTyped
          normalizeTyped={(text) => text.toLowerCase()}
        />

        <Select
          value={filters.line ?? ANY}
          onValueChange={(v) => set({ line: v === ANY ? undefined : v, models: [] })}
        >
          <SelectTrigger size="sm" aria-label="Model line" className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any model</SelectItem>
            {lines.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MultiSelect
          label="Models"
          emptyLabel={filters.line ? `Every ${filters.line} model` : "Models"}
          placeholder="Search or type a model id"
          options={models}
          selected={filters.models}
          onChange={(next) => set({ models: next })}
          allowTyped
          max={MODEL_PICK_MAX}
        />

        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label="Minimum credits"
          placeholder="Credits ≥"
          className="h-8 w-[100px]"
          value={creditsDraft}
          onChange={(e) => setCreditsDraft(e.target.value)}
          onBlur={commitCredits}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") commitCredits()
          }}
        />

        <MultiSelect
          label="Source"
          emptyLabel="Any source"
          placeholder="Search sources"
          options={sourceOptions}
          selected={filters.sources}
          onChange={(next) => set({ sources: next })}
        />

        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label="From"
            className={cn("h-8 w-[140px]", !filters.from && effectiveFrom && "text-muted-foreground")}
            title={!filters.from && effectiveFrom ? "A search looks back 7 days unless From is set" : undefined}
            value={effectiveFrom}
            max={filters.to}
            onChange={(e) => setDay("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To"
            className="h-8 w-[140px]"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(e) => setDay("to", e.target.value)}
          />
        </div>

        <Input
          type="search"
          aria-label="Search"
          placeholder="Prompt, error or job id"
          className="h-8 w-[220px]"
          maxLength={SEARCH_MAX_CHARS}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex max-w-[320px] items-center gap-1 rounded-full border border-pink-500/50 bg-pink-500/10 py-0.5 pl-2.5 pr-1 text-xs text-pink-600 dark:text-pink-400"
            >
              <span className="truncate" title={chip.label}>{chip.label}</span>
              <button
                type="button"
                aria-label={`Clear ${chip.label}`}
                className="rounded-full p-0.5 hover:bg-pink-500/20"
                onClick={() => set(chip.clear)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...DEFAULT_JOB_FILTERS, view: filters.view })}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
