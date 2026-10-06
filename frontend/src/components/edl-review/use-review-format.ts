/**
 * Times in the reviewer's language (§2.3 of the inspectors design): positions
 * as m:ss (`positionOf`), lengths as "1.6 s" under a minute, with the decimal
 * written the interface language's way, else as a clock (`lengthParts`).
 */
import { useMemo } from "react"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { lengthParts, positionOf } from "@/lib/edl-review/review-time"

export interface ReviewFormat {
  readonly position: (ms: number) => string
  readonly length: (ms: number) => string
}

export function useReviewFormat(): ReviewFormat {
  const t = useT()
  return useMemo(
    () => ({
      position: positionOf,
      length: (ms: number) => {
        const parts = lengthParts(ms)
        return "seconds" in parts
          ? t("edlReview.lengthSeconds", { n: formatNumber(parts.seconds, { maximumFractionDigits: 1 }) })
          : parts.clock
      },
    }),
    [t],
  )
}
