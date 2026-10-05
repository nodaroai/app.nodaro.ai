import { getWorkflowAccess, isNotFoundError, type WorkflowAccessLevel } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { runsInFlightOn } from "@/lib/run-in-flight-mark"
import { recheckedAccess } from "@/lib/workflow-content"

/**
 * Ask the server what this person may do with the workflow just loaded, and
 * put the canvas into the matching mode.
 *
 * The row policies already decide what the canvas may READ — that is why the
 * load succeeded. They decide what it may WRITE too, but silently, by refusing
 * a save that has already been typed. So the canvas asks up front instead of
 * letting somebody work for ten minutes into a wall.
 *
 * And it asks again while the workflow stays open (T97,
 * `use-workflow-access-recheck.ts`), because a load's answer is only what was
 * true when it was given. Every re-check comes through here, so it applies its
 * answer exactly as the load applies the first one — and writes it into the
 * store's `loadedAccess` too, the record that decides whether the canvas
 * subscribes to the row or polls for it (`mayHoldStoredRow`).
 *
 * Its own module, and exported, because the alternative was three branches and
 * a race guard buried inside a two-hundred-line load closure that no test can
 * reach. A rule that decides whether a person can work is not a good place for
 * "covered by inspection".
 */
export async function applyWorkflowAccess(workflowId: string): Promise<void> {
  // The record this answer may replace, read before asking: the one the load
  // just wrote, or the one a re-check found.
  const askedUnder = useWorkflowStore.getState().loadedAccess

  const answer = await askAccess(workflowId)
  // Fire-and-forget by design: a failed check leaves the canvas exactly as it
  // is, with the server still refusing anything it should. The opposite choice
  // would freeze somebody's own work on a network blip — and a re-check runs
  // exactly when one is likely, as a laptop wakes and its tab is shown again.
  // A failure is not evidence that anything changed; the next re-check asks.
  if (!answer) return

  // Late answers are dropped. Opening two workflows in quick succession
  // would otherwise let the first one's verdict land on the second — and the
  // visible version of that bug is somebody's own work going read-only. A
  // reload of the same workflow counts too: it replaced the record this answer
  // was asked under, and asks its own question.
  const state = useWorkflowStore.getState()
  if (state.workflowId !== workflowId || state.loadedAccess !== askedUnder) return

  // Written only over a record the load wrote for this workflow: without one
  // (a failed load) the canvas stays unknown, and unknown fails closed.
  // A record that did not change is not written again: the canvas reads it,
  // and a new object would re-render it on every re-check.
  const loadedAccess = askedUnder?.workflowId === workflowId ? recheckedAccess(askedUnder, answer.access) : askedUnder
  const changed = loadedAccess !== askedUnder

  // Two different things can be true, and only one of them freezes the
  // canvas.
  if (answer.access === "view" || answer.access === "none") {
    // At once, the two halves that stop this canvas holding and sending what
    // its reader may no longer: the record, on which `useWorkflowRealtimeSync`
    // closes the subscription and starts the stamp poll, and the refusal of
    // every save from here on (`saveRefusedFor`), so nothing more is sent.
    if (changed || state.saveRefusedFor !== workflowId) {
      useWorkflowStore.setState({ saveRefusedFor: workflowId, ...(changed ? { loadedAccess } : {}) })
    }
    // Read-only waits for the runs in flight to land their results.
    freezeOnceRunsLand(workflowId)
    return
  }

  // A wider answer than the record's opens the subscription again. It lifts
  // neither read-only nor the refusal of saves: a canvas a `view` answer
  // reached may be holding the reader's projection, and an editor saves the
  // graph back whole — saving that would erase the owner's drafts (T21 / T77).
  // The next load reads the workflow as its editor may hold it.
  if (changed) useWorkflowStore.setState({ loadedAccess })

  // The case the reason field exists for, and the one nobody can work out
  // unaided: they may edit — the canvas responds, saves land — and Run does
  // nothing, because running spends the workspace's credits and that takes
  // membership. The canvas stays writable; only Run has something to explain.
  if (!answer.canRun) {
    useWorkflowStore.setState({
      runBlockedReason: "You can edit this, but only members of its workspace can run it.",
    })
  }
}

