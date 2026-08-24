/**
 * The Copilot turn: send, stream, keep the canvas honest, settle.
 *
 * Module-level on purpose — see the note in `turn-store.ts`. Nothing here
 * touches React, so a tab switch, a closed panel or a re-render cannot abort a
 * turn the user is being billed for. The only way a turn ends early is an
 * explicit stop, a workflow change, or leaving the editor.
 */
import { getAuthHeaders } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { runtimeApiUrl } from "@/lib/runtime-config"
import { SseHttpError, streamRequest } from "@/lib/sse-client"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { CopilotApiError, cancelCopilotTurn, createCopilotThread, updateCopilotThread } from "./api"
import { ensureCanvasVersion } from "./canvas-sync"
import { buildWireMessage } from "./mentions"
import { COPILOT_STRINGS } from "./strings"
import {
  copilotState,
  setCopilotState,
  useCopilotStore,
  type CopilotEditorBridge,
  type CopilotSaveResult,
} from "./turn-store"
import { reduceTurn, startTurn } from "./turn-reducer"
import { EMPTY_TURN, type CopilotStreamEvent, type CopilotThread, type CopilotTurnState } from "./types"

/**
 * How many runs one assistant message may start on its own: exactly one.
 *
 * `run_workflow` ENDS the turn server-side, so a second proposal in the same
 * message only ever comes from the loop dispatching two tool blocks before it
 * stops — never from the copilot legitimately wanting two runs. This count is
 * the durable half of the concurrency guard; `runPhase === "running"` is the
 * fast half, and cannot stand alone because the UI-recovery revert in
 * `startProposedRun` re-opens it.
 */
const MAX_AUTO_RUNS_PER_TURN = 1

/**
 * How many times the fix loop may restart itself before it asks for a human.
 * This is the bound that matters: MAX_AUTO_RUNS_PER_TURN is per turn, and an
 * auto "Fix it" opens a NEW turn — so without this a repeatably-failing run
 * chains paid turn after paid turn with nobody watching.
 */
const MAX_AUTO_FIX_CHAIN = 2

let controller: AbortController | null = null

/**
 * Synchronous re-entry latch.
 *
 * `streaming` cannot serve as one: it is set only after `save()` and the
 * thread handshake have resolved, so two Enters ~80ms apart on a dirty canvas
 * both pass the check and open two paid turns on one thread.
 */
let sending = false

/**
 * Bumped whenever the panel is torn down (a different workflow loaded). The
 * stream loop stamps every write with the generation it started in, so an
 * `AbortError` landing a microtask after the switch cannot paint "Stopped."
 * onto the workflow the user just opened.
 */
let generation = 0

