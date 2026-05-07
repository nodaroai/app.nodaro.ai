"use client"

import { memo, useMemo, useState } from "react"
import { Search, Cloud, Flame, Sparkles, Waves, Star, CloudRain, Spline, Hexagon, Zap, Atom, Infinity as InfinityIcon, Tornado } from "lucide-react"
import {
  LOOP_SUBJECTS,
  type LoopSubject,
  type LoopSubjectCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"

interface LoopSubjectPickerProps {
  readonly value: string
  readonly onValueChange: (subjectId: string) => void
  readonly className?: string
}

const CATEGORY_ORDER: ReadonlyArray<LoopSubjectCategory> = ["realistic", "abstract"]

const CATEGORY_LABELS: Record<LoopSubjectCategory, string> = {
  realistic: "Realistic",
  abstract: "Abstract / VJ",
}

const SUBJECT_ICONS: Record<string, React.ReactNode> = {
  aurora: <Sparkles className="size-5" />,
  clouds: <Cloud className="size-5" />,
  "ocean-waves": <Waves className="size-5" />,
  starfield: <Star className="size-5" />,
  fireplace: <Flame className="size-5" />,
  rain: <CloudRain className="size-5" />,
  tunnel: <Spline className="size-5" />,
  "tunnel-clean": <Spline className="size-5" />,
  kaleidoscope: <Hexagon className="size-5" />,
  plasma: <Zap className="size-5" />,
  "particle-swirl": <Atom className="size-5" />,
  "fractal-zoom": <InfinityIcon className="size-5" />,
}

function getSubjectIcon(id: string): React.ReactNode {
  return SUBJECT_ICONS[id] ?? <Tornado className="size-5" />
}

/**
 * Single-select loop-subject picker. Each entry is a curated, loop-friendly
 * scene prompt; the chosen prompt fragment is emitted by the LoopSubjectNode
 * and wired into Generate Image's prompt input via FieldMappings.
 */
export const LoopSubjectPicker = memo(function LoopSubjectPicker({
  value,
  onValueChange,
  className,
}: LoopSubjectPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<LoopSubjectCategory, LoopSubject[]>()
    for (const subject of LOOP_SUBJECTS) {
      if (q && !`${subject.label} ${subject.description}`.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(subject.category) ?? []
      list.push(subject)
      byCategory.set(subject.category, list)
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      subjects: byCategory.get(cat) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.subjects.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search loop subject"
          placeholder="Search loop subject"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No subject matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, subjects }) => {
        if (subjects.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {subjects.map((subject) => {
                const selected = subject.id === value
                return (
                  <button
                    key={subject.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={subject.description}
                    onClick={() => onValueChange(subject.id)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-colors cursor-pointer",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60 text-white"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] text-gray-700 dark:text-[#E2E8F0] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className={cn("flex items-center justify-center", selected ? "text-[#ff0073]" : "text-muted-foreground")}>
                      {getSubjectIcon(subject.id)}
                    </span>
                    <FitText
                      text={subject.label}
                      className="text-[10.5px] font-medium leading-tight"
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})
