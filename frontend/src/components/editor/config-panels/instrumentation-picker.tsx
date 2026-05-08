"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  INSTRUMENTS,
  PRODUCTION_STYLES,
  VOCAL_PRESENCE,
  pickIds,
  togglePick,
  type InstrumentationEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"

/** Cap instruments at 5 to keep the prompt-hint composability sane. */
const MAX_INSTRUMENTS = 5

export interface InstrumentationValue {
  readonly instruments?: ReadonlyArray<string>
  readonly production?: string
  readonly vocalPresence?: string
}

interface InstrumentationPickerProps {
  readonly value: InstrumentationValue
  readonly onChange: (patch: Partial<InstrumentationValue>) => void
  readonly className?: string
}

/**
 * Three sections: instruments (multi-select up to 5) + production style +
 * vocal presence. Instruments is always array-shaped (matches the
 * underlying `InstrumentationData.instruments: string[]` field), so no
 * single/multi mode badge — every tap toggles the id in the array.
 */
export const InstrumentationPicker = memo(function InstrumentationPicker({
  value,
  onChange,
  className,
}: InstrumentationPickerProps) {
  const [query, setQuery] = useState("")
  /** Explicit-enable flag for the multi section so the user can "check" it
   *  without forcing a default pick (mirrors StylingPicker pattern). */
  const [instrumentsEnabled, setInstrumentsEnabled] = useState(false)
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("instrumentation")

  const filteredInstruments = useMemo(
    () => INSTRUMENTS.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )
  const filteredProduction = useMemo(
    () => PRODUCTION_STYLES.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )
  const filteredVocal = useMemo(
    () => VOCAL_PRESENCE.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )

  const instrumentIds = pickIds(value.instruments)
  const instrumentsChecked = instrumentsEnabled || instrumentIds.length > 0

  const productionCurrent = value.production
  const productionChecked = productionCurrent !== undefined && productionCurrent !== ""

  const vocalCurrent = value.vocalPresence
  const vocalChecked = vocalCurrent !== undefined && vocalCurrent !== ""

  const anyVisible =
    filteredInstruments.length > 0 ||
    filteredProduction.length > 0 ||
    filteredVocal.length > 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search instrumentation"
          placeholder="Search instruments, production, vocals"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No instrumentation entry matches &quot;{query}&quot;
        </div>
      )}

      {(!query || filteredInstruments.length > 0) && (
        <SoundDimensionSection
          label="Instruments"
          entries={filteredInstruments}
          selectedIds={instrumentIds}
          maxSelected={MAX_INSTRUMENTS}
          isMultiData={true}
          checked={instrumentsChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              setInstrumentsEnabled(true)
            } else {
              setInstrumentsEnabled(false)
              onChange({ instruments: undefined })
            }
          }}
          onPick={(id) => {
            const next = togglePick(instrumentIds, id, MAX_INSTRUMENTS)
            onChange({ instruments: next.length === 0 ? undefined : next })
          }}
        />
      )}

      {(!query || filteredProduction.length > 0) && (
        <SoundDimensionSection
          label="Production"
          entries={filteredProduction}
          selectedIds={productionCurrent ? [productionCurrent] : []}
          checked={productionChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              const first = filteredProduction[0]?.id ?? PRODUCTION_STYLES[0]?.id
              if (first) onChange({ production: first })
            } else {
              onChange({ production: undefined })
            }
          }}
          onPick={(id) =>
            onChange({ production: productionCurrent === id ? undefined : id })
          }
        />
      )}

      {(!query || filteredVocal.length > 0) && (
        <SoundDimensionSection
          label="Vocal Presence"
          entries={filteredVocal}
          selectedIds={vocalCurrent ? [vocalCurrent] : []}
          checked={vocalChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              const first = filteredVocal[0]?.id ?? VOCAL_PRESENCE[0]?.id
              if (first) onChange({ vocalPresence: first })
            } else {
              onChange({ vocalPresence: undefined })
            }
          }}
          onPick={(id) =>
            onChange({ vocalPresence: vocalCurrent === id ? undefined : id })
          }
        />
      )}
    </div>
  )
})

export type { InstrumentationEntry }
