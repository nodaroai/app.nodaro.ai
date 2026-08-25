/**
 * Live state for the Copilot panel.
 *
 * This is a MODULE-level store on purpose. The panel is rendered inside the
 * editor tab, which unmounts when the user switches to Present / Executions /
 * Cost — if the streaming loop lived in a component hook, that tab switch would
 * abort a turn the user is paying for. State and stream live here; components
 * only subscribe.
 *
 * Server state (thread settings, message history) stays in React Query. This
 * store holds only what a turn produces while it is in flight, plus the
 * composer draft.
 */
import { create } from "zustand"
import { EMPTY_TURN, type CopilotMention, type CopilotRunMode, type CopilotRunPhase, type CopilotTurnState, CopilotModelTier } from "./types"

/**
 * Callbacks the editor owns and the engine borrows. Registered by the panel on
 * mount (mirrors how `workflow-editor-main` registers `setExpandStoryboard` and
 * friends into the workflow store) and nulled when the editor tab goes away, so
 * the engine must always null-check before calling.
 */
/** What the editor's `save()` actually answers with. It RESOLVES on failure — it does not throw. */
export interface CopilotSaveResult {
  readonly success: boolean
  readonly error?: string
}

export interface CopilotEditorBridge {
  save: ((projectId: string) => Promise<CopilotSaveResult>) | null
  /**
   * Starts a run and answers with the execution it started, or null if it
   * bailed (not enough credits, nothing executable, a declined confirm, a
   * failed start). A pass-through of what the editor already announces —
   * never inferred from `isRunning`, which is a React-lagged mirror and is
   * still true at the moment a bail resolves.
   */
  run: ((opts?: { skipConfirm?: boolean }) => Promise<{ executionId: string | null }>) | null
  projectId: string | undefined
  creditEstimate: number
  /** True while the estimate is being refetched — its current value is the PREVIOUS graph's. */
  estimateStale: boolean
  /**
   * The canvas version `creditEstimate` was computed for.
   *
   * `estimateStale` is a boolean that has to ARRIVE in time, and it does not:
   * when realtime delivers the copilot's write before the SSE event, the
   * proposal is processed before React has flushed the effect that raises it.
   * Comparing versions is an invariant instead of a race.
   */
  estimateVersion: number | null
  isRunning: boolean
  activeExecutionId: string | null
}

export interface CopilotStoreState {
  threadId: string | null
  workflowId: string | null

  turn: CopilotTurnState
  streaming: boolean

  /** Ask/Auto and its ceiling. Local-first so the toggle works before a thread exists. */
  runMode: CopilotRunMode
  autoRunLimit: number
  /** The thread's model ladder rung. Local-first like runMode. */
  modelTier: CopilotModelTier

  runPhase: CopilotRunPhase
  /** The execution the panel is following — set when a run starts from a proposal. */
  executionId: string | null
  /** Cleared per turn: how many auto-runs this assistant message already triggered. */
  autoRunCount: number
  /**
   * How many turns deep the unattended fix loop currently is. Reset ONLY by a
   * send the user initiated — an auto "Fix it" must not reopen its own budget,
   * or a repeatably-failing run spends the whole balance with nobody watching.
   */
  autoFixChain: number
  /** Which execution's outcome has already been acted on. Store-level, so a remount cannot re-report. */
  lastReportedExecutionId: string | null
  /**
   * The last turn this tab started, kept after the stream ends.
   *
   * A turn outlives its SSE connection: the browser can lose the stream while
   * the server keeps working. Without this, the panel cannot tell "my own turn
   * is still going" from "another tab is working", and told the user the
   * second when the first was true.
   */
  lastTurnId: string | null
  proposalDismissed: boolean

  activityCollapsed: boolean
  draft: string
  mentions: CopilotMention[]

  /** Transient one-liner above the composer ("Saving…", "another tab", …). */
  notice: string | null
  insufficient: { required: number; balance: number } | null

  bridge: CopilotEditorBridge