/**
 * What a `view` or `none` answer says on the canvas.
 *
 * Deliberately claims nothing about MEMBERSHIP. The same `view` answer reaches
 * an outside collaborator, a member of a class whose settings only allow
 * reading, and the CREATOR of a workflow in an archived workspace — and telling
 * that last person they are "not a member" of their own class is both false and
 * baffling. What is true of all three is the part worth saying.
 */
const READ_ONLY_REASON = "This workflow is read-only for you."

type WorkflowStoreState = ReturnType<typeof useWorkflowStore.getState>

/** How to stop the one freeze still waiting for its runs to land, if any. */
let stopWaitingForRuns: (() => void) | null = null

/**
 * Turn the canvas read-only, but only once no node shows a run in flight
 * ({@link showsARunInFlight}).
 *
 * `updateNodeData` does nothing on a read-only canvas, so raising read-only
 * while a run is out would drop the result of a job already paid for and leave
 * its node spinning (the store's `saveRefusedFor` doc). Its saves are refused
 * by then, so waiting costs nothing but the lock itself: until the last run
 * lands, the canvas is the one a refused save leaves, interactive with nothing
 * kept. A run clears its marks in the write that paints its last result (a
 * job's id, a Run over a list's batch flag, a status that turns `completed` or
 * `failed`), or, outside the executors, right after it (`withRunInFlight`), so
 * the freeze lands right after that write.
 *
 * Dropped, never applied, once the workflow it was for is no longer the one
 * open, or a load has replaced the verdict (a load clears `saveRefusedFor` and
 * asks its own question). One at a time: a re-check that answers `view` every
 * minute through a long run replaces its own earlier wait.
 */
function freezeOnceRunsLand(workflowId: string): void {
  stopWaitingForRuns?.()
  stopWaitingForRuns = null

  const verdict = (s: WorkflowStoreState): "freeze" | "wait" | "drop" => {
    if (s.workflowId !== workflowId || !isSaveRefused(s)) return "drop"
    // A canvas already read-only (a `view` load) has nothing left to protect;
    // only its sentence is missing.
    if (s.isReadOnly || !s.nodes.some(showsARunInFlight)) return "freeze"
    return "wait"
  }

  const now = verdict(useWorkflowStore.getState())
  if (now !== "wait") {
    if (now === "freeze") freeze()
    return
  }

  const stop = useWorkflowStore.subscribe((s) => {
    const next = verdict(s)
    if (next === "wait") return
    // Stop listening first: the freeze is itself a store write, and would come
    // straight back here.
    stop()
    if (stopWaitingForRuns === stop) stopWaitingForRuns = null
    if (next === "freeze") freeze()
  })
  stopWaitingForRuns = stop
}

function freeze(): void {
  const s = useWorkflowStore.getState()
  if (s.isReadOnly && s.readOnlyReason === READ_ONLY_REASON) return
  useWorkflowStore.setState({ isReadOnly: true, readOnlyReason: READ_ONLY_REASON })
}

/**
 * Does this node show a run in flight, by any mark a run leaves on its node?
 * Read-only waits until none does (controller ruling, 2026-10-05).
 *
 * Over-counting is the safe side, on purpose. A mark a run left behind keeps
 * the canvas editable and unsaveable until it changes, which writes nothing; a
 * mark this test missed lets the freeze land mid-run and drops a paid result.
 *
 * - `currentJobId`: a node waiting on a job's result. Its poll checks the id
 *   before it paints (`shouldAbandonNode`) and clears it in the write that
 *   paints the result.
 * - `__listRunning`: a Run over a list (`executeNodeForList`, from its own Run
 *   button or inside a Sub-Workflow, whose namespaced nodes live in the store
 *   too). Its iterations share that one id: each writes its own job there, and
 *   each completion clears it while the others are still polling. This flag
 *   covers the whole batch: set when it starts, cleared in its last write (a
 *   `finally` backs up a throw). It is never saved, and a load clears a stale
 *   one.
 * - `executionStatus` `pending`: the flip every Run path writes before its
 *   executor starts, across an awaited pre-run save, and a whole-workflow
 *   run's queued nodes. The node paints it as running.
 * - any status key reading `running`. `executionStatus` is one: every
 *   run-start patch (`RUN_START_RESET`) writes it before the create request,
 *   so a node between that and its job's id counts, and a whole-workflow run
 *   paints it with no job id at all. The variant loops on Character, Object
 *   and Location nodes (`handleGenerate{Character,Object,Location}Asset`) hold
 *   nothing else: only their own key (`expressionStatus`, `anglesStatus`, …)
 *   for a loop of paid jobs. Any key ending in `Status`, so a new loop that
 *   follows the same convention counts with no list to keep in step
 *   (`workflow-viewer-mode-runs.test.ts` holds the executors to it).
 * - a script's scene image (`handleGenerateSceneImage`), whose only mark is
 *   its scene's `imageStatus` inside `generatedScript`.
 * - `__runsInFlight`: a paid run outside the executors, which no mark above
 *   covers (T100): Generate All Assets, a custom variation and Refine on a
 *   character's or object's page, a Suno voice's persona, an overlay's
 *   placement suggestion, a Character Studio's seed prompt suggestion.
 *   `withRunInFlight` adds one token per run before its first paid request
 *   and removes it once the run's last result is written, or it fails; Refine
 *   keeps its token until an image is picked or the picker is closed. Never
 *   saved, so a reload starts without it; Undo and Redo keep the live tokens,
 *   and a copy starts with none (`lib/run-in-flight-mark.ts`).
 */
