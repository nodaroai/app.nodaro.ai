/**
 * The docked Copilot on a desktop: the panel, folded to a strip, or away.
 *
 * Loaded at once on a desktop editor (through the core slot), because it
 * reports the conversation's size — the strip's count, and what the canvas
 * asks before it leaves the Copilot in the middle (`copilot-placement.ts`).
 * The panel is a separate, heavier chunk, mounted the first time the rail
 * opens and kept mounted after (draft, scroll), hidden while folded or away.
 *
 * The width animates between the rail, the strip and nothing, so the Copilot
 * arriving from the middle of the canvas slides in rather than appears.
 */
import { Suspense, lazy, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { COPILOT_RAIL_WIDTH, copilotRailWidthFor, useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { leaveRail, useCopilotCenterAllowed } from "@/components/editor/workflow-editor/copilot-placement"
import { SHORTCUTS, formatBinding, isMacPlatform } from "@/lib/shortcuts"
import { useT } from "@/lib/i18n"
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import { useCopilotConversationSize } from "@/ee/hooks/copilot/use-copilot-thread"
import type { CopilotPanelSlotProps } from "@/components/editor/workflow-editor/copilot-panel-slot"

const CopilotPanel = lazy(() => import("./copilot-panel"))

export default function CopilotRail(props: CopilotPanelSlotProps) {
  const mode = useCopilotUiStore((s) => s.mode)
  const everOpened = useCopilotUiStore((s) => s.everOpened)
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  const setConversation = useCopilotUiStore((s) => s.setConversation)
  const centerAllowed = useCopilotCenterAllowed()

  const { messages, replies, known } = useCopilotConversationSize()
  useEffect(() => {
    setConversation(messages, known)
  }, [messages, known, setConversation])

  return (
    <div
      style={{ width: copilotRailWidthFor(mode) }}
      className="flex-none relative overflow-hidden transition-[width] duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)]"
    >
      {mode === "min" && <CopilotStrip replies={replies} onOpen={openPanel} />}
      {everOpened && (
        <div
          style={{ width: COPILOT_RAIL_WIDTH }}
          className={mode === "panel" ? "absolute inset-y-0 start-0 flex" : "hidden"}
        >
          <Suspense fallback={<PanelLoading />}>
            <CopilotPanel
              onClose={() => leaveRail("hidden", centerAllowed)}
              onMinimize={() => leaveRail("min", centerAllowed)}
              {...props}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}

/** The folded rail: the name on its side and the number of replies so far. One click unfolds it. */
function CopilotStrip({ replies, onOpen }: { readonly replies: number; readonly onOpen: () => void }) {
  const t = useT()
  // The count is drawn as a bare number; a screen reader hears it as words, in the button's own name.
  const name = replies > 0
    ? [t(K.openPanel), t(replies === 1 ? K.repliesOne : K.repliesOther, { n: replies })].join(t("common.listComma"))
    : t(K.openPanel)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={name}
      title={t("editor.copilotTitle", { sc: formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform()) })}
      className="absolute inset-0 bg-[var(--copilot-panel)] border-e border-border flex flex-col items-center pt-4 gap-2.5 text-primary hover:bg-[var(--copilot-card)] transition-colors"
    >
      <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" aria-hidden />
      <span className="[writing-mode:vertical-rl] text-[10px] tracking-[0.18em] font-semibold" aria-hidden>{t("editor.copilotTabLabel")}</span>
      {replies > 0 && (
        <span
          aria-hidden
          className="mt-1 min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-[16px] text-center tabular-nums"
        >
          {replies}
        </span>
      )}
    </button>
  )
}

function PanelLoading() {
  return (
    <div
      style={{ width: COPILOT_RAIL_WIDTH }}
      className="bg-[var(--copilot-panel)] border-e border-border flex items-center justify-center"
    >
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  )
}
