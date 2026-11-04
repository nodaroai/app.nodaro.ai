import type { ReactNode } from "react"

/**
 * Admin → Motion price check: a table in its own scroll box, so a phone scrolls
 * the table and never the page. The box is focusable and named by its
 * section's heading (the table is not named again), so a keyboard scrolls it
 * sideways too.
 */
export function Scroll({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </div>
  )
}
