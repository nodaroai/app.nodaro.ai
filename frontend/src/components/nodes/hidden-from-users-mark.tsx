import { isNodeHiddenFromUsers, useSurfaceAvailability } from "@/lib/surface-availability"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * Marks a node the admin switch (Admin → Availability) is hiding from users.
 *
 * An admin still sees and runs such a node; their users do not. Without a mark
 * the two look identical in the picker, and a workflow, app or template built on
 * one would be mistaken for something a user can run — it fails for them with
 * "not available on this deployment". Rendered beside the label wherever a node
 * is offered (picker rows, the sidebar catalogue), the same seats as
 * `NodaroMark`.
 *
 * Self-gating: renders nothing unless the backend named this type in
 * `hiddenFromUsers`, which it only ever does for an admin. Subscribes to the
 * availability store itself, so a row that mounted before the fetch landed
 * still picks the mark up.
 */
export function HiddenFromUsersMark({ type, className }: { readonly type: string; readonly className?: string }) {
  useSurfaceAvailability()
  if (!isNodeHiddenFromUsers(type)) return null
  return <AdminOnlyPill className={className} />
}

/** The pill itself, for a caller that has already decided it applies — e.g. a
 *  Web Scrape source that follows a withheld node. */
export function AdminOnlyPill({ className }: { readonly className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[11px] font-bold tracking-[0.7px]",
        "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        className,
      )}
      title={t("addnode.hiddenFromUsers")}
    >
      {t("addnode.adminOnlyMark")}
    </span>
  )
}