  setDraft: (draft: string) => void
  addMention: (mention: CopilotMention) => void
  removeMention: (id: string) => void
  clearComposer: () => void
  setActivityCollapsed: (collapsed: boolean) => void
  dismissProposal: () => void
  setNotice: (notice: string | null) => void
  setInsufficient: (value: { required: number; balance: number } | null) => void
  setBridge: (patch: Partial<CopilotEditorBridge>) => void
  setRunSettings: (mode: CopilotRunMode, limit: number, allowPublishing?: boolean, modelTier?: CopilotModelTier) => void
  /** This thread may author publishing nodes. Off until the user says so. */
  allowPublishing: boolean
  /** Undo on a pinned memory save — the DELETE already succeeded when this runs. */
  removeMemorySave: (id: string) => void
  /** Called when the editor loads a different workflow — everything resets. */
  resetForWorkflow: (workflowId: string | null) => void
}

/** Matches the column default on `copilot_threads.auto_run_limit_credits`. */
export const DEFAULT_AUTO_RUN_LIMIT = 100

const EMPTY_BRIDGE: CopilotEditorBridge = {
  save: null,
  run: null,
  projectId: undefined,
  creditEstimate: 0,
  estimateStale: false,
  estimateVersion: null,
  isRunning: false,
  activeExecutionId: null,
}

export const useCopilotStore = create<CopilotStoreState>((set, get) => ({
  threadId: null,
  workflowId: null,
  turn: EMPTY_TURN,
  streaming: false,
  runMode: "ask",
  allowPublishing: false,
  modelTier: "standard",
  autoRunLimit: DEFAULT_AUTO_RUN_LIMIT,
  runPhase: "idle",
  executionId: null,
  autoRunCount: 0,
  autoFixChain: 0,
  lastReportedExecutionId: null,
  lastTurnId: null,
  proposalDismissed: false,
  activityCollapsed: false,
  draft: "",
  mentions: [],
  notice: null,
  insufficient: null,
  bridge: EMPTY_BRIDGE,

  setDraft: (draft) => set({ draft }),
  addMention: (mention) =>
    set((s) => (s.mentions.some((m) => m.id === mention.id) ? s : { ...s, mentions: [...s.mentions, mention] })),
  removeMention: (id) => set((s) => ({ mentions: s.mentions.filter((m) => m.id !== id) })),
  clearComposer: () => set({ draft: "", mentions: [] }),
  setActivityCollapsed: (activityCollapsed) => set({ activityCollapsed }),
  dismissProposal: () => set({ proposalDismissed: true, runPhase: "idle" }),
  setNotice: (notice) => set({ notice }),
  setInsufficient: (insufficient) => set({ insufficient }),
  setBridge: (patch) =>
    set((s) => {
      const next = { ...s.bridge, ...patch }
      // The panel re-registers on every editor render; a no-op write would
      // hand every `s.bridge` subscriber a new object each time.
      const unchanged = (Object.keys(next) as Array<keyof CopilotEditorBridge>).every((k) => next[k] === s.bridge[k])
      return unchanged ? s : { bridge: next }
    }),
  setRunSettings: (runMode, autoRunLimit, allowPublishing, modelTier) =>
    set({
      runMode,
      autoRunLimit,
      ...(allowPublishing === undefined ? {} : { allowPublishing }),
      ...(modelTier === undefined ? {} : { modelTier }),
    }),
  removeMemorySave: (id) =>
    set((s) => ({ turn: { ...s.turn, memorySaves: s.turn.memorySaves.filter((m) => m.id !== id) } })),

  resetForWorkflow: (workflowId) => {
    if (get().workflowId === workflowId) return
    set({
      workflowId,
      threadId: null,
      turn: EMPTY_TURN,
      streaming: false,
      runPhase: "idle",
      executionId: null,
      autoRunCount: 0,
      autoFixChain: 0,
      lastReportedExecutionId: null,
      lastTurnId: null,
      proposalDismissed: false,
      activityCollapsed: false,
      draft: "",
      mentions: [],
      notice: null,
      insufficient: null,
    })
  },
}))

/** Non-reactive accessor for the engine, which runs outside React. */
export function copilotState(): CopilotStoreState {
  return useCopilotStore.getState()
}

export function setCopilotState(patch: Partial<CopilotStoreState>): void {
  useCopilotStore.setState(patch)
}

export type { CopilotRunMode }
