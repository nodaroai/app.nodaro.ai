/**
 * The picker's tablist. Nine intent tabs that never wrap — the row scrolls
 * horizontally with a fade over the right edge, so `All` (far right) is
 * reachable but never clipped.
 */
import { useEffect, useRef } from "react"
import {
  Film,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Music,
  Send,
  Star,
  Workflow,
  Box,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { ADD_NODE_MENU_TABS, type AddNodeMenuTab } from "@/lib/add-node-menu-tab"
import { PICKER_TAB_LABEL_KEY } from "@/lib/node-picker-i18n"

// Labels come from the chrome dict (PICKER_TAB_LABEL_KEY) so the tablist
// follows the user's language like the rest of the popup.
const TAB_ICON: Record<AddNodeMenuTab, React.ReactNode> = {
  common: <Star className="h-[13px] w-[13px]" />,
  image: <ImageIcon className="h-[13px] w-[13px]" />,
  video: <Film className="h-[13px] w-[13px]" />,
  audio: <Music className="h-[13px] w-[13px]" />,
  models: <Layers className="h-[13px] w-[13px]" />,
  assets: <Box className="h-[13px] w-[13px]" />,
  automate: <Workflow className="h-[13px] w-[13px]" />,
  publish: <Send className="h-[13px] w-[13px]" />,
  all: <LayoutGrid className="h-[13px] w-[13px]" />,
}

interface PickerTabBarProps {
  readonly activeTab: AddNodeMenuTab
  readonly onSelect: (tab: AddNodeMenuTab) => void
}

export function PickerTabBar({ activeTab, onSelect }: PickerTabBarProps) {
  const activeRef = useRef<HTMLButtonElement>(null)
  const t = useT()
  // Read the live direction rather than a `rtl:` variant: Tailwind compiles
  // that to a `[dir="rtl"] *` descendant selector, which pierces the canvas's
  // LTR pin (see rtl-direction-guards.test.ts).
  const isRtl = useAppDir() === "rtl"

  // At narrow viewports the strip scrolls, and Tab-cycling can land on a tab
  // that is off-screen or half-hidden behind the right-edge fade. Pull the
  // selected one fully into view so the active tab is never the clipped one.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTab])

  return (
    <div className="relative px-3 pb-0.5">
      <div
        className="npk-tabs flex gap-0.5 overflow-x-auto pe-[22px]"
        role="tablist"
        aria-label={t("addnode.tablistAria")}
      >
        {ADD_NODE_MENU_TABS.map((id) => {
          const icon = TAB_ICON[id]
          const label = t(PICKER_TAB_LABEL_KEY[id])
          const active = activeTab === id
          return (
            <button
              key={id}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-[7px]",
                "text-[12.5px] font-medium transition-colors",
                active
                  ? "bg-[var(--npk-tab-active)] text-[var(--npk-accent)]"
                  : "text-[var(--npk-dim)] hover:bg-[var(--npk-hover)] hover:text-[var(--npk-t2)]",
              )}
            >
              {icon}
              {label}
            </button>
          )
        })}
      </div>
      {/* Fade painted in the surface colour so the strip reads as clipped, not
          cut. It sits on the inline END (the overflow side), so under RTL it
          moves to the left edge and the gradient flips with it. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 end-3 w-5 from-[var(--npk-surface)] to-transparent",
          isRtl ? "bg-gradient-to-r" : "bg-gradient-to-l",
        )}
      />
    </div>
  )
}