function apply(next: (turn: CopilotTurnState) => CopilotTurnState, bornIn = generation): void {
  if (bornIn !== generation) return
  setCopilotState({ turn: next(copilotState().turn) })
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function sendCopilotMessage(
  rawText: string,
  opts: { auto?: boolean } = {},
): Promise<void> {
  const state = copilotState()
  if (sending || state.streaming) return
  const text = rawText.trim()
  if (!text) return
  sending = true
  try {
    await send(rawText, opts, state)
  } finally {
    sending = false
  }
}

async function send(
  rawText: string,
  opts: { auto?: boolean },
  state: ReturnType<typeof copilotState>,
): Promise<void> {
  const text = rawText.trim()

  const wire = buildWireMessage(text, state.mentions)
  const workflow = useWorkflowStore.getState()
  if (workflow.isReadOnly) return

  // A workflow the user never saved has no row for `edit_workflow` to write to,
  // and unsaved edits would be clobbered by the copilot's own write. Both cases
  // have the same fix: flush first, and refuse rather than lose work.
  if (!workflow.workflowId || workflow.isDirty) {
    const { save, projectId } = copilotState().bridge
    if (!save || !projectId) {
      setCopilotState({ notice: "Open the workflow editor to save before asking." })
      return
    }
    setCopilotState({ notice: COPILOT_STRINGS.saving })
    // `save` RESOLVES with { success: false } on every real failure path
    // (remote conflict, write error, no project) — it does not throw. Reading
    // the result is the whole guard; a try/catch alone would let a failed save
    // fall through and hand the copilot a graph without the user's edits.
    const result = await save(projectId).catch(() => ({ success: false }) as CopilotSaveResult)
    if (copilotState().notice === COPILOT_STRINGS.saving) setCopilotState({ notice: null })
    if (!result?.success) {
      setCopilotState({
        notice: SAVE_FAILED_NOTICE.get(result?.error ?? "") ?? "Could not save the workflow — try again.",
      })
      return
    }
    // The user can type while the save is in flight; the flag, not the call, is
    // the invariant that the copilot and the canvas agree on one graph.
    if (useWorkflowStore.getState().isDirty) {
      setCopilotState({ notice: "You changed the canvas while it was saving — try again." })
      return
    }
  }

  const workflowId = useWorkflowStore.getState().workflowId
  if (!workflowId) {
    setCopilotState({ notice: "Save the workflow first." })
    return
  }

  let threadId = state.threadId
  if (!threadId || state.workflowId !== workflowId) {
    try {
      // A thread is created on the FIRST send, not when the panel opens — a
      // user who only looks around should not leave threads behind.
      const handshake = await createCopilotThread({ workflowId })
      threadId = handshake.thread.id
      setCopilotState({ threadId, workflowId })
      // Find-or-create: only seed an EMPTY transcript for a thread that really
      // is new, or a race with the thread lookup blanks a real conversation.
      if (handshake.thread.userTurnCount === 0) {
        queryClient.setQueryData(queryKeys.copilot.thread(threadId), { thread: handshake.thread, messages: [] })
      }
      // The toggle works before a thread exists, so a preference set while the
      // panel was empty has to be pushed onto the freshly created thread.
      await syncRunSettings(threadId, handshake.thread)
    } catch (err) {
      setCopilotState({ notice: describeApiError(err) })
      return
    }
  }

  controller = new AbortController()
  const bornIn = generation
  // A run the panel is still following outlives the turn that proposed it: its
  // outcome is what Auto's fix loop reacts to, and its card carries the only
  // Stop the panel offers. Clearing it here would silently drop both.
  const following = copilotState().runPhase === "running" && copilotState().executionId !== null
  setCopilotState({
    turn: startTurn(text),
    streaming: true,
    ...(following ? {} : { runPhase: "idle" as const, executionId: null }),
    autoRunCount: 0,
    autoFixChain: opts.auto ? copilotState().autoFixChain + 1 : 0,
    // NOT lastReportedExecutionId: only starting a new run (or discarding the
    // one being followed) may re-open reporting. Clearing it here would let a
    // panel remount report the same failed execution again — and in Auto mode
    // that is another paid turn.
    proposalDismissed: false,
    activityCollapsed: false,
    notice: null,
    insufficient: null,
    draft: "",
    mentions: [],
  })
  useCopilotUiStore.getState().setTurnActive(true)

  try {
    const headers = await getAuthHeaders()
    const stream = streamRequest<CopilotStreamEvent>(`/v1/copilot/threads/${encodeURIComponent(threadId)}/messages`, {
      body: { message: wire, baseVersion: useWorkflowStore.getState().loadedVersion ?? undefined },
      baseUrl: runtimeApiUrl(),
      headers,
      signal: controller.signal,
    })
    for await (const event of stream) {
      if (bornIn !== generation) break
      apply((turn) => reduceTurn(turn, event), bornIn)
      await onEvent(event, workflowId)
    }
    // A stream can end without a terminal event (dropped connection). Do not
    // leave the composer locked behind a turn that is no longer arriving.
    if (copilotState().turn.status === "streaming") {
      apply((turn) => ({ ...turn, status: "cancelled" }), bornIn)
    }
  } catch (err) {
    handleStreamError(err, bornIn)
  } finally {
    controller = null
    if (bornIn === generation) setCopilotState({ streaming: false })
    useCopilotUiStore.getState().setTurnActive(false)
    queryClient.invalidateQueries({ queryKey: queryKeys.copilot.thread(threadId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.credits.all })
  }
}

async function onEvent(event: CopilotStreamEvent, workflowId: string): Promise<void> {
  // The editor navigated to a different workflow mid-turn. Stop rather than
  // reconcile another workflow's version onto this canvas. Guarding on the id
  // captured at send time is an invariant; an unmount hook would not be one,
  // since the panel unmounts on an ordinary tab switch too.
  if (useWorkflowStore.getState().workflowId !== workflowId) {
    controller?.abort()
    return
  }
  if (event.type === "metadata") {
    // Remembered past the end of the stream: it is how the panel later tells
    // its own unfinished turn from another tab's.
    setCopilotState({ lastTurnId: event.data.turnId })
    copilotState().setRunSettings(event.data.runMode, event.data.autoRunLimitCredits)
    return
  }
  if (event.type === "workflow_updated") {
    const outcome = await ensureCanvasVersion(workflowId, event.data.version, controller?.signal)
    if (outcome === "dirty" || outcome === "failed") {
      setCopilotState({ notice: "The canvas is behind — reload to see the copilot's latest changes." })
    }
    return
  }
  if (event.type === "run_proposed") {
    onProposal()
  }
}

function onProposal(): void {
  const { bridge, autoRunCount, runMode, autoRunLimit, runPhase } = copilotState()

  // A single assistant message can carry two `run_workflow` calls, and the
  // loop dispatches every tool block before it ends the turn — so two
  // proposals can arrive one microtask apart. `runPhase` is the ONLY signal
  // that moves synchronously: `bridge.isRunning` is a React round-trip and is
  // still false when the second proposal lands. Read it BEFORE the reset write
  // below, or a second execution starts on the same graph — billed, invisible,
  // and unreachable by Stop, which can only follow one execution id.
  if (runPhase === "running") return

  setCopilotState({ runPhase: "proposed" })
  if (runMode !== "auto") return

  const canAuto =
    bridge.run !== null &&
    // The estimate is recomputed asynchronously and holds the PREVIOUS graph's
    // number while it refetches — which is exactly the moment a proposal
    // arrives, since the copilot proposes right after it adds nodes. Never
    // decide to spend against a price that is not demonstrably this graph's.
    estimateIsCurrent(bridge) &&
    // Secondary, and slower: the editor's own view of whether a run is live.
    !bridge.isRunning &&
    autoRunCount < MAX_AUTO_RUNS_PER_TURN &&
    bridge.creditEstimate <= autoRunLimit
  if (canAuto) startProposedRun()
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Start the proposed run. `skipConfirm` because the proposal card IS the
 * confirmation — the editor's own dialog would be a second one.
 */
export function startProposedRun(): void {
  const { bridge, runPhase } = copilotState()
  // `runPhase` first: it is synchronous, so it also catches a double-click on
  // the card's Run button, which `bridge.isRunning` would be too slow for.
  if (!bridge.run || runPhase === "running" || bridge.isRunning) return
  setCopilotState({
    runPhase: "running",
    executionId: null,
    lastReportedExecutionId: null,
    autoRunCount: copilotState().autoRunCount + 1,
    proposalDismissed: false,
  })
  // The editor answers with the execution it started, or null if it bailed —
  // not enough credits, nothing executable, a declined confirm, a failed start.
  // Inferring this from `bridge.isRunning` does not work: React has not
  // flushed the bail's `setIsRunning(false)` by the time this resolves, so the
  // panel would sit on "Running" with no Stop and no execution to follow.
  void Promise.resolve(bridge.run({ skipConfirm: true })).then((result) => {
    if (copilotState().runPhase !== "running") return
    if (result?.executionId) {
      noteExecutionStarted(result.executionId)
      return
    }
    setCopilotState({ runPhase: "proposed" })
  })
}

/**
 * Declining a run is a local dismiss, not a message. Posting "[run] declined"
 * would spend a full paid turn to tell the model something the next turn's
 * context preamble already states.
 */
export function skipProposedRun(): void {
  copilotState().dismissProposal()
}

/**
 * The panel reports how the execution it started ended.
 *
 * Deduped in the STORE, not in the caller: the panel unmounts on an ordinary
 * editor-tab switch, so a component-local ref would let a remount report the
 * same execution again — and in Auto mode that means paying for another turn.
 */
export function reportRunOutcome(executionId: string, status: "succeeded" | "failed"): void {
  const state = copilotState()
  if (state.lastReportedExecutionId === executionId) return
  setCopilotState({ runPhase: status, lastReportedExecutionId: executionId })

  // Only a FAILURE in Auto mode continues on its own — that is the fix loop the
  // feature exists for. A success needs no paid round-trip to confirm itself.
  if (status !== "failed" || state.runMode !== "auto" || state.streaming) return
  if (state.autoFixChain >= MAX_AUTO_FIX_CHAIN) {
    setCopilotState({ notice: COPILOT_STRINGS.autoFixExhausted })
    return
  }
  void sendCopilotMessage(COPILOT_STRINGS.fixItMessage, { auto: true })
}

/** Stop following an execution — the user discarded it, so its outcome is not news. */
export function clearRunFollow(): void {
  setCopilotState({ runPhase: "idle", executionId: null, lastReportedExecutionId: null })
}

export function noteExecutionStarted(executionId: string): void {
  if (copilotState().runPhase === "running") setCopilotState({ executionId })
}

/** Polling gave up (the execution is gone). Say so rather than sit on "Running". */
export function abandonRunFollow(notice: string): void {
  if (copilotState().runPhase !== "running") return
  setCopilotState({ runPhase: "idle", executionId: null, lastReportedExecutionId: null, notice })
}

/** An estimate is only usable if it was computed for the graph on screen right now. */
function estimateIsCurrent(bridge: CopilotEditorBridge): boolean {
  if (bridge.estimateStale) return false
  const loaded = useWorkflowStore.getState().loadedVersion
  return bridge.estimateVersion !== null && bridge.estimateVersion === loaded
}

/** Ask mode, or a user who wants the fix loop on demand. */
export function askForFix(): void {
  void sendCopilotMessage(COPILOT_STRINGS.fixItMessage)
}

// ---------------------------------------------------------------------------
// Stopping and teardown
// ---------------------------------------------------------------------------

export async function stopCopilotTurn(): Promise<void> {
  const { threadId, streaming } = copilotState()
  if (!streaming) return
  controller?.abort()
  if (threadId) {
    // Replica-safe: the local abort only reaches THIS server, the flag reaches
    // whichever one is actually running the loop.
    try {
      await cancelCopilotTurn(threadId)
    } catch {
      // The turn is already finishing; the local abort is enough.
    }
  }
}

/** The editor unmounted, or a different workflow loaded. */
export function teardownCopilot(workflowId: string | null): void {
  generation += 1
  controller?.abort()
  controller = null
  useCopilotUiStore.getState().setTurnActive(false)
  useCopilotStore.setState({ streaming: false, turn: EMPTY_TURN })
  copilotState().resetForWorkflow(workflowId)
}

/** Push a locally-set Ask/Auto preference onto a thread that does not have it yet. */
async function syncRunSettings(threadId: string, thread: CopilotThread): Promise<void> {
  const { runMode, autoRunLimit } = copilotState()
  if (thread.runMode === runMode && thread.autoRunLimitCredits === autoRunLimit) return
  try {
    await updateCopilotThread(threadId, { runMode, autoRunLimitCredits: autoRunLimit })
  } catch {
    // Not worth failing the send over — the turn still runs in the mode the
    // server has, and the metadata event will correct the UI.
    copilotState().setRunSettings(thread.runMode, thread.autoRunLimitCredits)
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function handleStreamError(err: unknown, bornIn: number): void {
  if (bornIn !== generation) return
  if (err instanceof DOMException && err.name === "AbortError") {
    apply((turn) => ({ ...turn, status: "cancelled" }), bornIn)
    return
  }
  if (err instanceof SseHttpError) {
    const body = parseErrorBody(err.message)
    if (err.status === 402) {
      setCopilotState({
        insufficient: { required: numberOr(body.required, 0), balance: numberOr(body.balance, 0) },
      })
      apply((turn) => ({ ...turn, status: "failed", error: null }), bornIn)
      return
    }
    apply(
      (turn) => ({
        ...turn,
        status: "failed",
        error: {
          code: String(body.code ?? "request_failed"),
          message: String(body.message ?? "The copilot could not start this turn."),
        },
      }),
      bornIn,
    )
    return
  }
  apply(
    (turn) => ({
      ...turn,
      status: "failed",
      error: { code: "network_error", message: "Lost the connection to the copilot." },
    }),
    bornIn,
  )
}

/** `SseHttpError` folds the response body into its message; dig it back out. */
function parseErrorBody(message: string): Record<string, unknown> {
  const start = message.indexOf("{")
  if (start === -1) return {}
  try {
    const parsed = JSON.parse(message.slice(start)) as { error?: Record<string, unknown> }
    return parsed.error ?? (parsed as Record<string, unknown>)
  } catch {
    return {}
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof CopilotApiError) return err.message
  return "Could not start a copilot conversation."
}

/** Turn the persistence layer's error codes into something a person can act on. */
const SAVE_FAILED_NOTICE = new Map<string, string>([
  ["remote_conflict", "This workflow changed somewhere else — reload, then ask again."],
  ["Empty workflow", "Add a node first, or describe what to build and it will be created."],
  ["No project ID", "Open the workflow from its project, then try again."],
])

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
