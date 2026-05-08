"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  INSTRUMENTS,
  PRODUCTION_STYLES,
  VOCAL_PRESENCE,
  VOCAL_PRESENCE_INSTRUMENTAL_ID,
  SINGING_STYLES,
  INSTRUMENT_CATEGORY_ORDER,
  INSTRUMENT_CATEGORY_LABELS,
  pickIds,
  togglePick,
  type InstrumentationEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"
import { SoundTabbedSection, type TabbedEntry } from "./sound-tabbed-section"

/** Cap instruments at 5, vocal presence at 3, singing style at 3. */
const MAX_INSTRUMENTS = 5
const MAX_VOCAL_PRESENCE = 3
const MAX_SINGING_STYLES = 3

export interface InstrumentationValue {
  readonly instruments?: ReadonlyArray<string>
  readonly production?: string
  readonly vocalPresence?: string | ReadonlyArray<string>
  readonly singingStyle?: string | ReadonlyArray<string>
}

interface InstrumentationPickerProps {
  readonly value: InstrumentationValue
  readonly onChange: (patch: Partial<InstrumentationValue>) => void
  readonly className?: string
}

/**
 * Four sections:
 *  - Instruments — multi-select up to 5, tabbed by family
 *  - Production — single-select tile grid
 *  - Vocal Presence — multi-select up to 3. "instrumental" is mutually
 *    exclusive (picking it clears any other vocal-presence picks; picking
 *    a non-instrumental while "instrumental" is set clears "instrumental")
 *  - Singing Style — multi-select up to 3 (operatic / pop / rock / growl /
 *    rap / falsetto / belting / etc.)
 */
export const InstrumentationPicker = memo(function InstrumentationPicker({
  value,
  onChange,
  className,
}: InstrumentationPickerProps) {
  const [query, setQuery] = useState("")
  /** Explicit-enable for multi sections — lets the user "check" the
   *  section without forcing a default pick (mirrors StylingPicker). */
  const [instrumentsEnabled, setInstrumentsEnabled] = useState(false)
  const [vocalEnabled, setVocalEnabled] = useState(false)
  const [styleEnabled, setStyleEnabled] = useState(false)
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("instrumentation")

  const filteredInstrumentEntries = useMemo<ReadonlyArray<TabbedEntry>>(() => {
    return INSTRUMENTS
      .filter((e) => matches(e.id, e.label, e.description, query))
      .map((e) => ({
        id: e.id,
        label: e.label,
        description: e.description,
        group: e.category,
      }))
  }, [matches, query])

  const filteredProduction = useMemo(
    () => PRODUCTION_STYLES.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )
  const filteredVocal = useMemo(
    () => VOCAL_PRESENCE.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )
  const filteredSingingStyles = useMemo(
    () => SINGING_STYLES.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )

  const instrumentIds = pickIds(value.instruments)
  const instrumentsChecked = instrumentsEnabled || instrumentIds.length > 0

  const productionCurrent = value.production
  const productionChecked = productionCurrent !== undefined && productionCurrent !== ""

  const vocalIds = pickIds(value.vocalPresence)
  const isMultiVocal = Array.isArray(value.vocalPresence)
  const vocalChecked = vocalEnabled || vocalIds.length > 0

  const styleIds = pickIds(value.singingStyle)
  const isMultiStyle = Array.isArray(value.singingStyle)
  const styleChecked = styleEnabled || styleIds.length > 0

  const anyVisible =
    filteredInstrumentEntries.length > 0 ||
    filteredProduction.length > 0 ||
    filteredVocal.length > 0 ||
    filteredSingingStyles.length > 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search instrumentation"
          placeholder="Search instruments, production, vocals, style"
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

      {(!query || filteredInstrumentEntries.length > 0) && (
        <SoundTabbedSection
          label="Instruments"
          entries={filteredInstrumentEntries}
          groupOrder={INSTRUMENT_CATEGORY_ORDER as ReadonlyArray<string>}
          groupLabels={INSTRUMENT_CATEGORY_LABELS as Readonly<Record<string, string>>}
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
          onActivateMulti={(id) => onChange({ instruments: [id] })}
          onDemoteToSingle={(id) => onChange({ instruments: [id] })}
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
          selectedIds={vocalIds}
          maxSelected={MAX_VOCAL_PRESENCE}
          isMultiData={isMultiVocal}
          checked={vocalChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              setVocalEnabled(true)
            } else {
              setVocalEnabled(false)
              onChange({ vocalPresence: undefined })
            }
          }}
          onPick={(id) => {
            // "instrumental" is mutually exclusive with any other vocal pick.
            const isInstrumental = id === VOCAL_PRESENCE_INSTRUMENTAL_ID
            if (isInstrumental) {
              if (vocalIds.includes(id)) {
                onChange({ vocalPresence: undefined })
              } else {
                onChange({ vocalPresence: id })
              }
              return
            }
            // Picking a non-instrumental clears "instrumental" if set.
            const filtered = vocalIds.filter((v) => v !== VOCAL_PRESENCE_INSTRUMENTAL_ID)
            if (!isMultiVocal) {
              if (vocalIds.length === 1 && vocalIds[0] === id) {
                onChange({ vocalPresence: undefined })
              } else {
                onChange({ vocalPresence: id })
              }
              return
            }
            const next = togglePick(filtered, id, MAX_VOCAL_PRESENCE)
            onChange({ vocalPresence: next.length === 0 ? undefined : next })
          }}
          onActivateMulti={(id) => {
            if (id === VOCAL_PRESENCE_INSTRUMENTAL_ID) {
              onChange({ vocalPresence: id })
            } else {
              onChange({ vocalPresence: [id] })
            }
          }}
          onDemoteToSingle={(id) => onChange({ vocalPresence: id })}
        />
      )}

      {(!query || filteredSingingStyles.length > 0) && (
        <SoundDimensionSection
          label="Singing Style"
          entries={filteredSingingStyles}
          selectedIds={styleIds}
          maxSelected={MAX_SINGING_STYLES}
          isMultiData={isMultiStyle}
          checked={styleChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              setStyleEnabled(true)
            } else {
              setStyleEnabled(false)
              onChange({ singingStyle: undefined })
            }
          }}
          onPick={(id) => {
            if (!isMultiStyle) {
              if (styleIds.length === 1 && styleIds[0] === id) {
                onChange({ singingStyle: undefined })
              } else {
                onChange({ singingStyle: id })
              }
              return
            }
            const next = togglePick(styleIds, id, MAX_SINGING_STYLES)
            onChange({ singingStyle: next.length === 0 ? undefined : next })
          }}
          onActivateMulti={(id) => onChange({ singingStyle: [id] })}
          onDemoteToSingle={(id) => onChange({ singingStyle: id })}
        />
      )}
    </div>
  )
})

export type { InstrumentationEntry }