export function showsARunInFlight(node: { readonly data?: unknown }): boolean {
  const data = node.data as Record<string, unknown> | undefined
  if (!data) return false
  if (data.currentJobId || data.__listRunning === true || data.executionStatus === "pending") return true
  if (runsInFlightOn(data).length > 0) return true
  return Object.keys(data).some((key) => key.endsWith("Status") && data[key] === "running")
    || sceneImageInFlight(data.generatedScript)
}

/** A script (`generatedScript`) with a scene whose image is still being made. */
function sceneImageInFlight(script: unknown): boolean {
  const scenes = (script as { readonly scenes?: unknown } | null | undefined)?.scenes
  return Array.isArray(scenes)
    && scenes.some((scene) => (scene as { readonly imageStatus?: unknown } | null)?.imageStatus === "running")
}

/** How long one ask of the access may take before it counts as a failed one. */
export const ACCESS_ASK_TIMEOUT_MS = 15_000

/**
 * The server's answer, or null when there is none to be had. `none` is an
 * answer: the route turns away a caller with no access at all with the same
 * 404 it gives an id that does not exist, as every by-id route does.
 *
 * Bounded by {@link ACCESS_ASK_TIMEOUT_MS}. Re-checks are coalesced to one in
 * flight plus one trailing (`use-workflow-access-recheck.ts`), so one ask that
 * never settled would hold every later trigger behind it. Timed out, it is a
 * failed check like any other, and the trigger queued behind it asks again.
 * The abort cancels the request; the race settles the ask even when the hang
 * comes before the request leaves (`apiRequest` waits for the session's
 * headers first).
 */
async function askAccess(workflowId: string): Promise<{ access: WorkflowAccessLevel; canRun: boolean } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ACCESS_ASK_TIMEOUT_MS)
  const timedOut = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("The access check timed out")), { once: true })
  })
  try {
    const { data } = await Promise.race([getWorkflowAccess(workflowId, { signal: controller.signal }), timedOut])
    return { access: data.access, canRun: data.canRun }
  } catch (err) {
    return isNotFoundError(err) ? { access: "none", canRun: false } : null
  } finally {
    clearTimeout(timer)
  }
}

type RecheckRequestListener = (workflowId: string) => void

const recheckRequestListeners = new Set<RecheckRequestListener>()

/**
 * Ask the canvas showing `workflowId` to re-check its access NOW rather than at
 * its next timed re-check (T97), hidden tab or not: a hidden tab's subscription
 * would otherwise outlive the change.
 *
 * For the save path, which learns something no timer can. A save that matched
 * no row and was turned away (`refused`), or that met a row this tab can no
 * longer read (`unknown`), can mean the access changed: a collaborator removed
 * while the canvas was open can no longer SELECT the row, so their miss reads
 * `unknown`. A real conflict is somebody else's write and asks nothing. With
 * no canvas listening (its load has not answered), nothing happens.
 */
export function requestAccessRecheck(workflowId: string): void {
  for (const listener of [...recheckRequestListeners]) listener(workflowId)
}

/** Hear those requests (`useWorkflowAccessRecheck`). Returns the way to stop. */
export function onAccessRecheckRequest(listener: RecheckRequestListener): () => void {
  recheckRequestListeners.add(listener)
  return () => {
    recheckRequestListeners.delete(listener)
  }
}
