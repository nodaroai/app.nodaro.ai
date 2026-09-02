/**
 * One collapsible sidebar section: a picker tab, with its families inside.
 *
 * The tab is the section rather than a prefix on every header, so a family
 * name gets its context from its parent — "Create" under "Image" reads
 * correctly where a bare "Create" under an "AI" category did not, and Image's
 * Create can no longer collide with Video's.
 */
import { ChevronRight } from "lucide-react"
import { NodaroMark, showNodaroMark } from "@/components/nodes/nodaro-exclusive-mark"
import { cn } from "@/lib/utils"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useAppDir } from "@/lib/locale-store"
import { usePickerSectionLabel, usePickerTabLabel } from "@/lib/node-picker-i18n"
import type { SidebarSection as Section } from "@/lib/node-picker-sections"
import type { SceneNodeType } from "@/types/nodes"

interface SidebarSectionProps {
  readonly section: Section
  readonly open: boolean
  readonly onToggle: (id: string) => void
  readonly onAdd: (type: SceneNodeType) => void
}

export function SidebarSection({ section, open, onToggle, onAdd }: SidebarSectionProps) {
  const panelId = `sidebar-section-${section.id}`
  // Same tables the add-node popup renders through, so both surfaces name a
  // node and its family identically in every locale.
  const tabLabel = usePickerTabLabel()
  const familyLabel = usePickerSectionLabel()
  const localizeNode = useLocalizeNodeLabel()
  // Conditional rather than a `rtl:` variant — see rtl-direction-guards.test.ts.
  const isRtl = useAppDir() === "rtl"
  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onToggle(section.id)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-2 rounded-md px-1 py-1.5 text-start transition-colors hover:bg-[var(--npk-hover)]"
      >
        {/* Collapsed, the chevron points along the reading direction (right in
            LTR, left in RTL); open, it points down in both. */}
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 text-[var(--npk-icon)] transition-transform",
            open ? "rotate-90" : isRtl && "rotate-180",
          )}
        />
        <span className="flex-1 font-sans text-[10px] font-semibold uppercase tracking-wider text-[var(--npk-accent)]">
          {tabLabel(section.tab)}
        </span>
        <span className="font-sans text-[10px] font-semibold tabular-nums text-[var(--npk-faint)]">
          {section.count}
        </span>
      </button>

      {/* The panel element is always present so aria-controls has a target,
          but its rows mount only while open — otherwise every one of the
          catalogue's nodes stays in the DOM behind a `hidden` attribute. */}
      <div id={panelId} hidden={!open}>
        {open && section.families.map((family) => (
          <div key={family.id}>
            <div className="px-2.5 pb-1 ps-4 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--npk-dim)]">
              {familyLabel(family)}
            </div>
            {family.options.map((node) => (
              <button
                key={node.type}
                type="button"
                onClick={() => onAdd(node.type)}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 ps-6",
                  "text-start transition-colors touch-manipulation",
                  "hover:bg-[var(--npk-hover)]",
                )}
              >
                <span className="text-[var(--npk-icon)] transition-colors group-hover:text-[var(--npk-accent)]">
                  {node.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--npk-t1)]">{localizeNode(node.label)}</span>
                {showNodaroMark(node.type) && <NodaroMark />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
