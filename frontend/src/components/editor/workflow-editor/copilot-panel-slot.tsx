/**
 * Core shims for the Copilot: the rail beside the canvas, the middle of an
 * empty canvas, and the top-bar tab.
 *
 * Core code may not statically import from `ee/`, so every Copilot surface
 * arrives through `lazy(() => import(...))` — the same pattern as
 * `app-sidebar.tsx`'s org switcher, and the only route from core to
 * enterprise UI. On a community build `copilotSurfaced()` is false, the import
 * expressions are never evaluated, and no ee chunk is ever requested.
 *
 * Where the Copilot sits is the `mode` in `use-copilot-ui-store` — `center`,
 * `panel`, `min` (the folded strip) or `hidden` — moved by the canvas
 * (`copilot-placement.ts`) and by the person (the tab, the strip, the panel's
 * own buttons). On a desktop the rail chunk is loaded at once: it reports the
 * conversation's size (the strip's count, and whether the middle is free), and
 * mounts the heavy panel only once it is first opened. A phone has no rail and
 * no middle: the panel is a sheet over the canvas, opened from the tab.
 */
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { Bot, Loader2 } from "lucide-react"
import { SHORTCUTS, formatBinding, isMacPlatform, matchShortcut } from "@/lib/shortcuts"
import { COPILOT_RAIL_WIDTH, COPILOT_TAB_WIDTH, copilotSurfaced, useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useT } from "@/lib/i18n"
import type { SceneNodeType } from "@/types/nodes"
import { canvasHasContent, copilotTabTarget, goToCopilotMode, useCopilotCenterAllowed } from "./copilot-placement"

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

type PanelProps = CopilotPanelSlotProps & { onClose: () => void; onMinimize: () => void; fullScreen?: boolean }

export interface CopilotCenterProps {
  /** Exit animation: the Copilot is on its way to the rail. */
  readonly leaving: boolean
  /** Adds a node at the middle of the canvas (the "Or start manually" buttons). */
  readonly onCreate: (type: SceneNodeType) => void
  /** The canvas's own right-click menu: a right-click on the box opens it too. */
  readonly onContextMenu: (event: ReactMouseEvent) => void
}

/**
 * Resolved on first render rather than at module load: the `import()`
 * factories are only ever constructed on a build where the Copilot is
 * surfaced, so a community bundle never requests a chunk — and the gate stays
 * observable to a test instead of being frozen into module scope.
 */
let lazyPanel: ComponentType<PanelProps> | null = null
let lazyRail: ComponentType<CopilotPanelSlotProps> | null = null
let lazyCenter: ComponentType<CopilotCenterProps> | null = null

function resolvePanel() {
  if (!copilotSurfaced()) return null
  lazyPanel ??= lazy(() => import("@/ee/components/copilot/copilot-panel")) as unknown as ComponentType<PanelProps>
  return lazyPanel
}

function resolveRail() {
  if (!copilotSurfaced()) return null
  lazyRail ??= lazy(() => import("@/ee/components/copilot/copilot-rail")) as unknown as ComponentType<CopilotPanelSlotProps>
  return lazyRail
}

function resolveCenter() {
  if (!copilotSurfaced()) return null
  lazyCenter ??= lazy(() => import("@/ee/components/copilot/copilot-center")) as unknown as ComponentType<CopilotCenterProps>
  return lazyCenter
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

  const mode = useCopilotUiStore((s) => s.mode)
  const everOpened = useCopilotUiStore((s) => s.everOpened)
  const closePanel = useCopilotUiStore((s) => s.closePanel)
  const isMobile = useIsMobile()

  if (!copilotSurfaced()) return null

  if (isMobile) {
    const CopilotPanel = resolvePanel()
    if (!CopilotPanel || (mode !== "panel" && !everOpened)) return null
    return (
      // Once opened the sheet stays mounted (draft, scroll); `hidden` takes it away.
      <div className={mode === "panel" ? "contents" : "hidden"}>
        <Suspense fallback={<CopilotPanelFallback />}>
          <CopilotPanel onClose={closePanel} onMinimize={closePanel} fullScreen {...props} />
        </Suspense>
      </div>
    )
  }

  const CopilotRail = resolveRail()
  if (!CopilotRail) return null
  return (
    <Suspense fallback={mode === "min" ? <CopilotCollapsedTab /> : mode === "panel" ? <CopilotPanelFallback /> : null}>
      <CopilotRail {...props} />
    </Suspense>
  )
}

