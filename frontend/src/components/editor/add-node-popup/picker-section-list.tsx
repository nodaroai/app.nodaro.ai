/**
 * Family-grouped node list — the body of every non-search picker tab.
 *
 * Headers are sticky and non-focusable: the flat keyboard index counts rows
 * only, and the caller builds `displayItems` by walking the same sections in
 * the same order, so highlight and Enter can never drift from what is drawn.
 */
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { NodaroMark, showNodaroMark } from "@/components/nodes/nodaro-exclusive-mark"
import type { NodeOption } from "@/lib/node-compatibility"
import type { PickerSection } from "@/lib/node-picker-sections"
import type { SceneNodeType } from "@/types/nodes"

export const CREATIVE_CONTROLS_NAV_ID = "creative-controls"

/** Sentinel that lets the Creative Controls toggle sit in the keyboard order
 *  next to real rows without pretending to be a node. */
export interface CreativeControlsNavItem {
  readonly id: typeof CREATIVE_CONTROLS_NAV_ID
  readonly isCreativeControlsNav: true
}
export const CREATIVE_CONTROLS_NAV_ITEM: CreativeControlsNavItem = {
  id: CREATIVE_CONTROLS_NAV_ID,
  isCreativeControlsNav: true,
}

export function isCreativeControlsNavItem(item: unknown): item is CreativeControlsNavItem {
  return Boolean(item && typeof item === "object" && "isCreativeControlsNav" in item)
}

/** The rows a tab contributes to the flat keyboard order, in render order. */
export function flattenSections(
  sections: readonly PickerSection[],
  controls: readonly PickerSection[],
  controlsOpen: boolean,
): (NodeOption | CreativeControlsNavItem)[] {
  const flat: (NodeOption | CreativeControlsNavItem)[] = sections.flatMap((s) => [...s.options])
  if (controls.length) {
    flat.push(CREATIVE_CONTROLS_NAV_ITEM)
    if (controlsOpen) for (const section of controls) flat.push(...section.options)
  }
  return flat
}

function SectionHeader({ label, indent }: { label: string; indent?: boolean }) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-[var(--npk-surface)] px-2.5 pb-1.5 pt-2",
        "text-[10.5px] font-semibold uppercase tracking-[1.3px] text-[var(--npk-dim)]",
        indent && "pl-[22px] text-[10px] tracking-[1.2px]",
      )}
    >
      {label}
    </div>
  )
}

interface RowProps {
  readonly node: NodeOption
  readonly index: number
  readonly highlighted: boolean
  readonly control?: boolean
  readonly badge?: string
  readonly onHover: (index: number) => void
  readonly onSelect: (type: SceneNodeType) => void
}

export function PickerNodeRow({
  node,
  index,
  highlighted,
  control,
  badge,
  onHover,
  onSelect,
}: RowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.type)}
      onMouseEnter={() => onHover(index)}
      data-active={highlighted ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-[11px] rounded-lg px-2.5 py-[5px] text-left transition-colors",
        control ? "min-h-9" : "min-h-[42px]",
        highlighted
          ? "bg-[var(--npk-sel-bg)] shadow-[inset_0_0_0_1px_var(--npk-sel-ring)]"
          : "hover:bg-[var(--npk-hover)]",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center",
          control ? "text-[var(--npk-icon-control)]" : "text-[var(--npk-icon)]",
        )}
      >
        {node.icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[var(--npk-t1)]",
          control ? "text-[13px]" : "text-[13.5px]",
        )}
      >
        {node.label}
      </span>
      {showNodaroMark(node.type) && <NodaroMark />}
      {badge && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] tracking-[0.5px] text-[var(--npk-dim)] bg-[var(--npk-chip)]">
          {badge}
        </span>
      )}
    </button>
  )
}

interface SectionListProps {
  readonly sections: readonly PickerSection[]
  readonly controls: readonly PickerSection[]
  readonly controlsOpen: boolean
  readonly onToggleControls: () => void
  readonly highlightedIndex: number
  readonly onHover: (index: number) => void
  readonly onSelect: (type: SceneNodeType) => void
  readonly badgeFor?: (node: NodeOption) => string | undefined
}

export function PickerSectionList({
  sections,
  controls,
  controlsOpen,
  onToggleControls,
  highlightedIndex,
  onHover,
  onSelect,
  badgeFor,
}: SectionListProps) {
  let nav = 0
  const controlCount = controls.reduce((sum, s) => sum + s.options.length, 0)

  const renderSection = (section: PickerSection) => (
    <div key={section.id} className="mb-2.5">
      <SectionHeader label={section.label} indent={section.control} />
      <div className={cn(section.control && "grid grid-cols-2 gap-x-1 pl-[22px] pr-1")}>
        {section.options.map((node) => {
          const index = nav++
          return (
            <PickerNodeRow
              key={`${section.id}:${node.type}`}
              node={node}
              index={index}
              highlighted={index === highlightedIndex}
              control={section.control}
              badge={badgeFor?.(node)}
              onHover={onHover}
              onSelect={onSelect}
            />
          )
        })}
      </div>
    </div>
  )

  const body = sections.map(renderSection)

  if (!controls.length) return <>{body}</>

  const toggleIndex = nav++
  const expanded = controlsOpen ? controls.map(renderSection) : null

  return (
    <>
      {body}
      <button
        type="button"
        onClick={onToggleControls}
        onMouseEnter={() => onHover(toggleIndex)}
        data-active={toggleIndex === highlightedIndex ? "true" : undefined}
        aria-expanded={controlsOpen}
        className={cn(
          "mb-2 flex min-h-11 w-full items-center gap-[11px] rounded-lg px-2.5 text-left transition-colors",
          "bg-[var(--npk-cc-bg)] shadow-[inset_0_0_0_1px_var(--npk-border)]",
          toggleIndex === highlightedIndex &&
            "bg-[var(--npk-sel-bg)] shadow-[inset_0_0_0_1px_var(--npk-sel-ring)]",
        )}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--npk-icon)]" />
        <span className="text-[13.5px] text-[var(--npk-t1)]">Creative Controls</span>
        <span className="text-[13.5px] text-[var(--npk-muted)]">({controlCount})</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--npk-muted)]">
          {controlsOpen ? "Hide" : "Show"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", controlsOpen && "rotate-180")}
          />
        </span>
      </button>
      {expanded}
    </>
  )
}
