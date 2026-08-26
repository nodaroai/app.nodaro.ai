/**
 * Core shim for the Copilot rail.
 *
 * Core code may not statically import from `ee/`, so the panel arrives through
 * `lazy(() => import(...))` — the same pattern as `app-sidebar.tsx`'s org
 * switcher, and the only route from core to enterprise UI. On a community
 * build `hasCredits()` is false, the import expression is never evaluated, and
 * the chunk is never requested.
 *
 * Once opened, the panel stays MOUNTED and is hidden with `display:none` when
 * closed. That preserves the composer draft and the scroll position across a
 * close/reopen. (Turn survival does not depend on it — the streaming loop lives
 * in a module-level engine, not in this subtree.)
 */
import { Suspense, lazy, useEffect, type ComponentType } from "react"
import { useSearchParams } from "react-router-dom"
import { Bot, Loader2 } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { SHORTCUTS, formatBinding, isMacPlatform, matchShortcut } from "@/lib/shortcuts"
import { COPILOT_RAIL_WIDTH, COPILOT_TAB_WIDTH, useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { useIsMobile } from "@/hooks/use-is-mobile"

/**
 * Resolved on first render rather than at module load: the `import()` factory
 * is only ever constructed on a build that has credits, so a community bundle
 * never requests the chunk — and the gate stays observable to a test instead of
 * being frozen into module scope.
 */
let lazyPanel: ComponentType<CopilotPanelSlotProps & { onClose: () => void; fullScreen?: boolean }> | null = null
function resolvePanel() {
  if (!hasCredits()) return null
  lazyPanel ??= lazy(() => import("@/ee/components/copilot/copilot-panel")) as unknown as ComponentType<
    CopilotPanelSlotProps & { onClose: () => void; fullScreen?: boolean }
  >
  return lazyPanel
}

/**
 * Handoff arrivals already acted on, so closing the rail sticks.
 *
 * Keyed by THREAD id, while the handoff hook's own set is keyed by WORKFLOW
 * id. They are deliberately separate questions — "has this rail been opened
 * for this arrival" versus "has this workflow been handed off" — and the only
 * thing that keeps them from diverging visibly is that the parameter is
 * consumed once. Anything that starts preserving it needs to revisit both.
 */
const honouredArrivals = new Set<string>()

export interface CopilotPanelSlotProps {
  projectId: string | undefined
  save: ((projectId: string) => Promise<{ success: boolean; error?: string }>) | null
  run: ((opts?: { skipConfirm?: boolean }) => Promise<{ executionId: string | null }>) | null
  runNode: ((nodeId: string, opts?: { skipConfirm?: boolean }) => Promise<{ started: boolean }>) | null
  estimateNode: ((nodeId: string) => number | null) | null
  onStopRun: () => void
  creditEstimate: number
  /** True while the editor is refetching model costs. */
  estimateStale: boolean
  /** The canvas version the estimate was computed for. */
  estimateVersion: number | null
  isRunning: boolean
  activeExecutionId: string | null
}

export function CopilotPanelSlot(props: CopilotPanelSlotProps) {
  // A reload on the handoff URL must reopen the rail, or the user lands on a
  // closed panel with a turn starting behind it.
  //
  // Once per thread id, NOT "while the parameter is present": the panel
  // subtree unmounts on an editor tab switch, so re-reading the URL would
  // reopen a rail the user had deliberately closed, every time they came back.
  const [searchParams] = useSearchParams()
  const arrivingFor = searchParams.get("copilot")
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  useEffect(() => {
    if (!arrivingFor || honouredArrivals.has(arrivingFor)) return
    honouredArrivals.add(arrivingFor)
    openPanel()
  }, [arrivingFor, openPanel])

  const open = useCopilotUiStore((s) => s.open)
  const everOpened = useCopilotUiStore((s) => s.everOpened)
  const closePanel = useCopilotUiStore((s) => s.closePanel)
  // A phone has no room for a rail beside the canvas — and no room for a 40px
  // tab permanently eating its width either. There the panel is a sheet over
  // the canvas, reached from the toolbar button.
  const isMobile = useIsMobile()

  const CopilotPanel = resolvePanel()
  if (!CopilotPanel) return null
  if (!open && !everOpened) return isMobile ? null : <CopilotCollapsedTab />

  return (
    <>
      {!open && !isMobile && <CopilotCollapsedTab />}
      {/* `contents` keeps the panel's own flex sizing; `hidden` removes it entirely. */}
      <div className={open ? "contents" : "hidden"}>
        <Suspense fallback={<CopilotPanelFallback />}>
          <CopilotPanel onClose={closePanel} fullScreen={isMobile} {...props} />
        </Suspense>
      </div>
    </>
  )
}

/** The always-visible way back in when the rail is closed. */
export function CopilotCollapsedTab() {
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  if (!hasCredits()) return null
  return (
    <button
      type="button"
      onClick={openPanel}
      title={`Copilot (${formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform())})`}
      style={{ width: COPILOT_TAB_WIDTH }}
      className="flex-none bg-[var(--copilot-panel)] border-r border-border flex flex-col items-center pt-4 gap-2.5 text-primary hover:bg-[var(--copilot-card)] transition-colors"
    >
      <Bot className="w-3.5 h-3.5" strokeWidth={1.8} />
      <span className="[writing-mode:vertical-rl] text-[10px] tracking-[0.18em] font-semibold">COPILOT</span>
    </button>
  )
}

function CopilotPanelFallback() {
  return (
    <div
      style={{ width: COPILOT_RAIL_WIDTH }}
      className="flex-none bg-[var(--copilot-panel)] border-r border-border flex items-center justify-center"
    >
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * Toolbar toggle. Also owns the `mod+J` binding, so the shortcut works from
 * anywhere in the editor without a second listener somewhere else.
 */
export function CopilotToolbarButton() {
  const open = useCopilotUiStore((s) => s.open)
  const togglePanel = useCopilotUiStore((s) => s.togglePanel)

  useEffect(() => {
    if (!hasCredits()) return
    const onKey = (e: KeyboardEvent) => {
      if (!matchShortcut(e, SHORTCUTS.copilot)) return
      e.preventDefault()
      useCopilotUiStore.getState().togglePanel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!hasCredits()) return null

  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-pressed={open}
      title={`Copilot (${formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform())})`}
      className={`ml-auto mr-2 self-center flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        open
          ? "bg-primary/10 border border-primary/50 text-primary"
          : "bg-[var(--copilot-card)] border border-border text-muted-foreground hover:text-foreground hover:border-[var(--copilot-strong)]"
      }`}
    >
      <Bot className="w-3.5 h-3.5" strokeWidth={1.8} />
      Copilot
    </button>
  )
}