/** How long the middle takes to leave for the rail — matches the rail's own width transition. */
export const COPILOT_CENTER_EXIT_MS = 350

/**
 * The Copilot in the middle of an empty canvas. Rendered by the canvas where
 * the first-run surface goes; `visible` is the canvas's `copilot-center`
 * surface. When it turns false the Copilot plays its exit (it slides toward the
 * rail and fades) before unmounting.
 */
export function CopilotCenterSlot({
  visible,
  onCreate,
  onContextMenu,
}: {
  readonly visible: boolean
  readonly onCreate: (type: SceneNodeType) => void
  readonly onContextMenu: (event: ReactMouseEvent) => void
}) {
  const [mounted, setMounted] = useState(visible)
  const [leaving, setLeaving] = useState(false)
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mountedRef.current) return
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, COPILOT_CENTER_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  if (!mounted) return null
  const CopilotCenter = resolveCenter()
  if (!CopilotCenter) return null
  return (
    <Suspense fallback={null}>
      <CopilotCenter leaving={leaving} onCreate={onCreate} onContextMenu={onContextMenu} />
    </Suspense>
  )
}

/** The folded strip, without its reply count — shown while the rail chunk loads. */
export function CopilotCollapsedTab() {
  const t = useT()
  const openPanel = useCopilotUiStore((s) => s.openPanel)
  if (!copilotSurfaced()) return null
  return (
    <button
      type="button"
      onClick={openPanel}
      title={t("editor.copilotTitle", { sc: formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform()) })}
      style={{ width: COPILOT_TAB_WIDTH }}
      className="flex-none bg-[var(--copilot-panel)] border-e border-border flex flex-col items-center pt-4 gap-2.5 text-primary hover:bg-[var(--copilot-card)] transition-colors"
    >
      <Bot className="w-3.5 h-3.5" strokeWidth={1.8} />
      <span className="[writing-mode:vertical-rl] text-[10px] tracking-[0.18em] font-semibold">{t("editor.copilotTabLabel")}</span>
    </button>
  )
}

function CopilotPanelFallback() {
  return (
    <div
      style={{ width: COPILOT_RAIL_WIDTH }}
      className="flex-none bg-[var(--copilot-panel)] border-e border-border flex items-center justify-center"
    >
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  )
}

/** The tab (or `mod+J`): moves the Copilot on from where it is now. */
function pressCopilotTab(isMobile: boolean, centerAllowed: boolean) {
  const ui = useCopilotUiStore.getState()
  const target = copilotTabTarget({
    mode: ui.mode,
    isMobile,
    hasContent: canvasHasContent(),
    centerAllowed,
    returnToCenterWhenEmpty: ui.returnToCenterWhenEmpty,
  })
  goToCopilotMode(target, ui.mode === "panel" ? "min" : undefined)
}

/**
 * The top-bar Copilot tab. Pink while the rail is open; a click folds an open
 * rail and unfolds a folded or hidden one (see `copilotTabTarget`). Also owns
 * the `mod+J` binding, so the shortcut works from anywhere in the editor
 * without a second listener somewhere else.
 */
export function CopilotToolbarButton() {
  const t = useT()
  const mode = useCopilotUiStore((s) => s.mode)
  const isMobile = useIsMobile()
  const centerAllowed = useCopilotCenterAllowed()
  const latest = useRef({ isMobile, centerAllowed })
  latest.current = { isMobile, centerAllowed }

  useEffect(() => {
    if (!copilotSurfaced()) return
    const onKey = (e: KeyboardEvent) => {
      if (!matchShortcut(e, SHORTCUTS.copilot)) return
      e.preventDefault()
      pressCopilotTab(latest.current.isMobile, latest.current.centerAllowed)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!copilotSurfaced()) return null

  const open = mode === "panel"
  return (
    <button
      type="button"
      onClick={() => pressCopilotTab(isMobile, centerAllowed)}
      aria-pressed={open}
      title={t("editor.copilotTitle", { sc: formatBinding(SHORTCUTS.copilot.bindings[0], isMacPlatform()) })}
      className={`ms-auto me-2 self-center flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        open
          ? "bg-primary/10 border border-primary/50 text-primary"
          : "bg-[var(--copilot-card)] border border-border text-muted-foreground hover:text-foreground hover:border-[var(--copilot-strong)]"
      }`}
    >
      <Bot className="w-3.5 h-3.5" strokeWidth={1.8} />
      {t("editor.copilotName")}
    </button>
  )
}
