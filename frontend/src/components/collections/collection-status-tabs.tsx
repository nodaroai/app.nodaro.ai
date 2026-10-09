import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The lists a collection page shows: every live record, the used ones, the ones not used yet, and the Trash. */
export type CollectionTab = "all" | "used" | "new" | "trash"

export type CollectionTabCounts = {
  readonly all: number
  readonly used: number
  readonly notYet: number
  readonly trash: number
}

/**
 * Underline tabs with a count badge each. The usage pair and the Trash show
 * only when the server can answer them (a server whose database predates the
 * usage release sends neither count).
 */
export function CollectionStatusTabs({
  value,
  onChange,
  counts,
  showUsage,
  showTrash,
}: {
  readonly value: CollectionTab
  readonly onChange: (tab: CollectionTab) => void
  readonly counts: CollectionTabCounts
  readonly showUsage: boolean
  readonly showTrash: boolean
}) {
  const t = useT()
  const items: Array<{ id: CollectionTab; label: string; count: number }> = [{ id: "all", label: t("collections.tabAll"), count: counts.all }]
  if (showUsage) {
    items.push({ id: "used", label: t("collections.tabUsed"), count: counts.used }, { id: "new", label: t("collections.tabUnused"), count: counts.notYet })
  }
  if (showTrash) items.push({ id: "trash", label: t("collections.tabTrash"), count: counts.trash })
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as CollectionTab)} className="mt-5">
      <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
        {items.map(({ id, label, count }) => (
          <TabsTrigger
            key={id}
            value={id}
            className={cn(
              "-mb-px gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3.5 py-2.5 text-sm font-semibold text-muted-foreground shadow-none",
              "data-[state=active]:border-[#c8237f] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
            )}
          >
            {label}{" "}
            <span className={cn("rounded-[10px] px-[7px] py-px text-[11px] tabular-nums", value === id ? "bg-[#c8237f] text-white" : "bg-muted text-muted-foreground")}>
              {count}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
