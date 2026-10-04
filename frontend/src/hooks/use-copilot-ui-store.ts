/**
 * Where the Copilot is: in the middle of an empty canvas, docked as the rail,
 * folded to a strip, or put away.
 *
 * CORE on purpose, even though the panel itself is enterprise: the editor
 * toolbar button, the strip, the canvas and the panel slot all need to read
 * it, and core code may not import from `ee/`. It holds no copilot logic — a
 * mode, a few flags and the conversation size the ee side publishes — so a
 * community build carries a few bytes and renders nothing.
 *
 * Which mode the canvas puts it in as nodes come and go is decided by the
 * pure rules in `components/editor/workflow-editor/copilot-placement.ts`.
 */
import { create } from "zustand"
import { hasCredits } from "@/lib/edition"
import { surfaceFeatureHidden } from "@/lib/surface-selectors"

/** Open rail width in px. The panel's own class and every layout offset read this. */
export const COPILOT_RAIL_WIDTH = 380

/** Folded strip width in px. */
export const COPILOT_TAB_WIDTH = 40

/**
 * - `center`: in the middle of an empty canvas, as the first thing to do.
 * - `panel`: the rail at the inline start of the canvas.
 * - `min`: folded to a narrow strip; one click unfolds it.
 * - `hidden`: put away; the top-bar tab brings it back.
 */
export type CopilotMode = "center" | "panel" | "min" | "hidden"

/** The modes a person picks for the docked Copilot. `center` is the canvas's to give. */
export type CopilotDock = Exclude<CopilotMode, "center">

const RETURN_TO_CENTER_KEY = "nodaro.copilot.returnToCenterWhenEmpty"

function readReturnToCenter(): boolean {
  try {
    return globalThis.localStorage?.getItem(RETURN_TO_CENTER_KEY) !== "false"
  } catch {
    return true
  }
}

function writeReturnToCenter(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(RETURN_TO_CENTER_KEY, on ? "true" : "false")
  } catch {
    // A blocked storage costs the preference, not the switch.
  }
}

interface CopilotUiState {
  mode: CopilotMode
  /** The docked mode the person last chose — where the Copilot goes when it leaves the center for a non-empty workflow. */
  dock: CopilotDock
  /** True once the panel has been shown in this session — gates the lazy panel chunk, which then stays mounted. */
  everOpened: boolean
  /** Set by the panel while a turn streams, so the editor can keep out of the way. */
  turnActive: boolean
  /** Messages in the open workflow's conversation (both sides), published by the ee side. */
  messageCount: number
  /** Whether `messageCount` is known for the open workflow yet (its history has loaded, or it has none). */
  conversationKnown: boolean
  /** Back to the middle when the last node goes and there is no conversation. A setting, on by default. */
  returnToCenterWhenEmpty: boolean
  /** Bumped by "Ask Copilot…": the visible composer (center or panel) takes the focus. */
  focusTick: number
  /**
   * A message typed in the middle, waiting for the rail: the panel registers the
   * editor callbacks a send needs on mount, so the center hands the text over
   * instead of sending it itself. Bound to its workflow, so a switch in between
   * never sends it to another one.
   */
  pendingPrompt: { readonly text: string; readonly workflowId: string; readonly sentAt: number } | null
  openPanel: () => void
  minimize: () => void
  /** Puts the Copilot away (the X). */
  closePanel: () => void
  /** The middle of the canvas. Leaving the rail for it records how the rail was left (`dock`). */
  showCenter: (dock?: CopilotDock) => void
  /** The canvas's own moves (copilot-placement). Never records a dock preference. */
  setMode: (mode: CopilotMode) => void
  /** "Ask Copilot…": focus the composer in the middle, or open the rail and focus its composer. */
  askCopilot: () => void
  setTurnActive: (active: boolean) => void
  setConversation: (messageCount: number, known: boolean) => void
  setReturnToCenterWhenEmpty: (on: boolean) => void
  /** The center hands a message to the rail and opens it. */
  sendFromCenter: (text: string, workflowId: string) => void
  clearPendingPrompt: () => void
}

export const useCopilotUiStore = create<CopilotUiState>((set) => ({
  mode: "min",
  dock: "min",
  everOpened: false,
  turnActive: false,
  messageCount: 0,
  conversationKnown: false,
  returnToCenterWhenEmpty: readReturnToCenter(),
  focusTick: 0,
  pendingPrompt: null,
  openPanel: () => set({ mode: "panel", dock: "panel", everOpened: true }),
  minimize: () => set({ mode: "min", dock: "min" }),
  closePanel: () => set({ mode: "hidden", dock: "hidden" }),
  showCenter: (dock) => set(dock ? { mode: "center", dock } : { mode: "center" }),
  setMode: (mode) => set((s) => ({ mode, everOpened: s.everOpened || mode === "panel" })),
  askCopilot: () =>
    set((s) =>
      s.mode === "center"
        ? { focusTick: s.focusTick + 1 }
        : { mode: "panel", dock: "panel", everOpened: true, focusTick: s.focusTick + 1 },
    ),
  setTurnActive: (turnActive) => set({ turnActive }),
  setConversation: (messageCount, conversationKnown) => set({ messageCount, conversationKnown }),
  setReturnToCenterWhenEmpty: (on) => {
    writeReturnToCenter(on)
    set({ returnToCenterWhenEmpty: on })
  },
  sendFromCenter: (text, workflowId) =>
    set({ pendingPrompt: { text, workflowId, sentAt: Date.now() }, mode: "panel", dock: "panel", everOpened: true }),
  clearPendingPrompt: () => set({ pendingPrompt: null }),
}))

/**
 * Is the Copilot surfaced at all here? Two independent questions, answered
 * once: the EDITION must have credits (the copilot spends them), and the
 * DEPLOYMENT must not have switched the feature off. Every render path and
 * every layout offset asks this — a site that asked only `hasCredits()` would
 * keep rendering a button whose backend answers 503, or keep reserving room
 * for a rail that is not there.
 */
export function copilotSurfaced(): boolean {
  return hasCredits() && !surfaceFeatureHidden("copilot")
}

/** The width the docked Copilot takes in a mode: the rail, the strip, or nothing. */
export function copilotRailWidthFor(mode: CopilotMode): number {
  if (mode === "panel") return COPILOT_RAIL_WIDTH
  if (mode === "min") return COPILOT_TAB_WIDTH
  return 0
}

/**
 * How many px the rail currently takes at the inline start.
 *
 * The editor's floating toolbar is `position: fixed` and offsets itself from
 * the app sidebar, so without this it renders ON TOP of the rail — the reported
 * bug. Anything else anchored to the inline-start edge should offset by this
 * too. Returns 0 when the Copilot is not surfaced at all — a community
 * edition, or a deployment that hides the feature — and 0 while it sits in the
 * middle of the canvas or is put away: then there is no rail.
 *
 * Known gap: the slot's mobile gate is `(max-width: 899px) and (pointer:
 * coarse)` (use-is-mobile.ts), wider than Tailwind's `md` (768px). On a touch
 * device between 768 and 899px the slot renders no strip while the desktop
 * rail is visible, so this over-reports by COPILOT_TAB_WIDTH — symmetric in
 * both directions, and left as is until the two gates share one breakpoint.
 */
export function useCopilotRailWidth(): number {
  return useCopilotUiStore((s) => (copilotSurfaced() ? copilotRailWidthFor(s.mode) : 0))
}
