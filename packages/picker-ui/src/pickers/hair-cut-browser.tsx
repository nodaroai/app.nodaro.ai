"use client"

import { memo, useMemo } from "react"
import { Scissors } from "lucide-react"
import { STYLINGS as BASE_STYLINGS, type Styling } from "@nodaro/prompts"
import { DimensionModalBrowser } from "./dimension-modal-browser"
import { HairIcon } from "./hair-icon"
import { useCuratedEntries } from "../curated.js"

/**
 * Hair-cut modal picker. 45 entries — too many for inline chips in the side
 * config panel. Trigger shows current cut with its silhouette; click opens
 * a searchable tile grid with SVG pictograms per cut.
 *
 * Lives in Styling (the cut/style applied) rather than Person (the natural
 * hair texture + length, which has its own `hair-base` dimension).
 */
export const HairCutBrowser = memo(function HairCutBrowser({
  value,
  onChange,
  className,
  variant = "full",
}: {
  readonly value: string | undefined
  readonly onChange: (id: string | undefined) => void
  readonly className?: string
  readonly variant?: "full" | "compact"
}) {
  const STYLINGS = useCuratedEntries("styling", BASE_STYLINGS)
  const entries = useMemo<ReadonlyArray<Styling>>(
    () => STYLINGS.filter((s) => s.dimension === "hair-cut"),
    [STYLINGS],
  )

  return (
    <DimensionModalBrowser
      entries={entries}
      value={value}
      onChange={onChange}
      title="Choose Hair Cut"
      placeholder="Choose hair cut…"
      fallbackIcon={<Scissors className="size-3.5" />}
      renderIcon={(entry) => (
        <HairIcon hairCutId={entry.id} className="size-full" />
      )}
      className={className}
      triggerVariant={variant}
      triggerLabel="Pick by look"
      catalog="styling"
    />
  )
})
