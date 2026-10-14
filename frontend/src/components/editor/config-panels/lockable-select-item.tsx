import type { ReactNode } from "react"
import { SelectItem, SelectItemWithMeta } from "@/components/ui/select"

/**
 * A Select row that can be LOCKED: still listed, greyed and unpickable, with
 * the reason written under it (a disabled Radix row takes no pointer events,
 * so a hover tooltip would never show). Used for the free-credit video limits
 * (`lib/free-video-locks.ts`); an unlocked row is a plain `SelectItem`.
 */
export function LockableSelectItem({ value, locked, className, children }: { value: string; locked: string | null | undefined; className?: string; children: ReactNode }) {
  if (!locked) return <SelectItem value={value} className={className}>{children}</SelectItem>
  return (
    <SelectItemWithMeta value={value} disabled className={className} description={locked} descriptionClassName="text-amber-600 dark:text-amber-400">
      {children}
    </SelectItemWithMeta>
  )
}
