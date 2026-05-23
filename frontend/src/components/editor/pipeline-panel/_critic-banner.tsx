"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Phase 1D.2c follow-up — shared shell for the three critic-style alert
 * banners surfaced in the PipelinePanel:
 *
 *   - DriftBanner                (Phase 1B.4)
 *   - StoryboardCohesionBanner   (Phase 1D.2c-b-i)
 *   - VideoCriticSummaryBanner   (Phase 1D.2c-b-ii)
 *
 * All three render the same structural envelope: a `role="alert"` container
 * with a tone-tinted bg/border, a header row (title + chips on the left,
 * dismiss × top-right), an optional body, and an optional footer of CTA
 * buttons. This primitive collapses the outer-container + dismiss-button +
 * tone-class lookups into a single component; each banner keeps ownership
 * of its specific header composition (title text + which chips to render)
 * via the `header` slot.
 *
 * The body is `children` so the banners read naturally at the call site:
 *
 *     <CriticBanner tone="red" header={...} onDismiss={...}>
 *       …body content…
 *     </CriticBanner>
 *
 * The dismiss × is always wired when `onDismiss` is passed — this replaces
 * the per-banner duplication of the same close-button JSX.
 */

export type CriticBannerTone = "green" | "amber" | "red"

interface CriticBannerProps {
  readonly tone: CriticBannerTone
  /**
   * Header content (typically a title + chips). Rendered inside a flex row
   * on the left, with the dismiss × on the right. Each banner composes its
   * own header so the chip layout / count semantics stay banner-specific.
   */
  readonly header: ReactNode
  readonly onDismiss: () => void
  /** Body content. */
  readonly children?: ReactNode
  /** Optional row of CTA buttons rendered below the body. */
  readonly actions?: ReactNode
  readonly dismissTestId?: string
  /** Outer container data-testid (each banner picks its own). */
  readonly testId?: string
}

const TONE_CONTAINER: Record<CriticBannerTone, string> = {
  green:
    "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
  amber:
    "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800",
  red:
    "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",
}

export function CriticBanner({
  tone,
  header,
  onDismiss,
  children,
  actions,
  dismissTestId,
  testId,
}: CriticBannerProps) {
  return (
    <div
      className={cn(
        "rounded border px-3 py-2 text-sm space-y-2",
        TONE_CONTAINER[tone],
      )}
      data-testid={testId}
      role="alert"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">{header}</div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid={dismissTestId}
        >
          ×
        </Button>
      </div>
      {children}
      {actions && <div className="flex gap-2 pt-1">{actions}</div>}
    </div>
  )
}
