"use client"

// Left rail of the Avatar Picker modal: libraries (All / Your own looks /
// Recently used), the GENDER and SCENE facets, and the "Supports Avatar V"
// toggle. Pure presentation — the modal owns the state. Each chip row is a
// radiogroup with one tab stop and arrow-key movement.

import type { LucideIcon } from "lucide-react"
import { History, Sparkles, User, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { capitalize, type PickerFilters, type PickerLibrary } from "./model"
import { CHIP, CHIP_ON, KICKER } from "./styles"
import { useRovingRadiogroup } from "./use-roving-radiogroup"

export interface LibraryEntry {
  readonly id: PickerLibrary
  readonly label: string
  /** Number of LOOKS in the library (the header counts looks the same way). */
  readonly count: number
}

interface PickerRailProps {
  readonly libraries: readonly LibraryEntry[]
  readonly genders: readonly string[]
  readonly scenes: readonly string[]
  readonly filters: PickerFilters
  readonly onChange: (patch: Partial<PickerFilters>) => void
}

const LIBRARY_ICON: Record<PickerLibrary, LucideIcon> = { all: Users, own: User, recent: History }

function Chips({
  label,
  options,
  value,
  onPick,
  render = capitalize,
}: {
  label: string
  options: readonly string[]
  value: string
  onPick: (v: string) => void
  render?: (v: string) => string
}) {
  const all = ["all", ...options]
  const roving = useRovingRadiogroup(all.length, all.indexOf(value), (i) => onPick(all[i]))
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
      <span className={KICKER}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {all.map((o, i) => {
          const on = value === o
          const text = o === "all" ? "All" : render(o)
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              title={text}
              className={cn(CHIP, on && CHIP_ON)}
              onClick={() => onPick(o)}
              {...roving(i)}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Libraries({ libraries, active, onPick }: { libraries: readonly LibraryEntry[]; active: PickerLibrary; onPick: (id: PickerLibrary) => void }) {
  const roving = useRovingRadiogroup(libraries.length, libraries.findIndex((l) => l.id === active), (i) => onPick(libraries[i].id))
  return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Library">
      {libraries.map((lib, i) => {
        const on = active === lib.id
        const Icon = LIBRARY_ICON[lib.id]
        return (
          <button
            key={lib.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${lib.label}, ${lib.count.toLocaleString("en-US")} looks`}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors",
              on ? "bg-muted text-foreground" : "text-foreground/75 hover:bg-muted/60",
            )}
            onClick={() => onPick(lib.id)}
            {...roving(i)}
          >
            <Icon className={cn("size-3.5 shrink-0", on ? "text-[#ff0073]" : "text-muted-foreground/70")} aria-hidden />
            <span className="flex-1 whitespace-nowrap">{lib.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">{lib.count.toLocaleString("en-US")}</span>
          </button>
        )
      })}
    </div>
  )
}

export function PickerRail({ libraries, genders, scenes, filters, onChange }: PickerRailProps) {
  return (
    <div className="flex flex-col gap-5 overflow-y-auto border-r border-border/60 px-3.5 py-4" data-testid="avatar-picker-rail">
      <Libraries libraries={libraries} active={filters.library} onPick={(library) => onChange({ library })} />

      {genders.length > 1 && (
        <Chips
          label="Gender"
          options={genders}
          value={filters.gender}
          onPick={(gender) => onChange({ gender })}
          render={(g) => (g === "unknown" ? "Unspecified" : capitalize(g))}
        />
      )}
      {scenes.length > 0 && (
        <Chips label="Scene" options={scenes} value={filters.scene} onPick={(scene) => onChange({ scene })} render={(s) => s} />
      )}

      <label className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2.5 cursor-pointer">
        <Switch
          checked={filters.onlyAvatarV}
          onCheckedChange={(v) => onChange({ onlyAvatarV: v })}
          aria-label="Supports Avatar V"
          className="data-[state=checked]:bg-[#ff0073]"
        />
        <span className="text-[11.5px] leading-snug text-foreground/80">
          Supports
          <br />
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3 text-violet-500" aria-hidden />
            Avatar V
          </span>
        </span>
      </label>
    </div>
  )
}
