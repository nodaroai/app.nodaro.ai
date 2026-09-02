/**
 * Search results.
 *
 * Matches on the active tab come first, still under their family headers, so
 * a search reads like the browse view rather than a different screen. Matches
 * from anywhere else follow a labelled separator, each carrying the tab it
 * lives on — a query must never look like a dead end just because the node is
 * filed elsewhere.
 */
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { usePickerSectionLabel, usePickerTabLabel } from "@/lib/node-picker-i18n"
import type { NodeOption } from "@/lib/node-compatibility"
import type { SceneNodeType } from "@/types/nodes"
import { familyLabel, tabForType } from "@/lib/node-families"
import { PickerNodeRow } from "./picker-section-list"

export interface SearchNodeGroup {
  readonly id: string
  /** English family name; the header localizes it like any other section. */
  readonly label: string
  readonly options: readonly NodeOption[]
}

/** Group hits by their family, in first-hit order, so the strongest match's
 *  family leads and the search ranking survives the grouping. */
export function groupHitsByFamily(hits: readonly NodeOption[]): SearchNodeGroup[] {
  const groups = new Map<string, NodeOption[]>()
  for (const hit of hits) {
    const id = hit.group ?? "other"
    const bucket = groups.get(id)
    if (bucket) bucket.push(hit)
    else groups.set(id, [hit])
  }
  return [...groups].map(([id, options]) => ({
    id,
    label: familyLabel(id) ?? "Other",
    options,
  }))
}

function Header({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--npk-surface)] px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[1.3px] text-[var(--npk-dim)]">
      {label}
    </div>
  )
}

/** The labelled hairline that opens the cross-tab block. */
export function FromOtherTabsSeparator() {
  const t = useT()
  return (
    <div className="mt-4 flex items-center gap-2.5 px-2.5 pb-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[1.3px] text-[var(--npk-dim)]">
        {t("addnode.blockOther")}
      </span>
      <span className="h-px flex-1 bg-[var(--npk-border)]" />
    </div>
  )
}

interface OwnBlockProps {
  readonly hits: readonly NodeOption[]
  readonly startIndex: number
  readonly highlightedIndex: number
  readonly onHover: (index: number) => void
  readonly onSelect: (type: SceneNodeType) => void
  readonly badgeFor?: (node: NodeOption) => string | undefined
}

/** Current-tab hits, grouped under their family headers. */
export function SearchOwnBlock({
  hits,
  startIndex,
  highlightedIndex,
  onHover,
  onSelect,
  badgeFor,
}: OwnBlockProps) {
  const sectionLabel = usePickerSectionLabel()
  let nav = startIndex
  return (
    <>
      {groupHitsByFamily(hits).map((group) => (
        <div key={group.id} className="mb-2.5">
          <Header label={sectionLabel({ family: group.label })} />
          {group.options.map((node) => {
            const index = nav++
            return (
              <PickerNodeRow
                key={`own:${node.type}`}
                node={node}
                index={index}
                highlighted={index === highlightedIndex}
                badge={badgeFor?.(node)}
                onHover={onHover}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      ))}
    </>
  )
}

interface OtherBlockProps extends Omit<OwnBlockProps, "badgeFor"> {
  readonly directBadge?: (node: NodeOption) => string | undefined
}

/** Cross-tab hits: flat, each row badged with the tab it lives on. */
export function SearchOtherBlock({
  hits,
  startIndex,
  highlightedIndex,
  onHover,
  onSelect,
  directBadge,
}: OtherBlockProps) {
  const tabLabel = usePickerTabLabel()
  let nav = startIndex
  // The owning-tab badge reads as a small-caps chip in English ("IMAGE");
  // toUpperCase is a no-op for Hebrew, which has no case.
  const tabBadge = (node: NodeOption): string | undefined => {
    const tab = tabForType(node.type)
    return tab ? tabLabel(tab).toUpperCase() : undefined
  }
  return (
    <>
      <FromOtherTabsSeparator />
      {hits.map((node) => {
        const index = nav++
        return (
          <PickerNodeRow
            key={`other:${node.type}`}
            node={node}
            index={index}
            highlighted={index === highlightedIndex}
            badge={directBadge?.(node) ?? tabBadge(node)}
            onHover={onHover}
            onSelect={onSelect}
          />
        )
      })}
    </>
  )
}

export function SearchEmptyState({ query }: { query: string }) {
  const t = useT()
  return (
    <div className={cn("px-4 py-10 text-center")}>
      <div className="text-[13.5px] text-[var(--npk-t2)]">
        {t("addnode.noMatch", { query })}
      </div>
      <div className="mt-1 text-[12px] text-[var(--npk-muted)]">
        {t("addnode.noMatchHint")}
      </div>
    </div>
  )
}
